// The desktop of a person's server environment (organization mode): computer
// use runs as fixed sagax-desktop argv in that person's sandbox, and the live
// view (/api/desktop-viewer/sandbox/me) shows only the caller's own desktop,
// view-only unless they take control, and never starts anything from the
// WebSocket.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sandboxDesktopTarget } from "./desktop-viewer-targets.ts";
import { json, readBody } from "./harness/http.ts";
import { requiredScope, resolveRequestAuth } from "./request-auth.ts";
import { createDesktopViewer, SANDBOX_VIEWER_TARGET } from "./routes/desktop-viewer.ts";
import { PASS } from "./routes/table.ts";
import { createUserSandboxRoutes } from "./sandbox/user-sandbox-routes.ts";
import { SandboxService } from "./sandbox/sandboxd-core.ts";
import { SessionRegistry } from "./sessions.ts";
import { FakeDocker } from "./testing/fake-docker.ts";
import { inProcessSandboxdClient } from "./testing/in-process-sandboxd.ts";
import { UserSandboxManager } from "./sandbox/user-sandbox-manager.ts";
import { sandboxNames, sandboxdConfigFromEnv } from "./sandbox/user-sandbox-spec.ts";
import { callUserSandboxTool, handleUserSandboxMcp, sandboxComputerExec, SANDBOX_COMPUTER_TOOLS } from "./sandbox/user-sandbox-tools.ts";
import { encodeWebSocketFrame, webSocketFrameDecoder } from "./ws-bridge.ts";

const ALICE = "pr_00000000-0000-4000-8000-00000000000a";
const BOB = "pr_00000000-0000-4000-8000-00000000000b";
const remote = { host: "sagax.example", origin: "https://sagax.example", "x-forwarded-proto": "https" };

describe("computer use in the server environment", () => {
  it("is offered with the desktop bridge's shape", async () => {
    const listed = await handleUserSandboxMcp("tools/list", {}, { exec: async () => { throw new Error("no exec"); }, overQuota: async () => false }) as { tools: { name: string }[] };
    expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["computer_list_tools", "computer_use", "run_command"]));
    expect(SANDBOX_COMPUTER_TOOLS.map((tool) => tool.name)).toEqual(["screenshot", "get_screen_size", "click", "move", "drag", "type_text", "key_press", "scroll", "open_url"]);
  });

  it("turns each call into a fixed argv, never a shell line", () => {
    expect(sandboxComputerExec("click", { x: 10, y: 20, button: "right", count: 2 }).argv)
      .toEqual(["sagax-desktop", "xdotool", "mousemove", "--sync", "10", "20", "click", "--repeat", "2", "--delay", "100", "3"]);
    expect(sandboxComputerExec("type_text", { text: "$(rm -rf /) ; héllo" })).toMatchObject({ argv: ["sagax-desktop", "type"], env: { SAGAX_TEXT: "$(rm -rf /) ; héllo" } });
    expect(sandboxComputerExec("open_url", { url: "https://example.com/a b" })).toMatchObject({ argv: ["sagax-desktop", "open-url"], env: { SAGAX_URL: "https://example.com/a%20b" } });
    expect(() => sandboxComputerExec("key_press", { key: "ctrl+l; reboot" })).toThrow(/X11 key/);
    expect(() => sandboxComputerExec("click", { x: -1, y: 2 })).toThrow(/x must be/);
    expect(() => sandboxComputerExec("click", { x: "1", y: 2 })).toThrow(/x must be/);
    expect(() => sandboxComputerExec("open_url", { url: "file:///etc/passwd" })).toThrow(/http/);
    expect(() => sandboxComputerExec("exec", { command: "id" })).toThrow(/unknown computer-use tool/);
  });

  it("returns a screenshot as an image and refuses a broken capture", async () => {
    const seen: string[][] = [];
    const exec = (stdout: string, exitCode = 0) => ({
      exec: async (input: { argv: string[] }) => { seen.push(input.argv); return { exitCode, stdout, stderr: "", truncated: false, timedOut: false }; },
      overQuota: async () => false,
    });
    const shot = await callUserSandboxTool("computer_use", { tool_name: "screenshot" }, exec("/9j/AAAA"));
    expect(shot).toEqual({ content: [{ type: "image", data: "/9j/AAAA", mimeType: "image/jpeg" }] });
    expect(seen[0]).toEqual(["sagax-desktop", "screenshot"]);
    expect((await callUserSandboxTool("computer_use", { tool_name: "screenshot" }, exec("", 1))).isError).toBe(true);
    expect((await callUserSandboxTool("computer_use", { tool_name: "click", arguments: [] }, exec(""))).isError).toBe(true);
    expect(await callUserSandboxTool("computer_use", { tool_name: "get_screen_size" }, exec("1280 800\n")))
      .toEqual({ content: [{ type: "text", text: '{"width":1280,"height":800}' }] });
  });
});

describe("live view of the server environment desktop", () => {
  let dir: string;
  let docker: FakeDocker;
  let service: SandboxService;
  let manager: UserSandboxManager;
  let sessions: SessionRegistry;
  let app: Server;
  let port: number;
  let viewer: ReturnType<typeof createDesktopViewer>;
  let alice: string;
  let bob: string;
  let adminWithoutPerson: string;
  let turnRunning: string | null;
  const peers = new Set<Duplex>();

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "sbx-desktop-"));
    docker = new FakeDocker();
    service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test" }));
    await service.installEgressPolicy();
    const client = inProcessSandboxdClient(service, 2);
    manager = new UserSandboxManager({ client, instance: "default", stateFile: join(dir, "deletions.json") });
    sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
    alice = sessions.issue({ label: "Alice", scopes: ["client"], principalId: ALICE }).token;
    bob = sessions.issue({ label: "Bob", scopes: ["client"], principalId: BOB }).token;
    adminWithoutPerson = sessions.issue({ label: "Console", scopes: ["admin", "client"] }).token;
    viewer = createDesktopViewer({
      target: (id, auth) => {
        if (id !== SANDBOX_VIEWER_TARGET) return;
        const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : "";
        return principalId ? sandboxDesktopTarget(manager, principalId) : undefined;
      },
      live: (auth) => auth.kind === "loopback" || sessions.isLive(auth.session.id),
    });
    turnRunning = null;
    const sandboxRoutes = createUserSandboxRoutes({ manager: () => manager, organization: true, turnRunning: (person) => person === turnRunning });
    const handle = async (req: Parameters<typeof resolveRequestAuth>[0], res: Parameters<typeof json>[0]) => {
      const url = new URL(req.url!, "http://localhost");
      const gate = resolveRequestAuth(req, { sessions, cookieName: "s", url, streamPath: "/api/events", loopbackTrust: "service", features: { orgDirectory: true } });
      if (!gate.auth) return json(res, gate.status, { error: gate.error });
      const context = { req, res, url, path: url.pathname, method: req.method!, auth: gate.auth, json, readBody };
      if (await sandboxRoutes(context) !== PASS) return;
      await viewer.route(context);
    };
    app = createServer((req, res) => void handle(req, res));
    viewer.attach(app, handle);
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    port = (app.address() as { port: number }).port;
  });

  afterEach(async () => {
    viewer.closeAll();
    for (const peer of peers) peer.destroy();
    peers.clear();
    await new Promise<void>((resolve) => { app.close(() => resolve()); app.closeAllConnections(); });
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string, token: string, extra: Record<string, string> = {}) => new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers: { ...remote, cookie: `s=${token}`, ...extra } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(text || "{}") as Record<string, unknown> }));
    });
    req.once("error", reject);
    req.end();
  });

  const open = (path: string, token: string) => new Promise<{ status: number; socket?: Duplex }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, headers: {
      ...remote, cookie: `s=${token}`, Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13",
    } });
    req.once("upgrade", (res, socket, head) => {
      peers.add(socket);
      if (head.length) socket.unshift(head);
      resolve({ status: res.statusCode!, socket });
    });
    req.once("response", (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode! })); });
    req.once("error", reject);
    req.end();
  });

  const lastStart = () => docker.execs.filter((entry) => entry.exec.Cmd.includes("sagax-desktop") && entry.exec.Cmd.includes("start")).at(-1)!;
  const envOf = (entry: { exec: { Env: string[] } }) => Object.fromEntries(entry.exec.Env.map((pair) => pair.split("=", 2) as [string, string]));

  it("is a client-scope route on an organization server only", () => {
    expect(requiredScope("GET", "/api/desktop-viewer/sandbox/me", { orgDirectory: true })).toBe("client");
    expect(requiredScope("GET", "/api/desktop-viewer/sandbox/me/websockify", { orgDirectory: true })).toBe("client");
    expect(requiredScope("GET", "/api/desktop-viewer/sandbox/me", {})).toBe("admin");
    expect(requiredScope("GET", "/api/desktop-viewer/local/shared", { orgDirectory: true })).toBe("admin");
  });

  it("opens the caller's own desktop, view-only by default, control on request", async () => {
    const view = await get("/api/desktop-viewer/sandbox/me", alice);
    expect(view.status).toBe(200);
    expect(view.body.viewOnly).toBe(true);
    const start = lastStart();
    expect(start.name).toBe(sandboxNames(manager.keyFor(ALICE)).container);
    expect(view.body.password).toBe(envOf(start).SAGAX_VNC_VIEW);
    expect(envOf(start).SAGAX_VNC_FULL).not.toBe(envOf(start).SAGAX_VNC_VIEW);

    const control = await get("/api/desktop-viewer/sandbox/me?control=1", alice);
    expect(control.body).toMatchObject({ viewOnly: false, password: envOf(lastStart()).SAGAX_VNC_FULL });
  });

  it("rebuilds an environment from before the desktop when its owner opens the desktop, keeping /workspace", async () => {
    // production 2026-10-02: an environment created on an image without
    // sagax-desktop answered every open with a bare 502, "not available".
    await get("/api/desktop-viewer/sandbox/me", alice);
    const names = sandboxNames(manager.keyFor(ALICE));
    docker.containers.get(names.container)!.spec.Image = "sagax-sandbox:before-the-desktop";
    const noDesktop = () => docker.containers.get(names.container)!.spec.Image !== "sagax-sandbox:test";
    docker.execResult = (exec) => ({ exitCode: exec.Cmd.includes("sagax-desktop") && noDesktop() ? 127 : 0, stdout: Buffer.from("running"), stderr: Buffer.alloc(0), truncated: false });
    const starts = () => docker.execs.filter((entry) => entry.exec.Cmd.includes("sagax-desktop") && entry.exec.Cmd.includes("start")).length;
    const before = starts();
    const view = await get("/api/desktop-viewer/sandbox/me", alice);
    expect(view.status).toBe(200);
    expect(view.body.password).toBe(envOf(lastStart()).SAGAX_VNC_VIEW);
    expect(docker.containers.get(names.container)!.spec.Image).toBe("sagax-sandbox:test");
    expect(docker.volumes.has(names.volume)).toBe(true);
    expect(starts() - before).toBe(2);
  });

  it("opens one desktop at a time per person, and two views opened together share their passwords", async () => {
    // Two opens at once (the Computer tab and Settings, or a remount) raced
    // on the password file in the sandbox and one answered 502; and each
    // open changed the passwords under the other view.
    const [first, second] = await Promise.all([get("/api/desktop-viewer/sandbox/me", alice), get("/api/desktop-viewer/sandbox/me", alice)]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.password).toBe(first.body.password);
    const starts = docker.execs.filter((entry) => entry.exec.Cmd.includes("sagax-desktop") && entry.exec.Cmd.includes("start"));
    expect(new Set(starts.map((entry) => envOf(entry).SAGAX_VNC_VIEW)).size).toBe(1);
    const control = await get("/api/desktop-viewer/sandbox/me?control=1", alice);
    expect(control.body).toMatchObject({ viewOnly: false, password: envOf(lastStart()).SAGAX_VNC_FULL });
    expect(envOf(lastStart()).SAGAX_VNC_VIEW).toBe(first.body.password);
  });

  it("says the environment is outdated, and leaves it alone, while a bot works in it", async () => {
    await get("/api/desktop-viewer/sandbox/me", alice);
    const key = manager.keyFor(ALICE);
    const names = sandboxNames(key);
    docker.containers.get(names.container)!.spec.Image = "sagax-sandbox:before-the-desktop";
    docker.execResult = (exec) => ({ exitCode: exec.Cmd.includes("sagax-desktop") ? 127 : 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), truncated: false });
    (service as unknown as { busy: Map<string, number> }).busy.set(key, 1);
    const view = await get("/api/desktop-viewer/sandbox/me", alice);
    expect(view.status).toBe(409);
    expect(view.body.code).toBe("outdated");
    expect(docker.containers.get(names.container)!.spec.Image).toBe("sagax-sandbox:before-the-desktop");
  });

  it("never reaches another person's desktop", async () => {
    await get("/api/desktop-viewer/sandbox/me", alice);
    const bobView = await get("/api/desktop-viewer/sandbox/me", bob);
    expect(bobView.status).toBe(200);
    expect(lastStart().name).toBe(sandboxNames(manager.keyFor(BOB)).container);
    expect(bobView.body.password).not.toBe(envOf(docker.execs.find((entry) => entry.name === sandboxNames(manager.keyFor(ALICE)).container)!).SAGAX_VNC_VIEW);
    // No id names someone else: only `me` exists.
    expect((await get(`/api/desktop-viewer/sandbox/${ALICE}`, bob)).status).not.toBe(200);
    // The target itself refuses any other session.
    const target = sandboxDesktopTarget(manager, ALICE);
    const bobSession = sessions.authenticate(bob)!;
    expect(target.allows!({ kind: "session", session: bobSession, via: "cookie", scopes: bobSession.scopes })).toBe(false);
    expect(target.allows!({ kind: "loopback", scopes: ["admin", "client"] })).toBe(false);
  });

  it("refuses a session that is no person, a cross-origin page and a signed-out person", async () => {
    expect((await get("/api/desktop-viewer/sandbox/me", adminWithoutPerson)).status).toBe(404);
    expect((await get("/api/desktop-viewer/sandbox/me", alice, { origin: "https://evil.example" })).status).toBe(403);
    await manager.personOut(ALICE);
    expect((await get("/api/desktop-viewer/sandbox/me", alice)).status).toBe(403);
    expect((await open("/api/desktop-viewer/sandbox/me/websockify", alice)).status).toBe(403);
  });

  it("does not start a stopped environment from the WebSocket", async () => {
    expect((await open("/api/desktop-viewer/sandbox/me/websockify", alice)).status).toBe(409);
    expect(docker.containers.size).toBe(0);
    await get("/api/desktop-viewer/sandbox/me", alice);
    await service.stop(manager.keyFor(ALICE));
    expect((await open("/api/desktop-viewer/sandbox/me/websockify", alice)).status).toBe(409);
  });

  it("frames the desktop's RFB stream as WebSocket and closes when the environment stops", async () => {
    await get("/api/desktop-viewer/sandbox/me", alice);
    const answer = await open("/api/desktop-viewer/sandbox/me/websockify", alice);
    expect(answer.status).toBe(101);
    const socket = answer.socket!;
    const frames: Buffer[] = [];
    const decode = (chunk: Buffer) => {
      // Server frames are unmasked: read them directly.
      let offset = 0;
      while (offset + 2 <= chunk.length) {
        const length = chunk[offset + 1]! & 0x7f;
        frames.push(chunk.subarray(offset + 2, offset + 2 + length));
        offset += 2 + length;
      }
    };
    socket.on("data", decode);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(Buffer.concat(frames).toString()).toBe("RFB 003.008\n");
    // A masked client frame reaches the desktop.
    const payload = Buffer.from("hi");
    const mask = Buffer.from([1, 2, 3, 4]);
    socket.write(Buffer.concat([Buffer.from([0x82, 0x80 | payload.length]), mask, Buffer.from(payload.map((byte, index) => byte ^ mask[index & 3]!))]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(Buffer.concat(frames).toString()).toBe("RFB 003.008\necho:hi");
    const closed = new Promise((resolve) => socket.once("close", resolve));
    docker.streams.at(-1)!.destroy();
    await closed;
  });

  const post = (path: string, token: string, body: unknown) => new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = request({ hostname: "127.0.0.1", port, path, method: "POST", headers: { ...remote, cookie: `s=${token}`, "content-type": "application/json", "content-length": Buffer.byteLength(text) } }, (res) => {
      let answer = "";
      res.on("data", (chunk) => { answer += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(answer || "{}") as Record<string, unknown> }));
    });
    req.once("error", reject);
    req.end(text);
  });

  it("powers the caller's own environment: start, pause, resume, shut down keeping /workspace", async () => {
    expect((await post("/api/me/server-environment/power", alice, { action: "start" })).body.state).toBe("running");
    expect((await post("/api/me/server-environment/power", alice, { action: "pause" })).body.state).toBe("paused");
    // Paused: bots are refused, the live view too, until resumed.
    await expect(manager.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "paused" });
    expect((await open("/api/desktop-viewer/sandbox/me/websockify", alice)).status).toBe(409);
    expect((await post("/api/me/server-environment/power", alice, { action: "start" })).body.state).toBe("running");
    expect((await post("/api/me/server-environment/power", alice, { action: "shutdown" })).body.state).toBe("stopped");
    expect(docker.volumes.has(sandboxNames(manager.keyFor(ALICE)).volume)).toBe(true);
    // Only Alice's container was ever touched.
    expect([...docker.containers.keys()]).toEqual([sandboxNames(manager.keyFor(ALICE)).container]);
    expect((await post("/api/me/server-environment/power", alice, { action: "reboot" })).status).toBe(400);
  });

  it("asks to confirm a shutdown or pause while a bot works there", async () => {
    await post("/api/me/server-environment/power", alice, { action: "start" });
    turnRunning = ALICE;
    const refused = await post("/api/me/server-environment/power", alice, { action: "shutdown" });
    expect(refused).toMatchObject({ status: 409, body: { code: "confirm_running" } });
    expect((await post("/api/me/server-environment/power", alice, { action: "pause" })).status).toBe(409);
    expect((await post("/api/me/server-environment/power", bob, { action: "start" })).status).toBe(200);
    expect((await post("/api/me/server-environment/power", alice, { action: "shutdown", confirm: true })).body.state).toBe("stopped");
  });

  it("reports the caller's own usage: CPU against its quota, memory, disk and OS", async () => {
    docker.execResult = (exec) => exec.Cmd.includes("du") ? { exitCode: 0, stdout: Buffer.from("1048576\t/workspace"), stderr: Buffer.alloc(0), truncated: false }
      : exec.Cmd.join(" ").includes("os-release") ? { exitCode: 0, stdout: Buffer.from("Debian GNU/Linux 12 (bookworm)\naarch64\n"), stderr: Buffer.alloc(0), truncated: false }
        : { exitCode: 0, stdout: Buffer.from("ok"), stderr: Buffer.alloc(0), truncated: false };
    const off = await get("/api/me/server-environment/stats", alice);
    expect(off.body).toMatchObject({ state: "missing", cpuPercent: null, memoryBytes: null });
    expect(docker.containers.size).toBe(0);
    await post("/api/me/server-environment/power", alice, { action: "start" });
    const stats = await get("/api/me/server-environment/stats", alice);
    expect(stats.body).toMatchObject({
      state: "running", cpuPercent: 25, memoryBytes: 300 * 1024 * 1024, memoryLimitBytes: 1536 * 1024 * 1024,
      workspaceBytes: 1048576, os: "Debian GNU/Linux 12 (bookworm)", arch: "aarch64", image: "sagax-sandbox:test",
    });
    expect((await get("/api/me/server-environment/stats", bob)).body.state).toBe("missing");
    expect(requiredScope("POST", "/api/me/server-environment/power", { orgDirectory: true })).toBe("client");
    expect(requiredScope("GET", "/api/me/server-environment/stats", { orgDirectory: true })).toBe("client");
  });
});

describe("WebSocket framing", () => {
  it("decodes masked, fragmented and large frames and refuses unmasked or oversized ones", () => {
    const mask = Buffer.from([9, 8, 7, 6]);
    const masked = (opcode: number, payload: Buffer, fin = true) => {
      const header = payload.length < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | payload.length])
        : Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126]), Buffer.from([payload.length >> 8, payload.length & 255])]);
      return Buffer.concat([header, mask, Buffer.from(payload.map((byte, index) => byte ^ mask[index & 3]!))]);
    };
    const decode = webSocketFrameDecoder(1024);
    const big = Buffer.alloc(300, 7);
    const all = Buffer.concat([masked(2, Buffer.from("ab"), false), masked(0, Buffer.from("cd")), masked(2, big)]);
    expect(decode(all.subarray(0, 5))).toEqual([]);
    const frames = decode(all.subarray(5)) as { payload: Buffer }[];
    expect(frames.map((frame) => frame.payload.toString("hex"))).toEqual([Buffer.from("ab").toString("hex"), Buffer.from("cd").toString("hex"), big.toString("hex")]);
    expect(webSocketFrameDecoder()(Buffer.from([0x82, 0x01, 0x41]))).toEqual({ error: 1002 });
    expect(webSocketFrameDecoder(10)(masked(2, Buffer.alloc(11)))).toEqual({ error: 1009 });
    expect(encodeWebSocketFrame(2, Buffer.alloc(70000)).subarray(0, 2)).toEqual(Buffer.from([0x82, 127]));
  });
});
