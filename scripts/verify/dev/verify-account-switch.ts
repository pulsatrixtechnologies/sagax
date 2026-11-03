// Real-Electron measure of switching between Personal (this computer's own
// server) and an organization server, the way the account menu does it. Two
// real Sagax servers play the two accounts: a solo one serving the built UI,
// and an organization one signing people in with a fake Pulsatrix (OIDC),
// drawn with this app's bundle (electron/bundled-ui.cjs). The Electron side
// (verify-account-switch.electron.mjs) signs in once, then switches back and
// forth and times each switch until the account's app is painted.
//
//   pnpm exec vite build
//   node --experimental-strip-types scripts/verify/dev/verify-account-switch.ts [--mode reload|contexts|both] [--shots DIR]
//
// --mode reload   the old switch: the window loads the other server's page
// --mode contexts the switch of electron/page-contexts.mjs: one page per account
// Isolated: temporary homes and Electron profiles, free ports, no window on
// screen (the window is never shown).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOidcProvider } from "../../../server/testing/fake-oidc-provider.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const electron = createRequire(import.meta.url)("electron") as unknown as string;
const RESERVED = [18790, 5199, 8799];
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const modeArg = arg("--mode") ?? "both";
const modes = modeArg === "both" ? ["reload", "contexts"] : [modeArg];
const shots = arg("--shots") ?? "";

const temporary: string[] = [];
const scratch = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(dir);
  return dir;
};
// Onboarding done and No server chosen: the app opens on its home, not on the
// welcome tour or the launch screen.
const readyConfig = JSON.stringify({ onboarding: { completedAt: "2026-10-01T00:00:00.000Z", version: 1, launchMode: "solo", reelSeen: true }, language: "en" });

const children: ChildProcess[] = [];
async function startServer(name: string, env: (origin: string) => Record<string, string>): Promise<{ origin: string; proc: ChildProcess; log: () => string }> {
  const port = await freePortBlock([0, 1], name === "personal" ? 21_000 : 24_000);
  if (RESERVED.includes(port) || RESERVED.includes(port + 1)) throw new Error("reserved port, run again");
  // Two hosts, as in real use (Personal on 127.0.0.1, a server on its own
  // domain): cookies belong to a host, not to a port.
  const origin = `http://${name === "personal" ? "127.0.0.1" : "localhost"}:${port}`;
  const home = scratch(`omb-switch-${name}-`);
  mkdirSync(join(home, ".sagax"), { recursive: true });
  writeFileSync(join(home, ".sagax", "config.json"), readyConfig);
  let output = "";
  const proc = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1), SAGAX_CONTENT_ENCRYPTION: "0", ...env(origin) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(proc);
  proc.stdout!.on("data", (chunk) => (output += chunk));
  proc.stderr!.on("data", (chunk) => (output += chunk));
  const deadline = Date.now() + 45_000;
  for (;;) {
    try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* not yet */ }
    if (Date.now() > deadline) {
      for (const child of children) child.kill("SIGTERM");
      throw new Error(`${name} server never came up:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { origin, proc, log: () => output };
}

const idp = await startFakeOidcProvider({ user: { sub: "01J9VERIFYACCOUNTSWITCH0000", email: "ada@example.test", name: "Ada", preferred_username: "ada", role: "employee" } });
const decoy = scratch("omb-switch-decoy-");
writeFileSync(join(decoy, "index.html"), "<!doctype html><title>SERVER IMAGE UI</title><p>served by the server</p>");
const personal = await startServer("personal", () => ({ SAGAX_STATIC_DIR: join(ROOT, "dist"), SAGAX_DEV_TRUST_LOCAL_BROWSER: "1" }));
console.log(`[verify] Personal (this computer) ${personal.origin}`);
// The organization server: its first sign-in makes the person, its page is this app's bundle.
const org = await startServer("org", (self) => ({ SAGAX_STATIC_DIR: decoy, SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: self }));
console.log(`[verify] organization server ${org.origin}`);
// A bot on Personal, so each account shows its own.
await fetch(`${personal.origin}/api/bots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Solo heron" }) });

let failed = false;
for (const mode of modes) {
  const userData = scratch(`omb-switch-ud-${mode}-`);
  const code = await new Promise<number>((resolve) => {
    const child = spawn(electron, [join(ROOT, "scripts", "verify", "dev", "verify-account-switch.electron.mjs"), `--user-data-dir=${userData}`], {
      env: { ...process.env, VERIFY_MODE: mode, VERIFY_PERSONAL: personal.origin, VERIFY_ORIGIN: org.origin, VERIFY_BUNDLE: join(ROOT, "dist"), VERIFY_SHOT_DIR: shots ? join(shots, mode) : "" },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("exit", (status) => resolve(status ?? 1));
  });
  if (code !== 0) failed = true;
}
const exited = (proc: ChildProcess) => new Promise((resolve) => (proc.exitCode !== null ? resolve(null) : proc.once("exit", resolve)));
for (const child of children) child.kill("SIGTERM");
await Promise.all(children.map(exited));
await idp.close();
// A server's own helpers may still be writing a moment after it exits.
for (const dir of temporary) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left in the temporary folder */ }
}
if (/(?:sgx|omb)_pair_[A-Za-z0-9_-]{43}/.test(org.log() + personal.log())) {
  console.log("[verify] FAIL: a credential reached a server log");
  process.exit(1);
}
process.exit(failed ? 1 : 0);
