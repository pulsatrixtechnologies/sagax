// The desktop bridge, desktop side (server mode). While this app is signed in
// to its organization server, it is the bridge between that server and this
// computer: the server's bots, working for THIS person, run the solo-mode
// tools here (shell, files, search, fetch, browser, computer use, Local VM)
// and their network traffic leaves through here (electron/desktop-tunnel.mjs).
// The server side is server/desktop-bridge.ts.
//
// Outbound only (HTTPS long poll + one WebSocket); no port opens here. The
// session cookie and the bridge secret stay in the main process. Approvals
// happen where solo shows them: the bot's approval mode, in the chat. This
// side keeps its own last say: the app's own data, its cookies and the
// person's credential stores are never read or written through the bridge,
// sizes are bounded, and every action is recorded in this computer's
// activity log (action and target only, never contents).
import { createAuthBackoff } from "./auth-backoff.mjs";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { assertOutsideProtected, createSharedCua, personalSecretPaths, protectedIdentities, sharedComputerError } from "./shared-computer-access.mjs";
import { createLendingActivity } from "./lending-activity.mjs";
import { openDesktopTunnel } from "./desktop-tunnel.mjs";
import { loginShellArgv, openBridgeTerminal } from "./desktop-terminal.mjs";
import { createLocalVm } from "./local-vm.mjs";
import { archiveKind, extractArchive, extractedFolderName } from "./archive-extract.mjs";
import { executeLocalModel, normalizeLoopbackBase, probeLoopbackCatalog } from "./local-models.mjs";

export { createLocalVm };

const OUTPUT_LIMIT = 512 * 1024;
const SYSTEM_REFRESH_MS = 30_000;

const roundGb = (bytes, step = 0.5) => Math.round(bytes / 1024 ** 3 / step) * step;
const OS_NAMES = { darwin: "macOS", win32: "Windows", linux: "Linux" };

/** Coarse facts about this computer for the person's own Computer tab:
 * OS and version, CPU model and count, CPU use (rounded to 5 %), memory and
 * disk rounded to half a GiB. Nothing about files, apps or networks.
 * `previous` is the last CPU sample, so the use covers the interval. */
export async function systemInfo({ platform = process.platform, version = typeof process.getSystemVersion === "function" ? process.getSystemVersion() : os.release(), home = os.homedir(), previous = null, statfs = fs.statfs } = {}) {
  const cpus = os.cpus();
  const times = cpus.reduce((sum, cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    return { idle: sum.idle + cpu.times.idle, total: sum.total + total };
  }, { idle: 0, total: 0 });
  let cpuPercent;
  if (previous && times.total > previous.total) {
    cpuPercent = Math.min(100, Math.max(0, Math.round(((1 - (times.idle - previous.idle) / (times.total - previous.total)) * 100) / 5) * 5));
  }
  const total = os.totalmem();
  const info = {
    os: `${OS_NAMES[platform] ?? "Linux"} ${String(version).split(/\s/)[0]}`.slice(0, 80),
    arch: process.arch.slice(0, 20),
    ...(cpus[0]?.model ? { cpuModel: cpus[0].model.replace(/\s+/g, " ").trim().slice(0, 80) } : {}),
    cpus: Math.max(1, cpus.length),
    ...(cpuPercent === undefined ? {} : { cpuPercent }),
    memoryGb: roundGb(total),
    memoryUsedGb: roundGb(Math.max(0, total - os.freemem())),
  };
  try {
    const disk = await statfs(home);
    info.diskGb = Math.round((disk.blocks * disk.bsize) / 1024 ** 3);
    info.diskFreeGb = Math.round((disk.bavail * disk.bsize) / 1024 ** 3);
  } catch { /* unknown */ }
  return { info, sample: times };
}
const READ_DEFAULT = 256_000;
const READ_MAX = 1_000_000;
const WRITE_MAX = 1024 * 1024;
const FETCH_MAX = 256 * 1024;
/** The server's largest upload (a video, server/attachments.ts). */
const STAGE_MAX = 1024 * 1024 * 1024;
const ACTIONS = new Set(["run_command", "read_file", "write_file", "list_files", "search_files", "fetch_url", "browse", "computer_tools", "computer_call", "vm_status", "vm_start", "vm_run_command", "vm_create", "vm_stop", "vm_pause", "vm_resume", "vm_setup", "vm_install", "vm_screenshot", "vm_computer_call", "stage_file", "extract_archive", "local_model", "terminal_open", "vm_terminal_open"]);
const KEYS = new Set(["action", "path", "content", "encoding", "offset", "max_bytes", "command", "cwd", "timeout_seconds", "pattern", "glob", "url", "screenshot", "tool_name", "arguments", "container", "name", "final", "endpoint", "http_method", "http_path", "json", "env"]);
/** Command variables (run_command, vm_run_command): API keys the person
 * exposed to this bot, by the names they chose. Names a shell or Sagax
 * needs never come from the server (server/credential-command-env.ts). */
const COMMAND_VARIABLE = /^[A-Z_][A-Z0-9_]{0,63}$/;
const RESERVED_VARIABLES = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "PWD", "OLDPWD", "TERM", "LANG", "TZ", "IFS", "ENV", "BASH_ENV", "NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "PYTHONHOME", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]);
const RESERVED_PREFIXES = ["LD_", "DYLD_", "SAGAX_", "ANTHROPIC_", "CLAUDE_", "CODEX_", "ELECTRON_", "GIT_", "NPM_CONFIG_", "BASH_FUNC_"];
const validCommandVariables = env => env === undefined || (Boolean(env) && typeof env === "object" && !Array.isArray(env)
  && Object.keys(env).length <= 16
  && Object.entries(env).every(([name, value]) => COMMAND_VARIABLE.test(name) && !RESERVED_VARIABLES.has(name) && !RESERVED_PREFIXES.some(prefix => name.startsWith(prefix))
    && typeof value === "string" && value.length > 0 && value.length <= 100_000 && !value.includes("\0")));
const LOCAL_MODEL_PROBE_MS = 15_000;
/** A picker that opens right after a probe reuses it instead of probing again. */
export const LOCAL_MODEL_FRESH_MS = 5_000;
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const text = value => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });
const failure = message => ({ ...text(message), isError: true });

/** The server's operation, checked for shape before anything looks at it. */
export function validBridgeOperation(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return false;
  if (!Object.keys(operation).every(key => KEYS.has(key)) || !ACTIONS.has(operation.action)) return false;
  for (const key of ["path", "command", "cwd", "pattern", "glob", "url", "tool_name", "container", "name"]) {
    if (operation[key] !== undefined && (typeof operation[key] !== "string" || operation[key].length > 100_000)) return false;
  }
  if (operation.content !== undefined && (typeof operation.content !== "string" || operation.content.length > 1_500_000)) return false;
  for (const key of ["offset", "max_bytes", "timeout_seconds"]) {
    if (operation[key] !== undefined && (typeof operation[key] !== "number" || !Number.isFinite(operation[key]) || operation[key] < 0)) return false;
  }
  if (operation.arguments !== undefined && (!operation.arguments || typeof operation.arguments !== "object" || Array.isArray(operation.arguments))) return false;
  if (!validCommandVariables(operation.env) || (operation.env !== undefined && operation.action !== "run_command" && operation.action !== "vm_run_command")) return false;
  if (operation.endpoint !== undefined && (typeof operation.endpoint !== "string" || !/^desk[a-z0-9]{3,24}$/.test(operation.endpoint))) return false;
  if (operation.http_method !== undefined && operation.http_method !== "GET" && operation.http_method !== "POST") return false;
  if (operation.http_path !== undefined && operation.http_path !== "/models" && operation.http_path !== "/chat/completions" && operation.http_path !== "/messages") return false;
  if (operation.json !== undefined && (typeof operation.json !== "string" || operation.json.length > 1_000_000)) return false;
  if (operation.action === "terminal_open" || operation.action === "vm_terminal_open") {
    const args = operation.arguments;
    if (!args || typeof args.ticket !== "string" || !/^[a-f0-9]{48}$/.test(args.ticket)) return false;
    if (!Number.isInteger(args.cols) || !Number.isInteger(args.rows)) return false;
  }
  if (operation.action === "local_model") {
    if (operation.url !== undefined) return false;
    if (operation.http_method !== "GET" && operation.http_method !== "POST") return false;
    if (operation.http_path !== "/models" && operation.http_path !== "/chat/completions" && operation.http_path !== "/messages") return false;
    if (typeof operation.endpoint !== "string") return false;
  }
  return true;
}

/** ~ and ~/x are the person's home; anything else must be absolute. */
export function localPath(value, home) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error("Give a path");
  const expanded = value === "~" ? home : value.startsWith("~/") || value.startsWith("~\\") ? path.join(home, value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) throw new Error("Use an absolute path, or ~/... for your home folder");
  return path.resolve(expanded);
}

/** A name safe as one file in the attachments folder. */
export function attachmentName(value) {
  if (typeof value !== "string" || !value || value.length > 255 || /[\\/:\0]/.test(value) || value === "." || value === ".." || value.startsWith(".")) throw new Error("Invalid attachment name");
  return value;
}

/** No Sagax, Electron or credential variables reach a command. */
export function commandEnvironment(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (/^(SAGAX_|SAGAX_|ELECTRON_|SAGAX_|CHROME_)/i.test(key)) continue;
    if (/(API_KEY|_TOKEN$|SECRET|PASSWORD|_KEY_FILE$)/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

/** A command in the person's own shell (login shell on macOS and Linux,
 * PowerShell on Windows), like their terminal. */
export function runCommand(command, { cwd, timeoutSeconds = 120, signal, env = commandEnvironment(), argv } = {}) {
  if (!argv && (typeof command !== "string" || !command.trim())) throw new Error("Give a command");
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    const [file, ...args] = argv ?? (windows
      ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")]
      : [process.env.SHELL && path.isAbsolute(process.env.SHELL) ? process.env.SHELL : "/bin/sh", "-lc", command]);
    const child = spawn(file, args, { cwd, env, detached: !windows, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const out = []; const err = []; let bytes = 0; let truncated = false; let stopped = null;
    const stop = reason => { stopped = reason; killTree(child); };
    const timer = setTimeout(() => stop("time limit reached"), Math.min(600, Math.max(1, timeoutSeconds)) * 1000);
    const abort = () => stop("the requesting turn ended");
    signal?.addEventListener("abort", abort, { once: true });
    const take = target => chunk => {
      bytes += chunk.length;
      if (bytes <= OUTPUT_LIMIT) target.push(chunk); else if (!truncated) { truncated = true; }
    };
    child.stdout.on("data", take(out));
    child.stderr.on("data", take(err));
    child.once("error", error => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); });
    child.once("close", code => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      const parts = [stdout, stderr ? `${stdout ? "\n" : ""}[stderr]\n${stderr}` : "", truncated ? "\n[output shortened]" : "", stopped ? `\n[stopped: ${stopped}]` : "", `\n[exit ${code ?? "unknown"}]`];
      resolve({ ...text(parts.join("").trimStart()), ...(code === 0 && !stopped ? {} : { isError: true }) });
    });
  });
}

function globRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/** File names matching a glob and/or lines matching a pattern, bounded. */
export async function searchFiles(root, { pattern, glob, protectedRoots, signal }) {
  const nameMatch = glob ? globRegex(glob) : null;
  let lineMatch = null;
  if (pattern) { try { lineMatch = new RegExp(pattern); } catch { throw new Error("pattern is not a valid regular expression"); } }
  const results = []; let visited = 0;
  const skip = new Set([".git", "node_modules", ".Trash", "Library", "AppData"]);
  const pending = [root];
  while (pending.length && results.length < 200 && visited < 20_000) {
    signal?.throwIfAborted();
    const dir = pending.shift();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (results.length >= 200 || visited >= 20_000) break;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      try { await assertOutsideProtected(protectedRoots, full); } catch { continue; }
      visited++;
      if (entry.isDirectory()) { if (!skip.has(entry.name)) pending.push(full); continue; }
      if (!entry.isFile()) continue;
      if (nameMatch && !nameMatch.test(entry.name)) continue;
      if (!lineMatch) { results.push(full); continue; }
      try {
        const info = await fs.stat(full);
        if (info.size > 2 * 1024 * 1024) continue;
        const content = await fs.readFile(full);
        if (content.includes(0)) continue;
        const lines = content.toString("utf8").split(/\r?\n/);
        for (let index = 0; index < lines.length && results.length < 200; index++) {
          if (lineMatch.test(lines[index])) results.push(`${full}:${index + 1}: ${lines[index].slice(0, 300)}`);
        }
      } catch { /* unreadable */ }
    }
  }
  return text(results.length ? `${results.join("\n")}${results.length >= 200 || visited >= 20_000 ? "\n[more results not shown]" : ""}` : "No matches.");
}

/** Run one operation on this computer. `deps` holds what only Electron or
 * the person's settings provide. */
export async function executeBridgeOperation(operation, deps, signal) {
  const home = deps.home;
  const protectedRoots = await protectedIdentities(deps.protectedPaths);
  switch (operation.action) {
    case "run_command": {
      const cwd = operation.cwd ? localPath(operation.cwd, home) : home;
      return runCommand(operation.command, { cwd, timeoutSeconds: operation.timeout_seconds ?? 120, signal, env: { ...commandEnvironment(), ...operation.env } });
    }
    case "read_file": {
      const target = localPath(operation.path, home);
      await assertOutsideProtected(protectedRoots, target);
      const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new Error("Not a file");
        const max = Math.min(READ_MAX, Math.max(1, Math.floor(operation.max_bytes ?? READ_DEFAULT)));
        const offset = Math.max(0, Math.floor(operation.offset ?? 0));
        const buffer = Buffer.alloc(Math.min(max, Math.max(0, info.size - offset)));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        const data = buffer.subarray(0, bytesRead);
        const more = offset + bytesRead < info.size ? `\n[${info.size - offset - bytesRead} more bytes; read again with offset ${offset + bytesRead}]` : "";
        if (operation.encoding === "base64") return text(`${data.toString("base64")}${more}`);
        if (data.includes(0)) return failure("This is a binary file; read it with encoding base64.");
        return text(`${data.toString("utf8")}${more}`);
      } finally { await handle.close(); }
    }
    case "write_file": {
      const target = localPath(operation.path, home);
      await assertOutsideProtected(protectedRoots, target);
      const data = Buffer.from(operation.content ?? "", operation.encoding === "base64" ? "base64" : "utf8");
      if (data.length > WRITE_MAX) throw new Error("Files are limited to 1 MiB per write");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await assertOutsideProtected(protectedRoots, target);
      await fs.writeFile(target, data, { flag: "w" });
      return text(`wrote ${data.length} bytes to ${target}`);
    }
    case "list_files": {
      const target = operation.path ? localPath(operation.path, home) : home;
      await assertOutsideProtected(protectedRoots, target);
      const entries = await fs.readdir(target, { withFileTypes: true });
      const shown = [];
      for (const entry of entries.slice(0, 500)) {
        const full = path.join(target, entry.name);
        let size;
        if (entry.isFile()) { try { size = (await fs.stat(full)).size; } catch { /* vanished */ } }
        shown.push({ name: entry.name, type: entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other", ...(size !== undefined ? { size } : {}) });
      }
      return text({ path: target, entries: shown, truncated: entries.length > 500 });
    }
    case "search_files": {
      const root = operation.path ? localPath(operation.path, home) : home;
      await assertOutsideProtected(protectedRoots, root);
      return searchFiles(root, { pattern: operation.pattern, glob: operation.glob, protectedRoots, signal });
    }
    case "fetch_url": {
      const url = new URL(operation.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("http or https only");
      const response = await deps.fetchUrl(url.href, { redirect: "follow", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
      const reader = response.body?.getReader();
      const chunks = []; let bytes = 0; let truncated = false;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > FETCH_MAX) { truncated = true; chunks.push(Buffer.from(value).subarray(0, value.length - (bytes - FETCH_MAX))); await reader.cancel().catch(() => {}); break; }
        chunks.push(Buffer.from(value));
      }
      const body = Buffer.concat(chunks);
      const type = response.headers.get("content-type") ?? "";
      const shown = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|[^;]*\+(json|xml))/i.test(type) || !body.includes(0) ? body.toString("utf8") : `[${body.length} bytes of ${type || "binary data"}]`;
      return { ...text(`HTTP ${response.status} ${type}\n\n${shown}${truncated ? "\n[response shortened]" : ""}`), ...(response.ok ? {} : { isError: true }) };
    }
    case "browse": {
      if (!deps.browse) throw new Error("No browser is available on this computer");
      return deps.browse(operation.url, operation.screenshot === true, signal);
    }
    case "computer_tools":
    case "computer_call": {
      if (!deps.computer) throw new Error("Computer use is unavailable on this computer. Enable it in the desktop app and grant the OS permissions first.");
      return deps.computer(operation, signal);
    }
    case "vm_status": return deps.localVm.status();
    case "vm_start": return deps.localVm.start(operation.container);
    case "vm_stop": return deps.localVm.power("stop");
    case "vm_pause": return deps.localVm.power("pause");
    case "vm_resume": return deps.localVm.power("resume");
    case "vm_setup": return deps.localVm.setup(operation.arguments?.spec);
    case "vm_install": return deps.localVm.install(String(operation.arguments?.choice ?? ""));
    case "vm_screenshot": return deps.localVm.screenshot();
    case "vm_computer_call":
      if (typeof deps.localVm.computer !== "function") throw new Error("This Sagax desktop app cannot control the Local VM screen. Update it.");
      return deps.localVm.computer(operation.tool_name, operation.arguments);
    case "vm_run_command": return deps.localVm.exec(operation.container, operation.command, { timeoutSeconds: operation.timeout_seconds ?? 120, signal, ...(operation.env ? { env: operation.env } : {}) });
    case "vm_create": return deps.localVm.create({ spec: operation.arguments?.spec, signal, progress: deps.progress });
    case "stage_file": {
      const dir = deps.attachmentsDir;
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const target = path.join(dir, attachmentName(operation.name));
      const data = Buffer.from(operation.content ?? "", "base64");
      const offset = Math.floor(operation.offset ?? 0);
      if (offset + data.length > STAGE_MAX) throw new Error("Attachment too large");
      if (offset === 0) await fs.writeFile(target, data, { mode: 0o600 });
      else {
        const info = await fs.stat(target);
        if (info.size !== offset) throw new Error("Attachment chunks out of order");
        await fs.appendFile(target, data);
      }
      return text(operation.final ? `saved ${target}` : "ok");
    }
    case "terminal_open":
    case "vm_terminal_open": {
      if (!deps.terminal) return failure("This app cannot open a terminal here.");
      await deps.terminal(operation);
      return text("The terminal is open.");
    }
    case "extract_archive": {
      // A staged archive, unpacked next to it with the safety rules of
      // archive-extract.mjs (no links, nothing outside the folder, bomb limits).
      const dir = deps.attachmentsDir;
      const name = attachmentName(operation.name);
      if (!archiveKind(name)) throw new Error("Not an archive");
      const result = await extractArchive(path.join(dir, name), path.join(dir, attachmentName(extractedFolderName(name))));
      if (!result.extracted) return failure(`Not unpacked: ${result.manifest.reason ?? result.manifest.status}`);
      return text(`unpacked ${result.manifest.files} files into ${path.join(dir, extractedFolderName(name))}`);
    }
    case "local_model":
      return executeLocalModel(operation, deps.localModelBase ?? (() => null), deps.fetchUrl, signal, deps.localModelAnthropic ?? (() => false), deps.localModelKey ?? (() => null));
    default:
      throw new Error("Unsupported operation");
  }
}

const describe = operation => {
  switch (operation.action) {
    case "run_command": case "vm_run_command": return String(operation.command ?? "").slice(0, 300);
    case "read_file": case "write_file": case "list_files": case "search_files": return String(operation.path ?? "~").slice(0, 300);
    case "fetch_url": case "browse": try { return new URL(operation.url).host; } catch { return ""; }
    case "computer_call": case "vm_computer_call": return String(operation.tool_name ?? "");
    case "stage_file": case "extract_archive": return String(operation.name ?? "");
    case "terminal_open": return "terminal";
    case "vm_terminal_open": return "Local VM terminal";
    case "local_model": return `${operation.endpoint ?? ""} ${operation.http_path ?? ""}`.trim().slice(0, 300);
    default: return "";
  }
};

/** The connector: keeps this desktop registered with its organization
 * server while the app is in server mode and signed in. */
export function createDesktopBridge({
  environment, fetch: fetchImpl, cookieHeader, home = os.homedir(), attachmentsDir, protectedPaths = [], activityFile,
  fetchUrl = globalThis.fetch, browse, cuaConnection, hostControl, resolveProxy, proxyCredentials, lookup, tunnelConnect, WebSocketImpl = globalThis.WebSocket,
  platform = process.platform, hostname = os.hostname(), onChange = () => {}, localVm = createLocalVm(), retryMs = 5000,
  localModelFreshMs = LOCAL_MODEL_FRESH_MS,
  // The per-loopback-server API key the person set on THIS computer, by base
  // URL. Desktop-side only (electron/local-model-keys.mjs): it is used to set
  // the Authorization header of the loopback probe and the model-serving
  // calls, and is never sent to or stored on the organization server.
  localModelKeyFor = () => null,
}) {
  const roots = [...protectedPaths, ...personalSecretPaths(home)];
  const activity = createLendingActivity(activityFile);
  let running = null;
  let state = { connected: false, tunnel: false };
  const set = next => { state = { ...state, ...next }; try { onChange(state); } catch { /* indicator only */ } };
  let network = "all";

  const request = async (env, route, body, signal, secret) => {
    const origin = new URL(env.origin);
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) throw new Error("The desktop bridge requires an HTTPS server address");
    const response = await fetchImpl(`${env.origin}${route}`, {
      method: body === undefined ? "GET" : "POST", credentials: "include", redirect: "error", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(10_000),
      headers: { origin: env.origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(secret ? { "x-sagax-bridge-secret": secret } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let json; try { json = JSON.parse(raw); } catch { json = null; }
    if (!response.ok) throw Object.assign(new Error(json?.error ?? `Server request failed (${response.status})`), { status: response.status, ...(typeof json?.code === "string" ? { code: json.code } : {}) });
    return json;
  };

  const run = env => {
    // 2026-10-20: never 12 tries a minute against a server that refuses the session.
    const backoff = createAuthBackoff({ baseMs: retryMs });
    const abort = new AbortController();
    const signal = abort.signal;
    let tunnel = null;
    let cua = null;
    let registered = null;
    // The current registration's on-demand probe (the model picker opening).
    let refreshNow = null;
    const loop = async () => {
      while (!signal.aborted) {
        const id = randomUUID();
        const secret = randomBytes(32).toString("hex");
        // One registration: its tunnel and preference refresh end with it.
        const connection = new AbortController();
        const live = AbortSignal.any([signal, connection.signal]);
        try {
          const session = await request(env, "/api/auth/session");
          if (session?.kind !== "session" || session?.identity !== "perspicax") throw Object.assign(new Error("Sign in to this server first"), { quiet: true });
          const registration = {
            id, name: hostname.slice(0, 120) || "Computer", platform: ["darwin", "win32", "linux"].includes(platform) ? platform : "linux", attachmentsDir,
            capabilities: { shell: true, files: true, fetch: true, browser: Boolean(browse), computer: Boolean(cuaConnection), localVm: true },
          };
          try {
            await request(env, "/api/desktop-bridge/connect", { ...registration, capabilities: { ...registration.capabilities, localModels: true } }, signal, secret);
          } catch (error) {
            // A server that predates local models rejects the extra capability. Connect without it.
            if (error?.status !== 400) throw error;
            await request(env, "/api/desktop-bridge/connect", registration, signal, secret);
          }
          registered = { id, secret };
          backoff.reset();
          set({ connected: true, error: undefined });
          const preferences = async () => {
            try {
              const record = await request(env, "/api/me/preferences");
              const value = JSON.parse(record?.preferences?.["sagax.botWorkplace.v1"] ?? "{}");
              network = value?.network === "lan" ? "lan" : "all";
            } catch { /* keep the last one */ }
          };
          await preferences();
          const refresh = setInterval(() => void preferences(), 60_000);
          live.addEventListener("abort", () => clearInterval(refresh), { once: true });
          // Coarse system facts for the person's Computer tab. An older
          // server answers 404: nothing else depends on it.
          let cpuSample = null;
          const system = async () => {
            try {
              const { info, sample } = await systemInfo({ platform, previous: cpuSample });
              cpuSample = sample;
              await request(env, `/api/desktop-bridge/${id}/system`, info, live, secret);
            } catch { /* optional */ }
          };
          void system();
          const systemTimer = setInterval(() => void system(), SYSTEM_REFRESH_MS);
          live.addEventListener("abort", () => clearInterval(systemTimer), { once: true });
          // Loopback models this desktop has published. The server never receives the URL.
          // A failed probe is not remembered: the next tick, or the picker
          // opening (refreshLocalModels below), looks again.
          const localCatalog = new Map();
          // Endpoint ids whose server answered /v1/messages on the last probe.
          const localAnthropic = new Set();
          let probing = null;
          let probedAt = 0;
          let plainCatalog = false;
          const probeAndPublish = async () => {
            const record = await request(env, "/api/me/local-models");
            if (!record?.expose) { localCatalog.clear(); localAnthropic.clear(); return; }
            const next = new Map();
            const published = [];
            // Per-endpoint probe outcome for the Settings panel: "answered",
            // "empty", "needs_key" or "offline". Only "answered" becomes a
            // picker row; the rest tell the owner why a server is not listed.
            const probes = [];
            // All endpoints at once: one slow server (the Anthropic probe
            // waits up to 8 s) never holds back the others or the next tick.
            const candidates = (Array.isArray(record.endpoints) ? record.endpoints : [])
              .map(endpoint => ({ endpoint, base: normalizeLoopbackBase(endpoint?.baseUrl) }))
              .filter(({ endpoint, base }) => base && typeof endpoint?.id === "string");
            // The per-endpoint key (if the person set one on this computer) is
            // read here and passed only to the loopback probe. It never enters
            // the `published`/`probes` payload sent to the server below.
            const keys = await Promise.all(candidates.map(({ base }) => Promise.resolve(localModelKeyFor(base)).catch(() => null)));
            const results = await Promise.all(candidates.map(({ base }, index) => probeLoopbackCatalog(base, fetchUrl, keys[index] ?? undefined)));
            candidates.forEach(({ endpoint, base }, index) => {
              const probed = results[index];
              if (!probed) return;
              probes.push({ id: endpoint.id, status: probed.status });
              if (!probed.models.length) return;
              next.set(endpoint.id, base);
              published.push({ id: endpoint.id, label: String(endpoint.label ?? "").slice(0, 80), models: probed.models, details: probed.details, anthropic: probed.anthropic === true });
            });
            localCatalog.clear();
            localAnthropic.clear();
            for (const [endpointId, base] of next) localCatalog.set(endpointId, base);
            for (const row of published) if (row.anthropic) localAnthropic.add(row.id);
            const plain = () => published.map(({ details: _details, anthropic: _anthropic, ...row }) => row);
            if (plainCatalog) {
              await request(env, `/api/desktop-bridge/${id}/local-models`, { endpoints: plain() }, live, secret);
              return;
            }
            try {
              await request(env, `/api/desktop-bridge/${id}/local-models`, { endpoints: published, probes }, live, secret);
            } catch (error) {
              // A server that predates model names or probe status refuses the
              // extra field. Send ids only, with no probes.
              if (error?.status !== 400) throw error;
              plainCatalog = true;
              await request(env, `/api/desktop-bridge/${id}/local-models`, { endpoints: plain() }, live, secret);
            }
          };
          const refreshLocalModels = ({ freshMs = 0 } = {}) => {
            if (live.aborted) return Promise.resolve();
            if (probing) return probing;
            if (freshMs > 0 && Date.now() - probedAt < freshMs) return Promise.resolve();
            probing = probeAndPublish()
              .catch(() => { /* optional: an older server answers 404 */ })
              .finally(() => { probedAt = Date.now(); probing = null; });
            return probing;
          };
          refreshNow = (options) => refreshLocalModels({ freshMs: options?.force ? 0 : localModelFreshMs });
          live.addEventListener("abort", () => { refreshNow = null; }, { once: true });
          void refreshLocalModels();
          const modelTimer = setInterval(() => void refreshLocalModels(), LOCAL_MODEL_PROBE_MS);
          live.addEventListener("abort", () => clearInterval(modelTimer), { once: true });
          // The tunnel: the cookie and the secret ride its handshake only.
          // One listener for the registration, including every reconnect.
          live.addEventListener("abort", () => tunnel?.close(), { once: true });
          const startTunnel = async () => {
            if (!WebSocketImpl || live.aborted) return;
            try {
              tunnel = openDesktopTunnel({
                url: `${env.origin.replace(/^http/, "ws")}/api/desktop-bridge/${id}/tunnel`,
                headers: { cookie: await cookieHeader(env.origin), origin: env.origin, "x-sagax-bridge-secret": secret },
                network: () => network, resolveProxy, proxyCredentials, lookup, WebSocketImpl, ...(tunnelConnect ? { connect: tunnelConnect } : {}),
                record: ({ host, port, ok, error, via }) => activity.record({ env, action: "network", detail: `${host}:${port}${via && via !== "direct" ? ` via ${via}` : ""}`, ok, error }),
              });
              await tunnel.ready;
              set({ tunnel: true });
              await tunnel.closed;
            } catch { /* retried below */ }
            set({ tunnel: false });
            if (!live.aborted) { await delay(retryMs, undefined, { signal: live }).catch(() => {}); void startTunnel(); }
          };
          void startTunnel();
          // In-chat terminals the person opened here; they end with this registration.
          const terminals = new Set();
          live.addEventListener("abort", () => { for (const entry of terminals) entry.close(); terminals.clear(); }, { once: true });
          const openTerminal = async (operation) => {
            const vm = operation.action === "vm_terminal_open";
            let held = null;
            const entry = { close: () => {} };
            const terminal = await openBridgeTerminal({
              url: `${env.origin.replace(/^http/, "ws")}/api/desktop-bridge/${id}/terminal`,
              headers: { cookie: await cookieHeader(env.origin), origin: env.origin, "x-sagax-bridge-secret": secret },
              ticket: operation.arguments.ticket, cols: operation.arguments.cols, rows: operation.arguments.rows,
              command: async () => {
                if (!vm) return { argv: loginShellArgv({ platform }), env: process.env, cwd: home };
                held = await localVm.terminalCommand();
                return held;
              },
              WebSocketImpl, platform, home,
              onClose: () => { held?.release?.(); terminals.delete(entry); },
            }).catch((error) => { held?.release?.(); throw error; });
            entry.close = terminal.close;
            terminals.add(entry);
          };
          const call = (action, body = {}) => request(env, `/api/desktop-bridge/${id}/${action}`, body, signal, secret);
          while (!signal.aborted) {
            const { job } = await call("poll");
            if (!job) continue;
            if (!uuid(job.id) || !validBridgeOperation(job.operation)) {
              activity.record({ env, action: "invalid", detail: "", ok: false, error: "Refused a malformed request" });
              await call("result", { jobId: job.id, result: sharedComputerError(new Error("Invalid request")) }).catch(() => {});
              continue;
            }
            const operation = job.operation;
            const jobAbort = new AbortController();
            const jobSignal = AbortSignal.any([signal, jobAbort.signal]);
            const heartbeat = setInterval(() => {
              void call("lease", { jobId: job.id }).then(answer => { if (!answer?.active) jobAbort.abort(); }, () => jobAbort.abort());
            }, 2000);
            let result;
            let control;
            // Progress for the turn (Local VM creation): best effort, bounded.
            let progressSent = 0;
            const progress = message => {
              if (progressSent++ >= 50) return;
              void call("progress", { jobId: job.id, message: String(message).slice(0, 300) }).catch(() => {});
            };
            try {
              result = await executeBridgeOperation(operation, {
                home, attachmentsDir, protectedPaths: roots, fetchUrl, browse, localVm, progress, terminal: openTerminal,
                localModelBase: (endpoint) => localCatalog.get(endpoint) ?? null,
                localModelAnthropic: (endpoint) => localAnthropic.has(endpoint),
                // The key for the served endpoint, by its loopback base, from
                // this computer's store. Used only for the 127.0.0.1 request.
                localModelKey: (endpoint) => { const base = localCatalog.get(endpoint); return base ? localModelKeyFor(base) : null; },
                computer: cuaConnection ? async (op, sig) => {
                  if (hostControl) control = await hostControl(job.id, sig);
                  if (!cua) {
                    const connection = await cuaConnection();
                    if (!connection?.mcpCommand || !Array.isArray(connection.mcpArgs)) throw new Error("Computer use is unavailable. Enable it in the desktop app and grant the OS permissions first.");
                    cua = createSharedCua(connection);
                  }
                  return cua.call(op, sig);
                } : null,
              }, jobSignal);
            } catch (error) {
              result = sharedComputerError(error);
              if (["computer_tools", "computer_call"].includes(operation.action)) { cua?.close(); cua = null; }
            } finally {
              clearInterval(heartbeat);
              await control?.release?.().catch(() => {});
            }
            activity.record({ env, action: operation.action, detail: describe(operation), ok: result?.isError !== true, error: result?.isError ? result?.content?.[0]?.text : undefined });
            // Never retried: a result that cannot be delivered is lost, and
            // the server says the outcome is unknown.
            await call("result", { jobId: job.id, result }).catch(() => {});
          }
        } catch (error) {
          connection.abort();
          if (signal.aborted) break;
          tunnel?.close(); tunnel = null;
          set({ connected: false, tunnel: false, ...(error?.quiet ? {} : { error: error?.message }) });
          await delay(backoff.next(error), undefined, { signal }).catch(() => {});
        }
      }
      tunnel?.close();
      cua?.close();
    };
    void loop();
    return {
      stop() {
        abort.abort();
        tunnel?.close();
        cua?.close();
        // Say goodbye so the server stops routing here at once (best effort).
        if (registered) void request(env, `/api/desktop-bridge/${registered.id}/disconnect`, {}, undefined, registered.secret).catch(() => {});
        registered = null;
        set({ connected: false, tunnel: false });
      },
      refreshLocalModels: (options) => (refreshNow ? refreshNow(options) : Promise.resolve()),
    };
  };

  return {
    /** Keep the bridge running for the server-mode environment, or stop it. */
    sync() {
      const env = environment();
      if (running && running.origin === env?.origin) return;
      running?.stop();
      running = null;
      if (env) running = { origin: env.origin, ...run(env) };
    },
    state: () => ({ ...state }),
    /** Probe this computer's loopback model servers now (the model picker
     * opened) unless a probe finished in the last LOCAL_MODEL_FRESH_MS. */
    refreshLocalModels: (options) => running?.refreshLocalModels(options) ?? Promise.resolve(),
    activity: limit => activity.list(limit),
    close() { running?.stop(); running = null; },
  };
}
