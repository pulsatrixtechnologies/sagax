// Real-Electron check of the desktop bridge in server mode. A second local
// server plays the organization server (SAGAX_IDENTITY=perspicax, a fake
// Pulsatrix sign-in, a fake provisioner for server environments, the fake
// Claude CLI). The Electron side runs the app's own connector
// (electron/desktop-bridge.mjs) in a real main process, with Electron's own
// session, cookies, WebSocket and network stack:
//
//   1. a person attaches a file; the bot reads it ON THIS COMPUTER (copied to
//      the desktop's attachments folder, the path the bot is told), and the
//      engine's own HTTP reaches a "LAN" host only this desktop can resolve,
//      through the egress tunnel;
//   2. the desktop disconnects; the same request runs in the person's server
//      environment (the mock provisioner), the file copied to
//      /workspace/attachments.
//
// Isolated: temporary home and Electron profile, free ports (never 18790,
// 5199 or 8799).
//
//   node --experimental-strip-types scripts/verify/dev/verify-desktop-bridge.ts
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SandboxdVerifier } from "../../../server/sandboxd-auth.ts";
import { SandboxService } from "../../../server/sandboxd-core.ts";
import { createSandboxdHandler } from "../../../server/sandboxd.ts";
import { FakeDocker } from "../../../server/testing/fake-docker.ts";
import { startFakeOidcProvider } from "../../../server/testing/fake-oidc-provider.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";
import { sandboxdConfigFromEnv } from "../../../server/user-sandbox-spec.ts";

// The echo is plain text, never HTML: the request path it repeats cannot
// become markup in whatever reads it.
const PLAIN_TEXT = { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } as const;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const electron = createRequire(import.meta.url)("electron") as unknown as string;
const RESERVED = [18790, 5199, 8799];
const FAKE_CLAUDE = join(ROOT, "server", "testing", "fake-claude-cli.ts");
const SANDBOXD_KEY = "e".repeat(64);
const INSTANCE = "verify-bridge";

const checks: boolean[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push(ok);
  console.log(`[verify] ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

// The "LAN" host: a server on this machine that only the desktop's resolver
// knows as intranet.sagax.test (10.77.0.5 there, mapped to it below).
const lan = createServer((req, res) => res.writeHead(200, PLAIN_TEXT).end(`lan says hi to ${req.url}`));
await new Promise<void>((resolve) => lan.listen(0, "127.0.0.1", resolve));
const lanPort = (lan.address() as AddressInfo).port;

const docker = new FakeDocker();
const service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test", SAGAX_SANDBOX_INSTANCE: INSTANCE }));
await service.installEgressPolicy();
const provisioner = createServer(createSandboxdHandler(service, new SandboxdVerifier(SANDBOXD_KEY)));
await new Promise<void>((resolve) => provisioner.listen(0, "127.0.0.1", resolve));

const ada = { sub: "01J9VERIFYBRIDGE0000000000", email: "ada@example.test", name: "Ada", preferred_username: "ada", role: "admin" };
const idp = await startFakeOidcProvider({ user: ada });
idp.directoryPeople = [idp.personOf(ada)];
const port = await freePortBlock([0, 1]);
if (RESERVED.includes(port) || RESERVED.includes(port + 1)) throw new Error("reserved port, run again");
const origin = `http://127.0.0.1:${port}`;
const home = mkdtempSync(join(tmpdir(), "omb-verify-bridge-"));
const data = join(home, ".openmausbot");
mkdirSync(data, { recursive: true });
mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
  version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin, link_token: idp.linkToken,
}), { mode: 0o640 });
writeFileSync(join(home, "sandboxd-key"), `${SANDBOXD_KEY}\n`, { mode: 0o400 });
const mcpDump = join(home, "mcp-dump.json");
const prompts = join(home, "prompts.jsonl");
chmodSync(FAKE_CLAUDE, 0o755);
writeFileSync(join(data, "config.json"), JSON.stringify({
  organization: { memberBotsUseOrgKey: true },
  instances: {
    claude: {
      driver: "claudeAgent",
      environment: {
        FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
          { server: "sagax-desktop", tool: "read_file", arguments: { path: "$ATTACHED_FILE" }, when: "read the attachment" },
          { server: "sagax-environment", tool: "read_file", arguments: { path: "$ATTACHED_FILE" }, when: "read the attachment" },
        ]),
        FAKE_CLAUDE_MCP_DUMP: mcpDump,
        FAKE_CLAUDE_PROMPTS: prompts,
        FAKE_CLAUDE_PROXY_FETCH: "http://intranet.sagax.test/hello",
      },
      config: { cli: FAKE_CLAUDE, fullAuto: true },
    },
  },
}));
let serverLog = "";
const server: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
    SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: origin,
    SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"), SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key-000000", SAGAX_ORG_NAME: "Acme",
    SAGAX_SANDBOXD_URL: `http://127.0.0.1:${(provisioner.address() as AddressInfo).port}`,
    SAGAX_SANDBOXD_KEY_FILE: join(home, "sandboxd-key"), SAGAX_SANDBOX_INSTANCE: INSTANCE,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout!.on("data", (c) => (serverLog += c));
server.stderr!.on("data", (c) => (serverLog += c));
const deadline = Date.now() + 30_000;
for (;;) {
  try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* not yet */ }
  if (Date.now() > deadline) throw new Error(`server never came up:\n${serverLog}`);
  await new Promise((r) => setTimeout(r, 200));
}
console.log(`[verify] organization server ${origin}`);

// Sign in as Ada (the system browser's part, played with fetch); the desktop
// gets the resulting session cookie in its own cookie jar.
const pair = (setCookie: string) => setCookie.split(";")[0]!;
const start = await fetch(`${origin}/auth/oidc/start`, { redirect: "manual" });
const binding = pair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
const cookie = pair(callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="))!);

const userData = mkdtempSync(join(tmpdir(), "omb-verify-bridge-ud-"));
const attachmentsDir = join(home, "desktop-temp", "Sagax", "attachments");
const code = await new Promise<number>((resolve) => {
  const child = spawn(electron, [join(ROOT, "scripts", "verify", "dev", "verify-desktop-bridge.electron.mjs"), `--user-data-dir=${userData}`], {
    env: {
      ...process.env, VERIFY_ORIGIN: origin, VERIFY_COOKIE: cookie, VERIFY_LAN_PORT: String(lanPort),
      VERIFY_MCP_DUMP: mcpDump, VERIFY_PROMPTS: prompts, VERIFY_ATTACHMENTS: attachmentsDir, VERIFY_HOME: join(home, "desktop-home"),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (status) => resolve(status ?? 1));
});
check("the Electron side passed its checks", code === 0, `exit ${code}`);
const copied = docker.execs.some((entry) => entry.exec.Env.some((value) => /^SAGAX_PATH=\/workspace\/attachments\/[0-9a-f]{8}-later\.md$/.test(value)));
check("with the desktop disconnected, the attachment was copied into the person's server environment", copied);
check("nothing ran in a server environment while the desktop was connected", docker.execs.filter((entry) => entry.exec.Env.some((value) => value.includes("README"))).length === 0);

server.kill("SIGTERM");
await new Promise((r) => setTimeout(r, 500));
await idp.close();
provisioner.close();
lan.close();
rmSync(home, { recursive: true, force: true });
rmSync(userData, { recursive: true, force: true });
const failed = checks.filter((ok) => !ok).length;
console.log(failed ? `[verify] ${failed} check(s) FAILED` : "[verify] desktop bridge: all checks passed");
if (failed) console.log(serverLog.slice(-4000));
process.exit(failed ? 1 : 0);
