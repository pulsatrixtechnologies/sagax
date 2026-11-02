// Real-Electron measure of the desktop mascot's chat: open latency, window
// resizes, dropped frames and long tasks while a reply streams, while the
// mascot is dragged and while the balloon is resized; then the balloon's
// colors under two app skins and Trombi's retro look.
// Isolated: its own Vite server on a free port, a temporary Electron profile;
// it starts no Sagax server and touches no running app. It drives the real
// controller (electron/floating-bot-window.mjs) and the real floating page.
//
//   node scripts/verify/dev/verify-mascot-chat.mjs [report.json]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// ports other copies of the app use in development
const RESERVED = new Set([18790, 5199, 8799]);
const profile = mkdtempSync(join(tmpdir(), "mascot-chat-electron-"));
const out = resolve(process.argv[2] ?? join(profile, "report.json"));

const freePort = () =>
  new Promise((done) => {
    const probe = netServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
let port = await freePort();
while (RESERVED.has(port)) port = await freePort();

const vite = await createServer({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), server: { port, strictPort: true, host: "127.0.0.1", open: false }, logLevel: "warn" });
await vite.listen();
const electron = createRequire(import.meta.url)("electron");
const code = await new Promise((done) => {
  const child = spawn(electron, [join(ROOT, "scripts", "verify", "dev", "verify-mascot-chat.electron.mjs"), `--user-data-dir=${profile}`], {
    env: { ...process.env, VERIFY_ORIGIN: `http://127.0.0.1:${port}`, VERIFY_OUT: out },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (status) => done(status ?? 1));
});
await vite.close();
try {
  console.log(readFileSync(out, "utf8"));
} catch {
  /* the Electron side failed before writing */
}
process.exit(code);
