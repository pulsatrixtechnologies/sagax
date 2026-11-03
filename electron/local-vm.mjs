// The Local VM on this computer, desktop side (server mode): the Sagax Linux
// desktop container the person's bots can use, reached through the desktop
// bridge (electron/desktop-bridge.mjs, server/desktop/desktop-bridge-routes.ts).
//
// What it does, and what it never does:
// - Finds the container runtime this computer has (Docker Desktop, OrbStack,
//   Colima, Rancher Desktop, Podman, plain Docker), even when the app was
//   opened from the Dock with a bare PATH, and says which one it found.
// - Only ever touches containers labeled com.openmausbot.local-vm=1.
// - Never starts a container bound to another folder than this app's data
//   dir (`<data>/vm-home`) or to a folder that no longer exists (a test's
//   deleted temp home once left one like that): it is "stale", and setup
//   recreates it, keeping the files of the folder it was bound to.
// - Setup (one click) runs in the background with visible steps: start the
//   runtime if it is installed but stopped, prepare the image, create the
//   container from the server's own recipe (server/computer/container-computer.ts
//   localVmDesktopSpec, checked here), start it. Idempotent.
// - Installs nothing by itself: an install opens the vendor's download page,
//   or runs Homebrew, only after the person confirms in an OS dialog.
// - A bot may ask to create the Local VM when none exists (`create`, the
//   local_vm tool's create): the same setup from the server's recipe, only
//   after the person said yes on this computer (`confirmCreate`, the desktop
//   app's own prompt), with its steps sent to the turn. A stale VM is never
//   repaired this way: the person repairs it from the Computer tab.
// - A bot drives this VM's own desktop (`computer`, the local_vm tool's use):
//   a fixed `cua-driver call` as user cua. The allow-list is
//   local-vm-computer.mjs. Never a shell line, never a path the bot chose,
//   never this computer's own screen.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { localVmComputerCall } from "./local-vm-computer.mjs";

export const LOCAL_VM_LABEL = "com.openmausbot.local-vm";
export const WORKSPACE_PATH_LABEL = "com.openmausbot.workspace-path";
export const TEST_RUN_LABEL = "com.openmausbot.test-run";
export const REAL_CONTAINER = "openmausbot-computer";
/** An unused Local VM stops after 10 minutes (its folder stays). */
export const LOCAL_VM_IDLE_STOP_MS = 10 * 60_000;
const WORKSPACE_PLACEHOLDER = "__SAGAX_WORKSPACE__";
const PASSWORD_PLACEHOLDER = "__SAGAX_VNC_PW__";
const CUA_EXECUTABLE = "/usr/local/libexec/openmausbot/cua-driver";
const CUA_SOCKET = "/run/user/1000/openmausbot-cua.sock";
const CUA_PREVIEW = "/tmp/openmausbot-preview.png";
const CUA_EXEC_ENV = ["-u", "cua", "-e", "HOME=/home/cua", "-e", "DISPLAY=:1", "-e", "CUA_DRIVER_INSTALL_CHANNEL=python_package", "-e", "CUA_DRIVER_RS_TELEMETRY_ENABLED=0"];
const OUTPUT_LIMIT = 256 * 1024;

const text = value => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });

/** Run one program with arguments (never a shell line). */
export function execArgv(argv, { timeoutSeconds = 60, env = process.env } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String(error?.message ?? error) });
      return;
    }
    const out = []; const err = []; let bytes = 0;
    const take = target => chunk => { bytes += chunk.length; if (bytes <= OUTPUT_LIMIT * 8) target.push(chunk); };
    child.stdout.on("data", take(out));
    child.stderr.on("data", take(err));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutSeconds * 1000);
    child.once("error", error => { clearTimeout(timer); resolve({ code: -1, stdout: "", stderr: String(error?.message ?? error) }); });
    child.once("close", code => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
  });
}

/** Where container CLIs live when PATH does not say (an app opened from the
 * Dock gets /usr/bin:/bin only). */
export function runtimeCandidates({ home = os.homedir(), platform = process.platform } = {}) {
  if (platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    return [
      { runtime: "docker", cli: "docker" },
      { runtime: "docker", cli: path.win32.join(programFiles, "Docker", "Docker", "resources", "bin", "docker.exe") },
      { runtime: "docker", cli: path.win32.join(programFiles, "Rancher Desktop", "resources", "resources", "win32", "bin", "docker.exe") },
      { runtime: "podman", cli: "podman" },
      { runtime: "podman", cli: path.win32.join(programFiles, "RedHat", "Podman", "podman.exe") },
    ];
  }
  return [
    { runtime: "docker", cli: "docker" },
    { runtime: "docker", cli: "/usr/local/bin/docker" },
    { runtime: "docker", cli: "/opt/homebrew/bin/docker" },
    { runtime: "docker", cli: path.join(home, ".orbstack", "bin", "docker") },
    { runtime: "docker", cli: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker" },
    { runtime: "docker", cli: "/Applications/Docker.app/Contents/Resources/bin/docker" },
    { runtime: "docker", cli: path.join(home, ".rd", "bin", "docker") },
    { runtime: "docker", cli: "/usr/bin/docker" },
    { runtime: "podman", cli: "podman" },
    { runtime: "podman", cli: "/opt/podman/bin/podman" },
    { runtime: "podman", cli: "/opt/homebrew/bin/podman" },
    { runtime: "podman", cli: "/usr/local/bin/podman" },
    { runtime: "podman", cli: "/usr/bin/podman" },
  ];
}

/** Sockets and apps that show a runtime is installed even when its CLI is
 * not found or its engine is stopped. */
export function runtimeFootprints({ home = os.homedir(), platform = process.platform, env = process.env } = {}) {
  const list = [];
  if (env.DOCKER_HOST) list.push({ product: productFromEndpoint(env.DOCKER_HOST) ?? "Docker", path: env.DOCKER_HOST, kind: "socket" });
  if (platform === "win32") {
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    list.push(
      { product: "Docker Desktop", path: path.win32.join(programFiles, "Docker", "Docker", "Docker Desktop.exe"), kind: "app" },
      { product: "Rancher Desktop", path: path.win32.join(programFiles, "Rancher Desktop", "Rancher Desktop.exe"), kind: "app" },
      { product: "Podman", path: path.win32.join(programFiles, "RedHat", "Podman", "podman.exe"), kind: "app" },
    );
    return list;
  }
  list.push(
    { product: "Docker Desktop", path: path.join(home, ".docker", "run", "docker.sock"), kind: "socket" },
    { product: "OrbStack", path: path.join(home, ".orbstack", "run", "docker.sock"), kind: "socket" },
    { product: "Colima", path: path.join(home, ".colima", "default", "docker.sock"), kind: "socket" },
    { product: "Rancher Desktop", path: path.join(home, ".rd", "docker.sock"), kind: "socket" },
    { product: "Docker", path: "/var/run/docker.sock", kind: "socket" },
  );
  if (platform === "darwin") {
    list.push(
      { product: "Docker Desktop", path: "/Applications/Docker.app", kind: "app" },
      { product: "OrbStack", path: "/Applications/OrbStack.app", kind: "app" },
      { product: "Rancher Desktop", path: "/Applications/Rancher Desktop.app", kind: "app" },
      { product: "Podman", path: "/Applications/Podman Desktop.app", kind: "app" },
      { product: "Colima", path: "/opt/homebrew/bin/colima", kind: "app" },
      { product: "Colima", path: "/usr/local/bin/colima", kind: "app" },
    );
  }
  return list;
}

/** Which product serves a Docker endpoint (a context's host or DOCKER_HOST). */
export function productFromEndpoint(endpoint, osName = "") {
  const value = String(endpoint ?? "").toLowerCase();
  const name = String(osName ?? "").toLowerCase();
  if (value.includes("orbstack") || name.includes("orbstack")) return "OrbStack";
  if (value.includes(".colima") || name.includes("colima")) return "Colima";
  if (value.includes("/.rd/") || value.includes("rancher") || name.includes("rancher")) return "Rancher Desktop";
  if (value.includes("podman") || name.includes("podman")) return "Podman";
  if (value.includes(".docker/run/docker.sock") || value.includes("docker_engine") || value.includes("docker-desktop") || name.includes("docker desktop")) return "Docker Desktop";
  if (value) return "Docker";
  return null;
}

/** The runtime this computer has: its CLI, whether its engine answers, the
 * product, and what else is installed. */
export async function detectRuntime({ exec = execArgv, home = os.homedir(), platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const footprints = runtimeFootprints({ home, platform, env }).filter(item => item.kind === "socket" && item.path.includes("://") ? true : exists(item.path));
  const installed = [...new Set(footprints.map(item => item.product))];
  let firstCli = null;
  for (const candidate of runtimeCandidates({ home, platform })) {
    if (path.isAbsolute(candidate.cli) && !exists(candidate.cli)) continue;
    const version = await exec([candidate.cli, "version", "--format", "{{.Client.Version}}"], { timeoutSeconds: 15, env: runtimeEnv(env, home, platform) });
    if (version.code !== 0 && !/^\d/.test(version.stdout.trim())) continue;
    firstCli ??= candidate;
    const info = candidate.runtime === "docker"
      ? await exec([candidate.cli, "info", "--format", "{{.OperatingSystem}}"], { timeoutSeconds: 20, env: runtimeEnv(env, home, platform) })
      : await exec([candidate.cli, "info", "--format", "{{.Host.Os}}"], { timeoutSeconds: 20, env: runtimeEnv(env, home, platform) });
    let endpoint = env.DOCKER_HOST || "";
    if (!endpoint && candidate.runtime === "docker") {
      const context = await exec([candidate.cli, "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { timeoutSeconds: 10, env: runtimeEnv(env, home, platform) });
      if (context.code === 0) endpoint = context.stdout.trim();
    }
    const daemonUp = info.code === 0;
    const product = candidate.runtime === "podman" ? "Podman" : productFromEndpoint(endpoint, daemonUp ? info.stdout.trim() : "") ?? installed[0] ?? "Docker";
    if (daemonUp) return { found: true, runtime: candidate.runtime, cli: candidate.cli, product, endpoint, daemonUp: true, installed };
  }
  if (firstCli) {
    const product = firstCli.runtime === "podman" ? "Podman" : installed.find(item => item !== "Docker") ?? installed[0] ?? "Docker";
    return { found: true, runtime: firstCli.runtime, cli: firstCli.cli, product, endpoint: env.DOCKER_HOST || "", daemonUp: false, installed };
  }
  return { found: installed.length > 0, runtime: null, cli: null, product: installed[0] ?? null, endpoint: "", daemonUp: false, installed };
}

/** PATH with the runtimes' own bin folders, so credential helpers resolve. */
export function runtimeEnv(env = process.env, home = os.homedir(), platform = process.platform) {
  if (platform === "win32") return env;
  const extra = ["/usr/local/bin", "/opt/homebrew/bin", path.join(home, ".orbstack", "bin"), "/Applications/Docker.app/Contents/Resources/bin", path.join(home, ".rd", "bin"), "/opt/podman/bin"];
  const current = String(env.PATH ?? "").split(":").filter(Boolean);
  return { ...env, PATH: [...current, ...extra.filter(dir => !current.includes(dir))].join(":") };
}

/** Path helpers of the computer the Local VM lives on, not of this process.
 * A Windows CI host must still join a darwin fixture with `/`, and Docker
 * Desktop on Windows reports `/` and `\` interchangeably. */
function hostPath(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function samePath(a, b, platform) {
  const clean = value => {
    let out = String(value ?? "").replace(/^\/host_mnt(?=\/)/, "");
    if (platform === "darwin") out = out.replace(/^\/private(?=\/)/, "");
    if (platform === "win32") out = out.replaceAll("\\", "/");
    out = out.replace(/[\\/]+$/, "");
    return platform === "win32" || platform === "darwin" ? out.toLowerCase() : out;
  };
  return clean(a) === clean(b);
}

/** One container as `docker inspect` describes it, judged against this
 * app's workspace folder. */
export function judgeContainer(detail, { workspace, platform = process.platform, exists = fs.existsSync, image } = {}) {
  const labels = detail?.Config?.Labels ?? {};
  const state = detail?.State ?? {};
  const mounts = Array.isArray(detail?.Mounts) ? detail.Mounts.filter(mount => mount?.Type === "bind") : [];
  const mountSource = mounts[0]?.Source ? String(mounts[0].Source).replace(/^\/host_mnt(?=\/)/, "") : null;
  const labelPath = typeof labels[WORKSPACE_PATH_LABEL] === "string" ? labels[WORKSPACE_PATH_LABEL] : null;
  const managed = labels[LOCAL_VM_LABEL] === "1";
  let stale = null;
  if (!managed) stale = "foreign";
  else if (labels[TEST_RUN_LABEL]) stale = "test_container";
  else if (mounts.some(mount => mount?.Source && !exists(String(mount.Source).replace(/^\/host_mnt(?=\/)/, "")))) stale = "missing_folder";
  else if ((labelPath && !samePath(labelPath, workspace, platform)) || (mountSource && !samePath(mountSource, workspace, platform))) stale = "other_folder";
  else if (!mountSource) stale = "missing_folder";
  else if (image && detail?.Config?.Image && detail.Config.Image !== image) stale = "old_image";
  return {
    name: String(detail?.Name ?? "").replace(/^\//, ""),
    state: state.Paused ? "paused" : state.Running ? "running" : state.Restarting ? "starting" : String(state.Status ?? "exited"),
    managed,
    stale,
    folder: mountSource,
    folderExists: mountSource ? exists(mountSource) : false,
  };
}

/** The server's recipe, checked before anything runs from it: the Sagax
 * image, the fixed name, one bind mount of this app's folder, loopback-only
 * viewer, no privilege. */
export function validLocalVmSpec(spec) {
  if (!spec || typeof spec !== "object" || spec.version !== 1) return false;
  if (spec.container !== REAL_CONTAINER) return false;
  if (typeof spec.image !== "string" || !/^localhost\/openmausbot\/cua-local-vm:[\w.-]+$/.test(spec.image)) return false;
  if (typeof spec.baseImage !== "string" || !/^docker\.io\/trycua\/[\w.-]+@sha256:[a-f0-9]{64}$/.test(spec.baseImage)) return false;
  if (typeof spec.dockerfile !== "string" || spec.dockerfile.length > 64_000 || !spec.dockerfile.startsWith(`FROM ${spec.baseImage}\n`)) return false;
  if (!spec.imageLabels || typeof spec.imageLabels !== "object" || spec.imageLabels[LOCAL_VM_LABEL] !== "1") return false;
  if (!Object.entries(spec.imageLabels).every(([key, value]) => key.startsWith("com.openmausbot.") && typeof value === "string")) return false;
  for (const runtime of ["docker", "podman"]) {
    const args = spec.run?.[runtime];
    if (!Array.isArray(args) || !args.every(arg => typeof arg === "string" && arg.length < 1000)) return false;
    if (args[0] !== "run" || args.at(-1) !== spec.image) return false;
    const name = args.indexOf("--name");
    if (name < 0 || args[name + 1] !== REAL_CONTAINER) return false;
    if (args.some(arg => ["--privileged", "-v", "--volume", "--volumes-from", "--device"].includes(arg) || /^--(network|net|pid|ipc|uts|userns)=host$/.test(arg))) return false;
    for (let index = 0; index < args.length - 1; index++) {
      const next = args[index + 1];
      if (["--network", "--net", "--pid", "--uts"].includes(args[index]) && next === "host") return false;
      if (["-p", "--publish"].includes(args[index]) && !next.startsWith("127.0.0.1:")) return false;
      if (args[index] === "-e" && next !== `VNC_PW=${PASSWORD_PLACEHOLDER}`) return false;
      if (args[index] === "--label" && !next.startsWith("com.openmausbot.")) return false;
      if (args[index] === "--cap-add" && !["SETUID", "SETGID", "SYS_CHROOT"].includes(next)) return false;
    }
    const mounts = args.filter((arg, index) => args[index - 1] === "--mount");
    if (mounts.length !== 1 || !mounts[0].startsWith(`type=bind,source=${WORKSPACE_PLACEHOLDER},`)) return false;
    if (!args.includes(`${LOCAL_VM_LABEL}=1`) || !args.includes(`${WORKSPACE_PATH_LABEL}=${WORKSPACE_PLACEHOLDER}`)) return false;
  }
  return true;
}

/** The URL or command each install choice uses (never run without the
 * person's OS-level confirmation). */
export const INSTALL_CHOICES = {
  "orbstack-download": { url: "https://orbstack.dev/download", product: "OrbStack" },
  "docker-download": { url: "https://www.docker.com/products/docker-desktop/", product: "Docker Desktop" },
  "docker-windows": { url: "https://docs.docker.com/desktop/setup/install/windows-install/", product: "Docker Desktop" },
  "podman-download": { url: "https://podman-desktop.io/downloads", product: "Podman Desktop" },
  "orbstack-brew": { brew: ["install", "--cask", "orbstack"], product: "OrbStack" },
};

/** How to start an installed runtime whose engine is stopped. */
export function startRuntimeArgv(product, { platform = process.platform, cli } = {}) {
  if (platform === "darwin") {
    if (product === "Docker Desktop" || product === "Docker") return ["open", "-a", "Docker"];
    if (product === "OrbStack") return ["open", "-a", "OrbStack"];
    if (product === "Rancher Desktop") return ["open", "-a", "Rancher Desktop"];
    if (product === "Colima") return ["colima", "start"];
    if (product === "Podman" && cli) return [cli, "machine", "start"];
  }
  if (platform === "win32" && product === "Docker Desktop") return ["cmd.exe", "/c", "start", "", "Docker Desktop"];
  if (product === "Podman" && cli) return [cli, "machine", "start"];
  return null;
}

const STEPS = ["runtime", "image", "container", "start"];
/** What the turn sees for each setup step (Local VM creation by a bot). */
const STEP_MESSAGES = {
  runtime: "Checking the container runtime",
  image: "Preparing the Local VM desktop image",
  container: "Creating the Local VM",
  start: "Starting the Local VM",
};
const failure = message => ({ ...text(message), isError: true });

export function createLocalVm({
  exec = execArgv, dataDir = path.join(os.homedir(), ".openmausbot"), home = os.homedir(), platform = process.platform, env = process.env,
  exists = fs.existsSync, mkdir = dir => fs.promises.mkdir(dir, { recursive: true, mode: 0o700 }),
  makeTemp = async () => fs.promises.mkdtemp(path.join(os.tmpdir(), "sagax-local-vm-")), writeFile = (file, data) => fs.promises.writeFile(file, data, { mode: 0o600 }),
  removeDir = dir => fs.promises.rm(dir, { recursive: true, force: true }),
  confirm = async () => false, openExternal = async () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), startWaitMs = 120_000,
  confirmCreate = null, pollMs = 1000,
  idleStopMs = LOCAL_VM_IDLE_STOP_MS, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  // The folder belongs to the machine named by `platform`, which tests set
  // apart from this process. The host's path.join would rewrite a POSIX
  // folder with this computer's separators, and a healthy VM then looks
  // stale.
  const workspace = hostPath(platform).join(dataDir, "vm-home");
  let job = null;
  let installJob = null;
  let confirming = false;
  // Idle stop: the VM is stopped (not deleted: vm-home stays) once nothing
  // used it for idleStopMs. Use is a bot command or computer call, an open
  // view of its screen (the Computer tab grabs a frame every few seconds),
  // a start, setup or creation. A command still running defers the stop.
  let inUse = 0;
  let idleTimer = null;
  let lastUse = now();
  const idleBusy = () => inUse > 0 || confirming || job?.state === "running";
  const armIdle = delay => {
    if (!idleStopMs) return;
    if (idleTimer) clearTimer(idleTimer);
    idleTimer = setTimer(() => void idleExpire(), Math.max(0, delay));
    idleTimer?.unref?.();
  };
  const touch = () => { lastUse = now(); armIdle(idleStopMs); };
  const using = async work => {
    inUse += 1;
    touch();
    try { return await work(); } finally { inUse -= 1; touch(); }
  };
  const runEnv = () => runtimeEnv(env, home, platform);
  const detect = () => detectRuntime({ exec, home, platform, env, exists });
  const run = (runtime, args, timeoutSeconds = 60, extraEnv = undefined) => exec([runtime.cli, ...args], { timeoutSeconds, env: extraEnv ? { ...runEnv(), ...extraEnv } : runEnv() });
  const need = async () => {
    const runtime = await detect();
    if (!runtime.cli) throw new Error("No container runtime (Docker or Podman) on this computer, so there is no Local VM here.");
    if (!runtime.daemonUp) throw new Error(`${runtime.product ?? runtime.runtime} is installed but not running. Start it, then try again.`);
    return runtime;
  };
  const list = async runtime => {
    const answer = await run(runtime, ["ps", "-a", "--filter", `label=${LOCAL_VM_LABEL}=1`, "--format", "{{.Names}}\t{{.State}}"], 30);
    if (answer.code !== 0) throw new Error("The container runtime did not answer.");
    return answer.stdout.split("\n").map(line => line.trim()).filter(Boolean).map(line => { const [name, state] = line.split("\t"); return { name, state }; }).filter(entry => /^[\w.-]+$/.test(entry.name ?? ""));
  };
  const inspect = async (runtime, name, image) => {
    const answer = await run(runtime, ["inspect", name], 30);
    if (answer.code !== 0) return null;
    try { return judgeContainer(JSON.parse(answer.stdout)[0], { workspace, platform, exists, image }); } catch { return null; }
  };
  // The person's VM: the real name first, else the first labeled one that
  // is not a test's.
  const current = async runtime => {
    const all = await list(runtime);
    const named = all.find(entry => entry.name === REAL_CONTAINER) ?? all.find(entry => !entry.name.startsWith("openmausbot-test-")) ?? null;
    return { all, vm: named ? await inspect(runtime, named.name) : null };
  };
  const pick = async (runtime, container) => {
    const { all, vm } = await current(runtime);
    const none = "No Local VM exists on this computer yet. Set it up from the Computer tab (Set up in one click).";
    if (!all.length) throw new Error(none);
    if (container && container !== vm?.name) {
      if (!all.some(entry => entry.name === container)) throw new Error("That Local VM does not exist on this computer.");
      const other = await inspect(runtime, container);
      if (!other) throw new Error("That Local VM does not exist on this computer.");
      return other;
    }
    if (!vm) throw new Error(none);
    return vm;
  };
  const staleMessage = vm => vm.stale === "foreign"
    ? `A container named ${vm.name} exists but was not created by Sagax; remove it in your container app.`
    : `This Local VM was made for another folder${vm.folder ? ` (${vm.folder})` : ""}${vm.stale === "missing_folder" ? " that no longer exists" : ""}. Repair it from the Computer tab: Sagax recreates it on ${workspace}.`;

  const setupJob = (spec, onStep = null) => {
    const steps = STEPS.map(id => ({ id, state: "pending", detail: "" }));
    const state = { id: randomBytes(6).toString("hex"), state: "running", steps, error: null, code: null, previousFolder: null, startedAt: Date.now() };
    const step = (id, patch) => {
      const entry = Object.assign(steps.find(item => item.id === id), patch);
      if (onStep && entry.state === "running" && (patch.state === "running" || patch.detail)) {
        try { onStep(entry.detail ? `${STEP_MESSAGES[id]} (${entry.detail})` : STEP_MESSAGES[id]); } catch { /* best effort */ }
      }
      return entry;
    };
    const fail = (id, message, code) => { step(id, { state: "error", detail: message }); state.state = "error"; state.error = message; state.code = code ?? null; };
    const work = async () => {
      // 1. The runtime: found, and its engine running (started if needed).
      step("runtime", { state: "running" });
      let runtime = await detect();
      if (!runtime.cli) return fail("runtime", runtime.installed.length ? `${runtime.installed[0]} is installed but its command line tools were not found.` : "No container runtime on this computer.", "no_runtime");
      if (!runtime.daemonUp) {
        const argv = startRuntimeArgv(runtime.product, { platform, cli: runtime.cli });
        if (!argv) return fail("runtime", `Start ${runtime.product}, then try again.`, "runtime_stopped");
        step("runtime", { detail: `Starting ${runtime.product}` });
        await exec(argv, { timeoutSeconds: 120, env: runEnv() });
        const deadline = Date.now() + startWaitMs;
        while (!runtime.daemonUp && Date.now() < deadline) {
          await wait(3000);
          runtime = await detect();
        }
        if (!runtime.daemonUp) return fail("runtime", `${runtime.product} did not start. Open it, then try again.`, "runtime_stopped");
      }
      step("runtime", { state: "done", detail: runtime.product });
      // 2. The image.
      step("image", { state: "running" });
      const image = await run(runtime, ["image", "inspect", spec.image], 30);
      let labels = {};
      try { labels = JSON.parse(image.stdout)[0]?.Config?.Labels ?? {}; } catch { /* missing */ }
      const imageReady = image.code === 0 && Object.entries(spec.imageLabels).every(([key, value]) => labels[key] === value);
      if (!imageReady) {
        step("image", { detail: "Downloading" });
        const pulled = await run(runtime, ["pull", spec.baseImage], 1800);
        if (pulled.code !== 0) return fail("image", `Download failed: ${runtimeError(pulled.stderr)}`, "pull_failed");
        step("image", { detail: "Preparing" });
        const context = await makeTemp();
        try {
          await writeFile(path.join(context, "Dockerfile"), spec.dockerfile);
          const built = await run(runtime, ["build", "-t", spec.image, context], 1800);
          if (built.code !== 0) return fail("image", `Preparing the image failed: ${runtimeError(built.stderr)}`, "build_failed");
        } finally {
          await removeDir(context).catch(() => {});
        }
      }
      step("image", { state: "done", detail: "" });
      // 3. The container: kept when healthy, recreated when stale, stopped
      // (this desktop image cannot safely resume) or of an older image.
      step("container", { state: "running" });
      const existing = await inspect(runtime, spec.container, spec.image);
      let create = !existing;
      if (existing) {
        if (existing.stale === "foreign") return fail("container", staleMessage(existing), "foreign_container");
        if (existing.stale || !["running", "paused"].includes(existing.state)) {
          if (existing.stale && existing.folder && existing.folderExists && !samePath(existing.folder, workspace, platform)) state.previousFolder = existing.folder;
          step("container", { detail: existing.stale ? "Repairing" : "Recreating" });
          const removed = await run(runtime, ["rm", "-f", spec.container], 120);
          if (removed.code !== 0) return fail("container", `Could not remove the old Local VM: ${runtimeError(removed.stderr)}`, "remove_failed");
          create = true;
        }
      }
      if (create) {
        await mkdir(workspace);
        const password = randomBytes(9).toString("base64url");
        const args = spec.run[runtime.runtime].map(arg => arg.replaceAll(WORKSPACE_PLACEHOLDER, workspace).replaceAll(PASSWORD_PLACEHOLDER, password));
        // The viewer's fixed host port: a container still holding it (a
        // leftover test VM, another app) makes `run` create the VM, fail
        // to start it, and every Repair fail the same way.
        const hostPort = publishedHostPort(args);
        if (hostPort) {
          const held = await run(runtime, ["ps", "--filter", `publish=${hostPort}`, "--format", `{{.Names}}\t{{.Label "${LOCAL_VM_LABEL}"}}\t{{.Label "${TEST_RUN_LABEL}"}}`], 30);
          // Podman has no publish filter: its own error then shows below.
          const holders = held.code === 0 ? held.stdout.split("\n").map(line => line.trim().split("\t")).filter(([name]) => name && name !== spec.container) : [];
          for (const [name, managed, testRun] of holders) {
            if (managed !== "1" || !testRun) return fail("container", `Port ${hostPort} on this computer is used by the container ${name}. Stop it in your container app, then Repair.`, "port_in_use");
            // A test run's Local VM left running: stopped (never removed).
            step("container", { detail: `Stopping ${name}, which holds port ${hostPort}` });
            const stopped = await run(runtime, ["stop", name], 120);
            if (stopped.code !== 0) return fail("container", `Port ${hostPort} is used by ${name}, which could not be stopped: ${runtimeError(stopped.stderr)}`, "port_in_use");
          }
        }
        const created = await run(runtime, args, 300);
        if (created.code !== 0) return fail("container", `Creating the Local VM failed: ${runtimeError(created.stderr)}`, "create_failed");
      }
      step("container", { state: "done", detail: "" });
      // 4. Running.
      step("start", { state: "running" });
      const now = await inspect(runtime, spec.container, spec.image);
      if (now?.state === "paused") await run(runtime, ["unpause", spec.container], 60);
      else if (now?.state !== "running") {
        const started = await run(runtime, ["start", spec.container], 120);
        if (started.code !== 0) return fail("start", `Starting the Local VM failed: ${runtimeError(started.stderr)}`, "start_failed");
      }
      step("start", { state: "done" });
      state.state = "done";
    };
    work().catch(error => {
      const running = steps.find(entry => entry.state === "running") ?? steps[0];
      fail(running.id, String(error?.message ?? error), "failed");
    });
    return state;
  };

  async function idleExpire() {
    idleTimer = null;
    if (idleBusy()) return touch();
    try {
      const runtime = await detect();
      if (!runtime.cli || !runtime.daemonUp) return;
      const { vm } = await current(runtime);
      if (!vm || vm.stale || !["running", "paused"].includes(vm.state)) return;
      // Used while the runtime answered: wait out the rest of the window.
      if (idleBusy() || now() - lastUse < idleStopMs) return armIdle(lastUse + idleStopMs - now());
      const answer = await run(runtime, ["stop", vm.name], 120);
      if (answer.code !== 0) touch();
    } catch {
      // A runtime hiccup must not disable the backstop: try again later.
      touch();
    }
  }
  // A VM left running by an earlier session of the app stops too.
  touch();

  // The preview path is ours. The bot never chooses it, and the PNG comes
  // back inline.
  const grab = async (runtime, vm) => {
    const shot = await run(runtime, ["exec", ...CUA_EXEC_ENV, vm.name, CUA_EXECUTABLE, "call", "get_desktop_state", "{}", "--socket", CUA_SOCKET, "--screenshot-out-file", CUA_PREVIEW], 30);
    if (shot.code !== 0) throw new Error("The Local VM's screen is not ready yet.");
    const data = await run(runtime, ["exec", vm.name, "base64", "-w0", CUA_PREVIEW], 30);
    const png = data.stdout.trim();
    if (data.code !== 0 || !/^[A-Za-z0-9+/=]+$/.test(png) || png.length > 2_800_000) throw new Error("The Local VM's screen could not be read.");
    return { content: [{ type: "image", data: png, mimeType: "image/png" }] };
  };

  const api = {
    workspace,
    idleStopMs,
    async status() {
      // Reading the status is not use; it only re-arms a spent backstop.
      if (!idleTimer) touch();
      const runtime = await detect();
      let vm = null; let all = [];
      if (runtime.cli && runtime.daemonUp) ({ all, vm } = await current(runtime).catch(() => ({ all: [], vm: null })));
      return text({ runtime, workspace, vm, localVms: all, setup: job, install: installJob });
    },
    async start(container) {
      touch();
      const runtime = await need();
      const vm = await pick(runtime, container);
      if (vm?.stale) throw new Error(staleMessage(vm));
      if (vm.state === "running") return text(`${vm.name} is already running`);
      const answer = await run(runtime, [vm.state === "paused" ? "unpause" : "start", vm.name], 120);
      if (answer.code !== 0) throw new Error(`Starting the Local VM failed: ${runtimeError(answer.stderr)}`);
      return text(`${vm.name} started`);
    },
    async power(action) {
      touch();
      const runtime = await need();
      const vm = await pick(runtime);
      if (vm.stale === "foreign") throw new Error(staleMessage(vm));
      const args = action === "pause" ? ["pause", vm.name] : action === "resume" ? ["unpause", vm.name] : ["stop", vm.name];
      if (action === "pause" && vm.state !== "running") throw new Error("The Local VM is not running.");
      if (action === "resume" && vm.state !== "paused") throw new Error("The Local VM is not paused.");
      if (action === "stop" && !["running", "paused"].includes(vm.state)) return text(`${vm.name} is already stopped`);
      const answer = await run(runtime, args, 120);
      if (answer.code !== 0) throw new Error(`The Local VM did not ${action}: ${runtimeError(answer.stderr)}`);
      return text(`${vm.name}: ${action} done`);
    },
    async setup(spec) {
      if (!validLocalVmSpec(spec)) throw new Error("The server sent a Local VM recipe this app does not accept. Update the Sagax app.");
      touch();
      if (job?.state === "running") return text({ setup: job });
      job = setupJob(spec);
      return text({ setup: job });
    },
    /** Create the Local VM here for a bot, after the person's yes on this
     * computer. Nothing is reported to the turn before that yes; a turn that
     * ends does not stop a setup already under way. */
    async create({ spec, signal, progress = () => {} } = {}) {
      const report = message => { try { progress(message); } catch { /* best effort */ } };
      const settled = setup => new Promise(resolve => {
        const finish = () => resolve(setup.state === "done"
          ? text(`The Local VM ${spec.container} is ready on this computer.\n${setup.steps.map(entry => `- ${STEP_MESSAGES[entry.id]}`).join("\n")}`)
          : failure(`Creating the Local VM failed: ${setup.error ?? "unknown error"}`));
        const tick = () => {
          if (signal?.aborted) return resolve(failure("The turn ended while the Local VM was being created. It keeps being created on this computer; ask for its status later."));
          if (setup.state !== "running") return finish();
          setTimeout(tick, pollMs);
        };
        tick();
      });
      const describe = setup => { const running = setup.steps.find(entry => entry.state === "running"); return running ? STEP_MESSAGES[running.id] : "starting"; };
      if (!confirmCreate) throw new Error("This Sagax desktop app cannot create a Local VM here. Update it, or set the Local VM up from the Computer tab.");
      if (!validLocalVmSpec(spec)) throw new Error("The server sent a Local VM recipe this app does not accept. Update the Sagax app.");
      if (job?.state === "running") { report(`Already being created on this computer: ${describe(job)}`); return settled(job); }
      const runtime = await detect();
      if (!runtime.cli) throw new Error("No container runtime (Docker or Podman) on this computer. Install Docker Desktop or Podman, start it, then ask again.");
      let needsImage = true;
      if (runtime.daemonUp) {
        const { vm } = await current(runtime);
        if (vm) {
          if (vm.stale) return failure(staleMessage(vm));
          return text(vm.state === "running" ? `A Local VM already exists and is running on this computer: ${vm.name}.` : `A Local VM already exists on this computer: ${vm.name} (${vm.state}). Start it with the action start.`);
        }
        const image = await run(runtime, ["image", "inspect", spec.image], 30);
        let labels = {};
        try { labels = JSON.parse(image.stdout)[0]?.Config?.Labels ?? {}; } catch { /* missing */ }
        needsImage = !(image.code === 0 && Object.entries(spec.imageLabels).every(([key, value]) => labels[key] === value));
      }
      if (confirming) throw new Error("A Local VM creation is already waiting for the person's answer on this computer.");
      confirming = true;
      let allowed;
      try { allowed = await confirmCreate({ runtime: runtime.product ?? runtime.runtime, needsImage, signal }); } finally { confirming = false; }
      if (signal?.aborted) return failure("The turn ended before the person answered. Nothing was created.");
      if (!allowed) return failure("The person declined creating a Local VM on their computer. Nothing was created.");
      if (job?.state !== "running") job = setupJob(spec, report);
      return settled(job);
    },
    async install(choice) {
      const chosen = INSTALL_CHOICES[choice];
      if (!chosen) throw new Error("Unknown install choice.");
      if (chosen.brew) {
        const brew = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].find(file => exists(file));
        if (!brew) throw new Error("Homebrew is not installed on this computer; download the app instead.");
        if (!(await confirm({ product: chosen.product, method: "brew" }))) throw new Error("Install cancelled.");
        installJob = { product: chosen.product, state: "running", error: null };
        const current = installJob;
        void exec([brew, ...chosen.brew], { timeoutSeconds: 1800, env: runEnv() }).then(answer => {
          current.state = answer.code === 0 ? "done" : "error";
          current.error = answer.code === 0 ? null : runtimeError(answer.stderr);
        });
        return text({ install: installJob });
      }
      if (!(await confirm({ product: chosen.product, method: "download", url: chosen.url }))) throw new Error("Install cancelled.");
      await openExternal(chosen.url);
      return text({ install: { product: chosen.product, state: "opened", error: null } });
    },
    async screenshot() {
      const runtime = await need();
      const vm = await pick(runtime);
      if (vm.stale || vm.state !== "running") throw new Error("The Local VM is not running.");
      return grab(runtime, vm);
    },
    async computer(toolName, args) {
      const checked = localVmComputerCall(toolName, args ?? {});
      if (checked.error) throw new Error(checked.error);
      const runtime = await need();
      const vm = await pick(runtime);
      if (vm.stale) throw new Error(staleMessage(vm));
      if (vm.state !== "running") throw new Error("The Local VM is not running.");
      if (checked.image) return grab(runtime, vm);
      const answer = await run(runtime, ["exec", ...CUA_EXEC_ENV, vm.name, CUA_EXECUTABLE, "call", checked.tool, JSON.stringify(checked.arguments), "--socket", CUA_SOCKET], 60);
      const err = answer.stderr ? `${answer.stdout ? "\n" : ""}[stderr]\n${answer.stderr}` : "";
      const out = `${answer.stdout}${err}\n[exit ${answer.code}]`.trimStart();
      return { ...text(out.slice(0, OUTPUT_LIMIT)), ...(answer.code === 0 ? {} : { isError: true }) };
    },
    async exec(container, command, options) {
      const runtime = await need();
      const vm = await pick(runtime, container);
      if (vm.stale) throw new Error(staleMessage(vm));
      if (vm.state !== "running") throw new Error(`${vm.name} is not running; start it first`);
      // Command variables: `-e NAME` takes the value from the client's own
      // environment (Docker and Podman), so it is never on the command line.
      const variables = options?.env && typeof options.env === "object" ? Object.keys(options.env) : [];
      const answer = await run(runtime, ["exec", "-u", "cua", ...variables.flatMap(name => ["-e", name]), vm.name, "bash", "-lc", command], Math.min(600, options?.timeoutSeconds ?? 120), variables.length ? options.env : undefined);
      const out = `${answer.stdout}${answer.stderr ? `${answer.stdout ? "\n" : ""}[stderr]\n${answer.stderr}` : ""}\n[exit ${answer.code}]`.trimStart();
      return { ...text(out.slice(0, OUTPUT_LIMIT)), ...(answer.code === 0 ? {} : { isError: true }) };
    },
  };
  /** The in-chat terminal on this VM (electron/desktop-terminal.mjs): the
   * argv of `docker exec -it` into the desktop user's login shell, in its
   * workspace, the same user and container as every vm_run_command. The VM
   * counts as in use until `release` (the terminal closed), so the idle stop
   * waits for it. */
  api.terminalCommand = async (container) => {
    const runtime = await need();
    const vm = await pick(runtime, container);
    if (vm.stale) throw new Error(staleMessage(vm));
    if (vm.state !== "running") throw new Error("The Local VM is not running. Start it from your Computer tab, then open the terminal again.");
    inUse += 1;
    touch();
    let held = true;
    return {
      // Windows has no terminal for docker to attach to (electron/script-pty.mjs):
      // plain pipes there, and bash told it is interactive.
      argv: platform === "win32"
        ? [runtime.cli, "exec", "-i", "-u", "cua", "-w", "/home/cua/workspace", "-e", "HOME=/home/cua", "-e", "TERM=xterm-256color", vm.name, "bash", "-li"]
        : [runtime.cli, "exec", "-it", "-u", "cua", "-w", "/home/cua/workspace", "-e", "HOME=/home/cua", "-e", "TERM=xterm-256color", vm.name, "bash", "-l"],
      env: runEnv(),
      release() { if (held) { held = false; inUse -= 1; touch(); } },
    };
  };
  // Commands, creations and screen grabs are use, held for as long as they run.
  for (const name of ["create", "exec", "screenshot", "computer"]) {
    const work = api[name];
    api[name] = (...args) => using(() => work(...args));
  }
  return api;
}

/** What a container CLI said went wrong, not its trailer: Docker 25+ ends
 * every `run` error with "Run 'docker run --help' for more information",
 * which alone hid the real cause (a port already allocated). */
export function runtimeError(value) {
  const lines = String(value ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .filter(line => !/^(Run|See) '[\w -]+--help'( for more information)?\.?$/.test(line))
    .map(line => line.replace(/^(docker|podman|Error): /, ""));
  return (lines.slice(-3).join(" ") || "unknown error").slice(0, 600);
}

/** The host port a `run` recipe publishes on (`-p 127.0.0.1:6080:6901`), or
 * null when the runtime picks one. */
export function publishedHostPort(args) {
  for (let index = 0; index < args.length - 1; index++) {
    if (!["-p", "--publish"].includes(args[index])) continue;
    const match = /^127\.0\.0\.1:(\d+):\d+(\/tcp)?$/.exec(args[index + 1]);
    if (match) return match[1];
  }
  return null;
}
