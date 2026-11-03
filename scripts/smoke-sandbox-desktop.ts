// Local Docker smoke test for the desktop of a person's server environment
// (docs/user-sandbox.md, "Desktop"). Starts the real provisioner
// (server/sandboxd.ts) against this machine's Docker with the default
// limits, creates ONE temporary sandbox for a fake person, drives its desktop
// with the computer-use tools (screenshot, open a page in Chromium, click,
// type), opens the live view through a local Sagax-like server (the real
// viewer route, session auth, the RFB stream through the provisioner), then
// deletes everything it made.
//
//   docker build -f deploy/sandbox/Dockerfile -t sagax-sandbox:smoke-desktop .
//   node --experimental-strip-types scripts/smoke-sandbox-desktop.ts [--image <tag>] [--shots <dir>]
//
// It only ever touches objects labelled with its own random instance.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sandboxDesktopTarget } from "../server/desktop/desktop-viewer-targets.ts";
import { json, readBody } from "../server/harness/http.ts";
import { resolveRequestAuth } from "../server/request-auth.ts";
import { createDesktopViewer, SANDBOX_VIEWER_TARGET } from "../server/routes/desktop-viewer.ts";
import { readSandboxdKey } from "../server/sandbox/sandboxd-auth.ts";
import { SandboxService } from "../server/sandbox/sandboxd-core.ts";
import { dockerApi } from "../server/sandbox/sandboxd-docker.ts";
import { SessionRegistry } from "../server/sessions.ts";
import { sandboxdClient } from "../server/sandbox/user-sandbox-client.ts";
import { UserSandboxManager } from "../server/sandbox/user-sandbox-manager.ts";
import { callUserSandboxTool, type ToolResult } from "../server/sandbox/user-sandbox-tools.ts";
import { SANDBOX_INSTANCE_LABEL, egressChain, sandboxNames, sandboxdConfigFromEnv } from "../server/sandbox/user-sandbox-spec.ts";

const option = (name: string) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };
const image = option("--image") ?? "sagax-sandbox:smoke-desktop";
const shots = option("--shots");
const instance = `smoke-${randomBytes(3).toString("hex")}`;
const pool = "10.213.224.0/20";
const socket = (() => {
  try {
    const host = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" }).trim();
    return host.startsWith("unix://") ? host.slice("unix://".length) : "/var/run/docker.sock";
  } catch { return "/var/run/docker.sock"; }
})();
const scratch = mkdtempSync(join(tmpdir(), "sagax-desktop-smoke-"));
const keyFile = join(scratch, "key");
const RESERVED = new Set([18790, 5199, 8799]);

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const found = (probe.address() as { port: number }).port;
        probe.close(() => resolve(found));
      });
    });
    if (!RESERVED.has(port)) return port;
  }
}

const env = {
  ...process.env,
  SAGAX_SANDBOX_IMAGE: image,
  SAGAX_SANDBOX_INSTANCE: instance,
  SAGAX_SANDBOX_SUBNET_POOL: pool,
  SAGAX_SANDBOXD_KEY_FILE: keyFile,
  SAGAX_SANDBOXD_DOCKER_SOCKET: socket,
};

const textOf = (result: ToolResult) => result.content.map((item) => item.type === "text" ? item.text : `[${item.mimeType}]`).join("\n");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const port = await freePort();
  const provisioner = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/sandboxd.ts"], {
    env: { ...env, SAGAX_SANDBOXD_LISTEN: `127.0.0.1:${port}` },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const config = sandboxdConfigFromEnv(env);
  const docker = dockerApi(socket);
  let app: ReturnType<typeof createHttpServer> | null = null;
  let viewer: ReturnType<typeof createDesktopViewer> | null = null;
  try {
    let client = null as ReturnType<typeof sandboxdClient> | null;
    for (let attempt = 0; attempt < 120 && !client; attempt++) {
      await sleep(500);
      try {
        const candidate = sandboxdClient(`http://127.0.0.1:${port}`, () => readSandboxdKey(keyFile));
        await candidate.info();
        client = candidate;
      } catch { /* not up yet */ }
    }
    if (!client) throw new Error("the provisioner did not start");
    check("egress policy enforced on this Docker host", (await client.info()).egress === "enforced");

    const manager = new UserSandboxManager({ client, instance, stateFile: join(scratch, "deletions.json"), graceMs: 0 });
    const person = "pr_5a0d0e00-0000-4000-8000-00000000de5c";
    const names = sandboxNames(manager.keyFor(person));
    const tools = { exec: (input: Parameters<typeof manager.exec>[1]) => manager.exec(person, input), overQuota: () => manager.workspaceOverQuota(person) };
    const computer = (tool: string, args: Record<string, unknown> = {}) => callUserSandboxTool("computer_use", { tool_name: tool, arguments: args }, tools);
    const save = (name: string, result: ToolResult) => {
      const image = result.content.find((item) => item.type === "image");
      if (shots && image?.type === "image") { mkdirSync(shots, { recursive: true }); writeFileSync(join(shots, name), Buffer.from(image.data, "base64")); }
    };

    const plain = await callUserSandboxTool("run_command", { command: "pgrep -x Xvnc || echo none" }, tools);
    check("a plain shell turn starts no desktop", textOf(plain).startsWith("none"), textOf(plain).split("\n")[0]);

    const shot = await computer("screenshot");
    save("1-empty.jpg", shot);
    const first = shot.content[0];
    check("screenshot starts the desktop on demand and returns a JPEG", !shot.isError && first?.type === "image" && first.mimeType === "image/jpeg"
      && Buffer.from(first.data, "base64").subarray(0, 2).toString("hex") === "ffd8");
    check("screen size", textOf(await computer("get_screen_size")) === '{"width":1280,"height":800}');

    const vnc = await callUserSandboxTool("run_command", { command: "cat /proc/net/tcp | awk 'NR>1 && $4==\"0A\" {print $2}'" }, tools);
    const listeners = textOf(vnc).split("\n").map((line) => line.trim()).filter((line) => /^[0-9A-F]{8}:[0-9A-F]{4}$/.test(line));
    check("VNC listens on 127.0.0.1:5901 inside the sandbox only", listeners.includes("0100007F:170D") && listeners.filter((line) => line.endsWith(":170D")).length === 1, listeners.join(" "));
    const inspected = JSON.parse(execFileSync("docker", ["inspect", names.container], { encoding: "utf8" }))[0];
    check("no published port, read-only root, no capabilities", Object.keys(inspected.NetworkSettings.Ports ?? {}).length === 0
      && inspected.HostConfig.ReadonlyRootfs === true && JSON.stringify(inspected.HostConfig.CapAdd ?? []) === "[]"
      && (inspected.HostConfig.CapDrop ?? []).includes("ALL"));

    const opened = await computer("open_url", { url: "https://example.com/" });
    check("open_url opens Chromium on the desktop", !opened.isError, textOf(opened));
    await sleep(8000);
    save("2-example.jpg", await computer("screenshot"));
    const title = await callUserSandboxTool("run_command", { command: "DISPLAY=:1 xdotool search --onlyvisible --class sagax-desktop-browser getwindowname %@ 2>/dev/null | head -3" }, tools);
    check("Chromium shows example.com", /Example Domain/.test(textOf(title)), textOf(title).split("\n")[0]);

    // Click the address bar, type a URL and press Return.
    const click = await computer("click", { x: 400, y: 62 });
    const typed = await computer("type_text", { text: "https://example.org/" });
    const enter = await computer("key_press", { key: "Return" });
    check("click, type_text and key_press run", !click.isError && !typed.isError && !enter.isError, [textOf(click), textOf(typed), textOf(enter)].join(" / "));
    await sleep(6000);
    save("3-typed.jpg", await computer("screenshot"));
    const url = await callUserSandboxTool("run_command", { command: "DISPLAY=:1 xdotool search --onlyvisible --class sagax-desktop-browser getwindowname %@ 2>/dev/null | head -3" }, tools);
    check("typed address loaded (window title)", /Example Domain/.test(textOf(url)), textOf(url).split("\n")[0]);
    const scroll = await computer("scroll", { x: 640, y: 400, direction: "down", amount: 2 });
    check("scroll runs", !scroll.isError);
    const memory = execFileSync("docker", ["stats", "--no-stream", "--format", "{{.MemUsage}} pids={{.PIDs}}", names.container], { encoding: "utf8" }).trim();
    check("desktop with Chromium fits the memory limit", true, memory);

    // The Computer tab's usage panel and power controls, on real Docker.
    const stats = await manager.stats(person);
    check("stats: CPU against the quota, memory, disk and OS", stats.state === "running" && stats.cpuPercent !== null && (stats.memoryBytes ?? 0) > 50 * 1024 ** 2
      && stats.memoryLimitBytes === config.limits.memoryBytes && /Debian/.test(stats.os ?? "") && Boolean(stats.arch),
      `cpu ${stats.cpuPercent}%, mem ${Math.round((stats.memoryBytes ?? 0) / 1024 ** 2)} MiB of ${Math.round(stats.memoryLimitBytes / 1024 ** 2)}, ${stats.os} ${stats.arch}, ${stats.image}`);
    check("pause freezes it", (await manager.power(person, "pause")).state === "paused");
    const refused = await manager.exec(person, { argv: ["true"] }).then(() => "ran", (error: { code?: string }) => error.code ?? "error");
    check("a paused environment refuses bot work", refused === "paused", refused);
    check("resume", (await manager.power(person, "resume")).state === "running");
    const after = await callUserSandboxTool("run_command", { command: "pgrep -x Xvnc >/dev/null && echo desktop-alive" }, tools);
    check("the desktop survives pause and resume", textOf(after).startsWith("desktop-alive"));

    // The live view, through a local server: session auth, the real route,
    // the RFB stream through the provisioner.
    const sessions = new SessionRegistry({ file: join(scratch, "sessions.json") });
    const owner = sessions.issue({ label: "Owner", scopes: ["client"], principalId: person }).token;
    const other = sessions.issue({ label: "Other", scopes: ["client"], principalId: "pr_5a0d0e00-0000-4000-8000-00000000beef" }).token;
    viewer = createDesktopViewer({
      target: (id, auth) => {
        if (id !== SANDBOX_VIEWER_TARGET) return;
        const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : "";
        return principalId ? sandboxDesktopTarget(manager, principalId) : undefined;
      },
      live: (auth) => auth.kind === "session" && sessions.isLive(auth.session.id),
    });
    const handle = async (req: Parameters<typeof resolveRequestAuth>[0], res: Parameters<typeof json>[0]) => {
      const url = new URL(req.url!, "http://localhost");
      const gate = resolveRequestAuth(req, { sessions, cookieName: "s", url, streamPath: "/api/events", loopbackTrust: "service", features: { orgDirectory: true } });
      if (!gate.auth) return json(res, gate.status, { error: gate.error });
      await viewer!.route({ req, res, url, path: url.pathname, method: req.method!, auth: gate.auth, json, readBody });
    };
    app = createHttpServer((req, res) => void handle(req, res));
    viewer.attach(app, handle);
    const appPort = await freePort();
    await new Promise<void>((resolve) => app!.listen(appPort, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${appPort}`;
    const viewerConfig = await fetch(`${origin}/api/desktop-viewer/sandbox/me`, { headers: { cookie: `s=${owner}`, origin } });
    const body = await viewerConfig.json() as { password?: string; viewOnly?: boolean };
    check("owner opens the live view, read-only by default", viewerConfig.status === 200 && body.viewOnly === true && /^[A-Za-z0-9]{8}$/.test(body.password ?? ""));
    const control = await (await fetch(`${origin}/api/desktop-viewer/sandbox/me?control=1`, { headers: { cookie: `s=${owner}`, origin } })).json() as { password?: string; viewOnly?: boolean };
    check("take control hands the other password", control.viewOnly === false && control.password !== body.password);
    const ws = new WebSocket(`ws://127.0.0.1:${appPort}/api/desktop-viewer/sandbox/me/websockify`, { headers: { cookie: `s=${owner}`, origin } } as unknown as string[]);
    ws.binaryType = "arraybuffer";
    const received: Buffer[] = [];
    const greeting = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no RFB greeting")), 15_000);
      ws.onmessage = (event) => {
        received.push(Buffer.from(event.data as ArrayBuffer));
        const all = Buffer.concat(received).toString("latin1");
        if (all.length >= 12) { clearTimeout(timer); resolve(all.slice(0, 12)); }
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket failed")); };
    });
    check("the WebSocket carries the desktop's RFB greeting", greeting === "RFB 003.008\n", JSON.stringify(greeting));
    received.length = 0;
    ws.send(Buffer.from("RFB 003.008\n"));
    await sleep(500);
    const security = Buffer.concat(received);
    check("VNC asks for a password (VncAuth only)", security[0]! >= 1 && [...security.subarray(1, 1 + security[0]!)].includes(2) && ![...security.subarray(1, 1 + security[0]!)].includes(1), security.toString("hex"));
    ws.close();
    // Another person's session never reaches this desktop: theirs would be
    // created instead, so the check stops at the target's owner rule.
    const otherAuth = sessions.authenticate(other)!;
    check("another person's session is refused by this desktop's target", sandboxDesktopTarget(manager, person).allows!({ kind: "session", session: otherAuth, via: "cookie", scopes: otherAuth.scopes }) === false);

    // Idle stop closes the view; the WebSocket never restarts it.
    const ws2 = new WebSocket(`ws://127.0.0.1:${appPort}/api/desktop-viewer/sandbox/me/websockify`, { headers: { cookie: `s=${owner}`, origin } } as unknown as string[]);
    await new Promise((resolve) => { ws2.onopen = resolve; ws2.onerror = resolve; });
    const closed = new Promise<boolean>((resolve) => { ws2.onclose = () => resolve(true); setTimeout(() => resolve(false), 20_000); });
    await client.stop(manager.keyFor(person));
    check("the live view closes when the environment stops", await closed);
    const reopen = await new Promise<number>((resolve) => {
      const ws3 = new WebSocket(`ws://127.0.0.1:${appPort}/api/desktop-viewer/sandbox/me/websockify`, { headers: { cookie: `s=${owner}`, origin } } as unknown as string[]);
      ws3.onopen = () => { ws3.close(); resolve(101); };
      ws3.onerror = () => resolve(0);
    });
    check("a stopped environment is not started by the WebSocket", reopen !== 101 && (await manager.status(person)).state === "stopped");

    await manager.personOut(person);
    await manager.sweepDeletions();
    const leftovers = execFileSync("docker", ["ps", "-a", "-q", "--filter", `label=${SANDBOX_INSTANCE_LABEL}=${instance}`], { encoding: "utf8" }).trim();
    check("deleted: no container left", !leftovers);
  } finally {
    viewer?.closeAll();
    app?.closeAllConnections();
    app?.close();
    provisioner.kill("SIGTERM");
    const service = new SandboxService(docker, config);
    for (const row of await docker.listContainers({ [SANDBOX_INSTANCE_LABEL]: instance }).catch(() => [])) {
      const key = row.labels["com.pulsatrix.sagax.sandbox.user"];
      if (key) await service.remove(key).catch(() => {});
    }
    const uninstall = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/sandboxd.ts", "--uninstall-egress"], { env, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    uninstall.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    await new Promise((resolve) => uninstall.on("exit", resolve));
    check(`egress rules removed (chain ${egressChain(instance)})`, out.includes("sagax-egress-removed"));
    const volumes = execFileSync("docker", ["volume", "ls", "-q", "--filter", `label=${SANDBOX_INSTANCE_LABEL}=${instance}`], { encoding: "utf8" }).trim();
    const networks = execFileSync("docker", ["network", "ls", "-q", "--filter", `label=${SANDBOX_INSTANCE_LABEL}=${instance}`], { encoding: "utf8" }).trim();
    check("no volume or network left", !volumes && !networks);
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
