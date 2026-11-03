// The provisioner API: only the Sagax server (holder of the shared key) can
// call it, every request is signed over method, path and body, replays are
// refused, and the only addressable thing is a per-person sandbox key.
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SANDBOXD_AUTH_HEADER, SandboxdVerifier, signSandboxdRequest } from "./sandbox/sandboxd-auth.ts";
import { SandboxService } from "./sandbox/sandboxd-core.ts";
import { createSandboxdHandler, createSandboxdUpgradeHandler } from "./sandboxd.ts";
import { FakeDocker } from "./testing/fake-docker.ts";
import { sandboxdClient, SandboxdRequestError } from "./sandbox/user-sandbox-client.ts";
import { sandboxKeyForPrincipal, sandboxdConfigFromEnv } from "./sandbox/user-sandbox-spec.ts";

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);
const sandboxKey = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-000000000001");

let server: Server;
let base: string;
let docker: FakeDocker;
let service: SandboxService;

beforeEach(async () => {
  docker = new FakeDocker();
  const config = sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test" });
  service = new SandboxService(docker, config);
  await service.installEgressPolicy();
  const verifier = new SandboxdVerifier(KEY);
  server = createServer(createSandboxdHandler(service, verifier));
  server.on("upgrade", createSandboxdUpgradeHandler(service, verifier));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function raw(method: string, path: string, body = "", header?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(header === undefined ? {} : { [SANDBOXD_AUTH_HEADER]: header }) },
    ...(method === "GET" ? {} : { body }),
  });
  return { status: response.status, body: await response.json().catch(() => null) as Record<string, unknown> | null };
}

describe("sandboxd authorization", () => {
  it("answers health without auth but nothing else", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await raw("GET", "/v1/status")).status).toBe(401);
    expect((await raw("POST", `/v1/sandboxes/${sandboxKey}/ensure`, "{}")).status).toBe(401);
    expect(docker.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  });

  it("refuses a signature made with another key", async () => {
    const path = `/v1/sandboxes/${sandboxKey}/ensure`;
    expect((await raw("POST", path, "{}", signSandboxdRequest(OTHER_KEY, "POST", path, "{}"))).status).toBe(401);
  });

  it("binds the signature to the method, the path and the body", async () => {
    const path = `/v1/sandboxes/${sandboxKey}/exec`;
    const body = JSON.stringify({ argv: ["true"] });
    const signed = signSandboxdRequest(KEY, "POST", path, body);
    expect((await raw("POST", path, JSON.stringify({ argv: ["rm", "-rf", "/workspace"] }), signed)).status).toBe(401);
    const otherKey = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-000000000002");
    expect((await raw("POST", `/v1/sandboxes/${otherKey}/exec`, body, signed)).status).toBe(401);
    expect((await raw("DELETE", path, body, signed)).status).toBe(401);
  });

  it("refuses a replayed request and an expired one", async () => {
    const path = "/v1/status";
    const signed = signSandboxdRequest(KEY, "GET", path, "");
    expect((await raw("GET", path, "", signed)).status).toBe(200);
    expect((await raw("GET", path, "", signed)).status).toBe(401);
    expect((await raw("GET", path, "", signSandboxdRequest(KEY, "GET", path, "", Date.now() - 120_000))).status).toBe(401);
  });

  it("addresses only 32-hex person keys: no bot ids, no names, no traversal", async () => {
    for (const path of ["/v1/sandboxes/bot_123/ensure", "/v1/sandboxes/pr_00000000-0000-4000-8000-000000000001/ensure", `/v1/sandboxes/${sandboxKey.toUpperCase()}/ensure`, "/v1/bots/abc/ensure"]) {
      expect((await raw("POST", path, "{}", signSandboxdRequest(KEY, "POST", path, "{}"))).status).toBe(404);
    }
    // A dot segment is normalized away before it is sent, so its signature
    // no longer matches: refused either way, never acted on.
    const dotted = `/v1/sandboxes/${sandboxKey}/../${sandboxKey}/ensure`;
    expect((await raw("POST", dotted, "{}", signSandboxdRequest(KEY, "POST", dotted, "{}"))).status).toBe(401);
    expect(docker.containers.size).toBe(0);
  });

  it("serves the signed client end to end, and scopes every object by labels", async () => {
    const client = sandboxdClient(base, () => KEY);
    expect((await client.info()).egress).toBe("enforced");
    const ensured = await client.ensure(sandboxKey);
    expect(ensured.state).toBe("running");
    const result = await client.exec(sandboxKey, { argv: ["echo", "hi"] });
    expect(result.exitCode).toBe(0);
    expect(docker.execs[0]!.exec.User).toBe("1000:1000");
    expect(docker.execs[0]!.exec.Cmd.slice(0, 4)).toEqual(["timeout", "-k", "2", "120"]);
    await expect(client.exec(sandboxKey, { argv: ["true"], env: { PATH: "/evil" } })).rejects.toBeInstanceOf(SandboxdRequestError);
    // stdin travels as base64 and reaches the exec as bytes
    await client.exec(sandboxKey, { argv: ["head", "-c", "5"], stdinBase64: Buffer.from("héllo").toString("base64") });
    expect(docker.execs.find((entry) => entry.exec.Cmd.includes("head"))!.stdin?.toString("utf8")).toBe("héllo");
    expect(docker.execs[0]!.stdin).toBeUndefined();
    await expect(client.exec(sandboxKey, { argv: ["true"], stdinBase64: "not base64!" })).rejects.toBeInstanceOf(SandboxdRequestError);
    expect((await client.markUsed(sandboxKey)).state).toBe("running");
    expect((await client.remove(sandboxKey)).state).toBe("missing");
  });

  it("refuses to touch a same-named container it does not manage", async () => {
    await docker.createContainer(`sagax-user-${sandboxKey}`, { Labels: {} });
    const client = sandboxdClient(base, () => KEY);
    await expect(client.ensure(sandboxKey)).rejects.toMatchObject({ status: 409, code: "conflict" });
    await expect(client.remove(sandboxKey)).rejects.toMatchObject({ status: 409 });
    expect(docker.containers.has(`sagax-user-${sandboxKey}`)).toBe(true);
  });

  it("rejects a client URL that is not plain internal http", () => {
    expect(() => sandboxdClient("https://sandboxd:8791", () => KEY)).toThrow();
    expect(() => sandboxdClient("http://user:pw@sandboxd:8791", () => KEY)).toThrow();
    expect(() => sandboxdClient("http://sandboxd:8791/v1", () => KEY)).toThrow();
  });
});

/** A raw upgrade to the live view's stream, as the Sagax server sends it. */
function upgradeDesktop(path: string, header?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, {
      method: "POST",
      headers: { connection: "Upgrade", upgrade: "sagax-rfb", ...(header === undefined ? {} : { [SANDBOXD_AUTH_HEADER]: header }) },
    });
    req.on("upgrade", (res, socket) => { socket.destroy(); resolve({ status: res.statusCode ?? 0, body: "" }); });
    req.on("response", (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("sandboxd live view stream", () => {
  const path = `/v1/sandboxes/${sandboxKey}/desktop`;

  it("refuses an unsigned or replayed upgrade and never opens anything", async () => {
    expect((await upgradeDesktop(path)).status).toBe(401);
    const signed = signSandboxdRequest(KEY, "POST", path, "");
    await service.ensure(sandboxKey);
    expect((await upgradeDesktop(path, signed)).status).toBe(101);
    expect((await upgradeDesktop(path, signed)).status).toBe(401);
    expect((await upgradeDesktop(`${path}?control=1`, signed)).status).toBe(401);
  });

  it("never starts a stopped environment", async () => {
    expect((await upgradeDesktop(path, signSandboxdRequest(KEY, "POST", path, ""))).status).toBe(409);
    expect(docker.containers.size).toBe(0);
  });

  it("relays bytes to the desktop of that one sandbox, as uid 1000", async () => {
    await service.ensure(sandboxKey);
    const stream = await sandboxdClient(base, () => KEY).desktopStream(sandboxKey, { control: false });
    const banner = await new Promise<string>((resolve) => stream.once("data", (chunk: Buffer) => resolve(chunk.toString())));
    expect(banner).toBe("RFB 003.008\n");
    stream.write("hello");
    const echo = await new Promise<string>((resolve) => stream.once("data", (chunk: Buffer) => resolve(chunk.toString())));
    expect(echo).toBe("echo:hello");
    stream.destroy();
    const relay = docker.execs.at(-1)!;
    expect(relay.name).toBe(`sagax-user-${sandboxKey}`);
    expect(relay.exec).toMatchObject({ Cmd: ["sagax-desktop", "relay"], User: "1000:1000" });
  });

  it("answers the client with the provisioner's refusal code", async () => {
    await expect(sandboxdClient(base, () => KEY).desktopStream(sandboxKey, { control: true }))
      .rejects.toMatchObject({ status: 409, code: "not_running" });
  });
});

describe("sandboxd MCP server stream (a person's own command)", () => {
  it("starts the environment and runs the command as uid 1000 with its own variables", async () => {
    const stream = await sandboxdClient(base, () => KEY).stdioStream(sandboxKey, { argv: ["npx", "-y", "server-github"], env: { GITHUB_TOKEN: "t" } });
    const first = await new Promise<string>((resolve) => stream.once("data", (chunk: Buffer) => resolve(chunk.toString())));
    expect(first).toBe("RFB 003.008\n");
    stream.write("{\"jsonrpc\":\"2.0\"}\n");
    const echo = await new Promise<string>((resolve) => stream.once("data", (chunk: Buffer) => resolve(chunk.toString())));
    expect(echo).toBe("echo:{\"jsonrpc\":\"2.0\"}\n");
    stream.destroy();
    const relay = docker.execs.at(-1)!;
    expect(relay.name).toBe(`sagax-user-${sandboxKey}`);
    expect(relay.exec).toMatchObject({ Cmd: ["npx", "-y", "server-github"], User: "1000:1000", Env: ["GITHUB_TOKEN=t"], WorkingDir: "/workspace" });
  });

  it("refuses a command that does not match the signed digest", async () => {
    const path = `/v1/sandboxes/${sandboxKey}/stdio?digest=${"0".repeat(64)}`;
    const answer = await new Promise<string>((resolve, reject) => {
      const req = request(`${base}${path}`, { method: "POST", headers: { connection: "Upgrade", upgrade: "sagax-stdio", [SANDBOXD_AUTH_HEADER]: signSandboxdRequest(KEY, "POST", path, "") } });
      req.on("upgrade", (_res, socket) => {
        let text = "";
        socket.on("data", (chunk: Buffer) => { text += chunk.toString(); });
        socket.on("end", () => resolve(text));
        socket.write("{\"argv\":[\"sh\"]}\n");
      });
      req.on("response", () => reject(new Error("no upgrade")));
      req.on("error", reject);
      req.end();
    });
    expect(JSON.parse(answer.trim())).toMatchObject({ sagaxStdioError: "unauthorized" });
    expect(docker.execs).toEqual([]);
  });

  it("refuses an unsigned upgrade and variables that describe the environment", async () => {
    const path = `/v1/sandboxes/${sandboxKey}/stdio?digest=${"0".repeat(64)}`;
    const refused = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}${path}`, { method: "POST", headers: { connection: "Upgrade", upgrade: "sagax-stdio" } });
      req.on("response", (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 0); });
      req.on("error", reject);
      req.end();
    });
    expect(refused).toBe(401);
    await expect(service.stdioStream(sandboxKey, { argv: ["sh"], env: { PATH: "/tmp" } })).rejects.toMatchObject({ code: "bad_stdio" });
  });
});

describe("sandboxd terminal (the in-chat terminal)", () => {
  it("starts the environment, opens the sandbox user's login shell at the asked size and follows resizes", async () => {
    const tty = await sandboxdClient(base, () => KEY).ttyStream!(sandboxKey, { cols: 101, rows: 33 });
    const read = () => new Promise<string>((resolve) => tty.stream.once("data", (chunk: Buffer) => resolve(chunk.toString())));
    tty.stream.write("size\n");
    expect(await read()).toBe("size 101x33\n");
    tty.resize(140, 50);
    await new Promise((resolve) => setTimeout(resolve, 50));
    tty.stream.write("size\n");
    expect(await read()).toBe("size 140x50\n");
    tty.stream.write("ls\r");
    expect(await read()).toBe("tty:ls\r");
    tty.stream.destroy();
    const shell = docker.execs.at(-1)!;
    expect(shell.name).toBe(`sagax-user-${sandboxKey}`);
    expect(shell.exec).toMatchObject({ Cmd: ["/bin/bash", "-l"], User: "1000:1000", WorkingDir: "/workspace" });
    expect(docker.ttySizes).toEqual([{ cols: 101, rows: 33 }, { cols: 140, rows: 50 }]);
  });

  it("refuses an unsigned terminal and a bad size", async () => {
    const path = `/v1/sandboxes/${sandboxKey}/tty?cols=80&rows=24`;
    const unsigned = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}${path}`, { method: "POST", headers: { connection: "Upgrade", upgrade: "sagax-tty" } });
      req.on("response", (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 0); });
      req.on("error", reject);
      req.end();
    });
    expect(unsigned).toBe(401);
    // The client keeps the size in bounds before it signs the URL.
    const tty = await sandboxdClient(base, () => KEY).ttyStream!(sandboxKey, { cols: 1, rows: 24 });
    tty.stream.destroy();
    expect(docker.ttySizes).toEqual([{ cols: 2, rows: 24 }]);
  });
});
