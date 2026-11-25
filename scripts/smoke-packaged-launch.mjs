// Launch the PACKAGED desktop app and require its main window to load the
// local server within 60 s. 0.4.0 shipped a startup that threw before
// createWindow(): every server smoke passed while the app spun forever on its
// startup screen. Run it on the host arch before notarizing.
//
//   node scripts/smoke-packaged-launch.mjs --app release/mac-arm64/Sagax.app
//   node scripts/smoke-packaged-launch.mjs --app ... --user-data-copy "<an existing userData folder>"
//
// Everything runs in a disposable HOME, userData and data folder. With
// --user-data-copy the folder is COPIED first (caches and locks left out);
// the original is only read. The built-in SAGAX_SMOKE_TEST hook prints
// "[smoke] renderer-ready" once the window's renderer reached the server.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { app: { type: "string" }, "user-data-copy": { type: "string" }, timeout: { type: "string", default: "60" } },
});
if (!values.app) throw new Error("Usage: node scripts/smoke-packaged-launch.mjs --app <Sagax.app | Sagax.exe> [--user-data-copy DIR] [--timeout 60]");
const app = resolve(values.app);
const executable = app.endsWith(".app") ? join(app, "Contents", "MacOS", basename(app, ".app")) : app;
if (!existsSync(executable)) throw new Error(`No packaged executable at ${executable}`);

const SKIP = new Set(["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "blob_storage", "Crashpad",
  "SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"]);
const scratch = mkdtempSync(join(tmpdir(), "sagax-launch-smoke-"));
const home = join(scratch, "home");
const userData = join(scratch, "userData");
const dataDir = join(scratch, "data");
mkdirSync(home, { recursive: true });
mkdirSync(dataDir, { recursive: true });
if (values["user-data-copy"]) {
  const source = resolve(values["user-data-copy"]);
  cpSync(source, userData, { recursive: true, filter: (from) => !SKIP.has(basename(from)) || from === source });
} else mkdirSync(userData, { recursive: true });

const timeoutMs = Number(values.timeout) * 1000;
const args = [`--user-data-dir=${userData}`];
if (process.platform === "darwin") args.push("--use-mock-keychain");
if (process.platform === "linux") args.push("--password-store=basic");
const child = spawn(executable, args, {
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    HOME: home,
    // Windows known folders require the native OS profile. userData and Sagax data remain disposable.
    SAGAX_DATA_DIR: dataDir,
    SAGAX_SMOKE_TEST: "1",
    SAGAX_SMOKE_CUA: "0",
  },
});

let output = "";
const started = Date.now();
const result = await new Promise((done) => {
  const timer = setTimeout(() => done({ ok: false, reason: `no main window renderer within ${values.timeout} s` }), timeoutMs);
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output += chunk;
      const ready = output.match(/\[smoke\] renderer-ready (\{.*\})\r?\n/);
      const failed = output.match(/\[smoke\] renderer-failed (.*)\r?\n/);
      if (ready) { clearTimeout(timer); done({ ok: true, detail: JSON.parse(ready[1]) }); }
      else if (failed) {
        clearTimeout(timer);
        // A userData in exclusive server mode opens its organization server,
        // not the local one: the main window exists and loaded that origin.
        const remote = failed[1].match(/unexpected packaged renderer URL: (https:\/\/[^/\s]+)\//);
        done(remote ? { ok: true, detail: { location: `${remote[1]}/ (server mode)`, health: { product: "remote" } } }
          : { ok: false, reason: `renderer failed: ${failed[1]}` });
      }
    });
  }
  child.on("exit", (code, signal) => { clearTimeout(timer); done({ ok: false, reason: `app exited (${code ?? signal}) before its main window loaded` }); });
});

function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
}
if (!result.ok && process.platform === "win32") {
  const reporter = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "scripts/verify/release/windows-launch-diagnostics.ps1", String(child.pid)], { encoding: "utf8", timeout: 10000 });
  for (const line of (reporter.stdout ?? "").split(/\r?\n/)) if (/^QA_DIAG [a-zA-Z0-9 =|@_./:_-]+$/.test(line)) console.error(line);
  console.error("QA_DIAG exitCode=" + (child.exitCode ?? "running"));
}
stop();
await new Promise((r) => setTimeout(r, 3000));
if (process.platform !== "win32") { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
if (!result.ok && process.platform === "win32") {
  const phases = ["reading saved credentials", "preparing the credential store", "starting the local server", "local server ready", "local server failed to start", "opening the workspace", "workspace window created"];
  const roots = [userData, dataDir, join(process.env.APPDATA, "openmausbot"), join(process.env.APPDATA, "Sagax")];
  const observed = new Set();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true })) {
      if (basename(entry) !== "server.log") continue;
      const log = readFileSync(join(root, entry), "utf8");
      for (const phase of phases) if (log.includes("startup: " + phase)) observed.add(phase);
    }
  }
  // Only enumerated markers and counts enter public job output.
  console.error("QA_DIAG phases=" + [...observed].join("|") + " stdoutBytes=" + output.length);
  console.error("QA_DIAG " + (output.includes("[smoke] renderer-failed") ? "renderer-failed" : output.includes("[smoke] renderer-ready") ? "renderer-ready" : "no-renderer-marker"));
}
rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });

const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (!result.ok) {
  console.error(`packaged launch FAILED (${seconds} s): ${result.reason}\n--- app output (tail) ---\n${output.slice(-4000)}`);
  process.exit(1);
}
console.log(`packaged launch ok in ${seconds} s${values["user-data-copy"] ? " (copied userData)" : " (fresh userData)"}: ${result.detail.location} product=${result.detail.health?.product ?? "?"}`);
