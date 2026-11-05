// Real-Electron check of "Sign in with Pulsatrix" through the loopback
// return, against a real organization server (a second local server acting
// as the remote environment) and the fake Perspicax. Isolated: temporary
// home and Electron profile, free ports.
//
//   pnpm exec vite build
//   node --experimental-strip-types scripts/verify/dev/verify-desktop-sign-in.ts [--old-target]
//
// --old-target delivers the credential the way 0.3.x did (/pair#code=... on
// a window already showing /pair), which is expected to stay signed out.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOidcProvider } from "../../../server/testing/fake-oidc-provider.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const oldTarget = process.argv.includes("--old-target");
const electron = createRequire(import.meta.url)("electron") as unknown as string;

const idp = await startFakeOidcProvider({ user: { sub: "01J9VERIFYDESKTOP000000000", email: "ada@example.test", name: "Ada", preferred_username: "ada", role: "admin" } });
const port = await freePortBlock([0, 1]);
if ([18790, 5199, 8799].includes(port) || [18790, 5199, 8799].includes(port + 1)) throw new Error("reserved port, run again");
const origin = `http://127.0.0.1:${port}`;
const home = mkdtempSync(join(tmpdir(), "omb-verify-desktop-"));
mkdirSync(join(home, ".sagax"), { recursive: true });
writeFileSync(join(home, ".sagax", "config.json"), "{}");
let serverLog = "";
const server: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
    SAGAX_STATIC_DIR: join(ROOT, "dist"), SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: origin,
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
const env = await (await fetch(`${origin}/.well-known/openmausbot/environment`)).json() as { label: string };
console.log(`[verify] remote environment ${origin}, label "${env.label}"`);

const userData = mkdtempSync(join(tmpdir(), "omb-verify-desktop-ud-"));
const code = await new Promise<number>((resolve) => {
  const child = spawn(electron, [join(ROOT, "scripts", "verify", "dev", "verify-desktop-sign-in.electron.cjs"), `--user-data-dir=${userData}`], {
    env: { ...process.env, VERIFY_ORIGIN: origin, VERIFY_OLD_TARGET: oldTarget ? "1" : "" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (status) => resolve(status ?? 1));
});
server.kill("SIGTERM");
await idp.close();
if (serverLog.match(/omb_pair_[A-Za-z0-9_-]{43}/)) {
  console.log("[verify] FAIL: a credential reached the server log");
  process.exit(1);
}
process.exit(code);
