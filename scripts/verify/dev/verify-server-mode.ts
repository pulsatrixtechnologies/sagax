// Real-Electron check of server mode's UI: the desktop draws ITS OWN bundled
// UI on an organization server's origin (electron/bundled-ui.cjs), signs in
// through the loopback return, talks to that server's API with its session,
// and floats one of that server's bots as a desktop mascot whose state comes
// from the server. A second local server plays the remote environment and
// serves a decoy page of its own, so the check can tell which UI is shown.
// Isolated: temporary home and Electron profile, free ports.
//
//   pnpm exec vite build
//   node --experimental-strip-types scripts/verify/dev/verify-server-mode.ts [--dev]
//
// --dev serves the UI from a Vite dev server on a free port, as the dev app
// does, instead of the built bundle.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOidcProvider } from "../../../server/testing/fake-oidc-provider.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const electron = createRequire(import.meta.url)("electron") as unknown as string;
const RESERVED = [18790, 5199, 8799];

const idp = await startFakeOidcProvider({ user: { sub: "01J9VERIFYSERVERMODE000000", email: "ada@example.test", name: "Ada", preferred_username: "ada", role: "admin" } });
const port = await freePortBlock([0, 1]);
if (RESERVED.includes(port) || RESERVED.includes(port + 1)) throw new Error("reserved port, run again");
const origin = `http://127.0.0.1:${port}`;
const home = mkdtempSync(join(tmpdir(), "omb-verify-servermode-"));
mkdirSync(join(home, ".sagax"), { recursive: true });
writeFileSync(join(home, ".sagax", "config.json"), "{}");
// The server's own page: what a remote environment used to show.
const decoy = mkdtempSync(join(tmpdir(), "omb-verify-servermode-decoy-"));
writeFileSync(join(decoy, "index.html"), "<!doctype html><title>SERVER IMAGE UI</title><p>served by the server</p>");
let serverLog = "";
const server: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
    SAGAX_STATIC_DIR: decoy, SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: origin,
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
console.log(`[verify] organization server ${origin} (serves a decoy page of its own)`);

let vite: ChildProcess | null = null;
let devOrigin = "";
if (process.argv.includes("--dev")) {
  const vitePort = await freePortBlock([0]);
  if (RESERVED.includes(vitePort)) throw new Error("reserved port, run again");
  devOrigin = `http://127.0.0.1:${vitePort}`;
  vite = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--port", String(vitePort), "--strictPort", "--host", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  const viteDeadline = Date.now() + 30_000;
  for (;;) {
    try { if ((await fetch(`${devOrigin}/`)).ok) break; } catch { /* not yet */ }
    if (Date.now() > viteDeadline) throw new Error("vite never came up");
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`[verify] UI from Vite at ${devOrigin}`);
}
const userData = mkdtempSync(join(tmpdir(), "omb-verify-servermode-ud-"));
const code = await new Promise<number>((resolve) => {
  const child = spawn(electron, [join(ROOT, "scripts", "verify", "dev", "verify-server-mode.electron.mjs"), `--user-data-dir=${userData}`], {
    env: { ...process.env, VERIFY_ORIGIN: origin, VERIFY_BUNDLE: join(ROOT, "dist"), VERIFY_DEV_ORIGIN: devOrigin },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (status) => resolve(status ?? 1));
});
server.kill("SIGTERM");
vite?.kill("SIGTERM");
await idp.close();
if (serverLog.match(/omb_pair_[A-Za-z0-9_-]{43}/)) {
  console.log("[verify] FAIL: a credential reached the server log");
  process.exit(1);
}
process.exit(code);
