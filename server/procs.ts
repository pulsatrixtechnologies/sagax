// Cross-platform process spawning for the agent CLIs. Four Windows
// differences are exposed to drivers through this module:
//   1. CreateProcess can't exec npm .cmd/.bat shims or node-shebang scripts
//      directly. env-path resolves those to their real .exe / `node script`
//      entry without a shell, so quoting-sensitive JSON argv stays intact.
//   2. No process-group kill (kill(-pid) is POSIX) — taskkill /T reaps the
//      whole tree, CLI + its spawned MCP proxies alike.
//   3. Console apps spawned from the GUI shell flash a console window
//      unless windowsHide is set.
//   4. CreateProcess has a 32,767-character command-line limit. Keep prompt
//      bodies on stdin or in private files and fail clearly if a future
//      driver accidentally puts one back in argv.
import {
  spawn,
  execFile,
  type ChildProcess,
  type ChildProcessByStdio,
  type ExecFileOptions,
  type SpawnOptions,
} from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { sagaxFolder } from "../shared/human-id.ts";
import type { Readable, Writable } from "node:stream";
import { join, posix, win32 } from "node:path";
import { engineStartGate } from "./engine-start-gate.ts";
import { markOomVictim, memoryGuardSettings } from "./engine-memory-guard.ts";
import { resolveCliSpawn, splitCliString, type ResolvedSpawn } from "./env-path.ts";
import { noteEngineGroupEnded, noteEngineGroupStarted } from "./engine-groups.ts";

export function resolveCli(cli: string, args: string[] = [], env?: NodeJS.ProcessEnv): ResolvedSpawn {
  return resolveCliSpawn(cli, args, env);
}

/** The engine CLIs a bare command name may name: every built-in driver's
 * default executable. Anything else is given by its absolute path. */
export const KNOWN_ENGINE_CLIS: ReadonlySet<string> = new Set([
  "claude", "codex", "grok", "kimi", "droid", "cursor-agent", "agy", "antigravity",
  "gemini", "qwen", "hermes", "opencode", "pi",
]);

/** Programs that run whatever command or script text they are handed:
 * never an engine, always a way to turn a settings field into a shell. */
const COMMAND_RUNNERS: ReadonlySet<string> = new Set([
  "sh", "bash", "zsh", "dash", "ksh", "mksh", "csh", "tcsh", "fish", "ash", "busybox",
  "env", "sudo", "doas", "su", "xargs", "nohup", "timeout", "nice", "ionice", "stdbuf", "time", "watch",
  "script", "exec", "eval", "open", "osascript", "launchctl", "at", "batch", "crontab",
  "cmd", "powershell", "pwsh", "wsl", "wscript", "cscript", "mshta", "rundll32", "regsvr32", "runas", "start",
]);

/** Interpreters may run a script file, never code passed inline. */
const INTERPRETER = /^(?:node|nodejs|deno|bun|python[0-9.]*|pypy[0-9.]*|perl[0-9.]*|ruby[0-9.]*|php[0-9.]*|lua[0-9.]*|rscript|tclsh[0-9.]*|wish[0-9.]*)$/;
const INLINE_CODE_FLAG = /^(?:-[A-Za-z]*[ecprm]|-|--(?:eval|print|require|import|loader|experimental-loader|input-type|interactive|command)(?:=.*)?)$/;

/**
 * Why a CLI command from Settings may not be run, or null when it may.
 * Never a shell: the command is split into an argument array (no expansion,
 * no substitution) and its executable must be an absolute path to a program
 * or one of the known engine CLI names. Shells and command runners are
 * refused outright, and an interpreter only runs a script file, never code
 * handed to it inline.
 */
export function cliCommandRefusal(cli: string, platform: NodeJS.Platform = process.platform): string | null {
  const trimmed = cli.trim();
  if (!trimmed || trimmed.length > 4096 || /\p{Cc}/u.test(trimmed)) return "Enter the path of the engine's executable.";
  const path = platform === "win32" ? win32 : posix;
  // An existing file whose path holds spaces is one word, as the spawn
  // resolver reads it (env-path resolveCliSpawn).
  const [head, ...fixed] = trimmed.includes(" ") && existsSync(trimmed) ? [trimmed] : splitCliString(trimmed);
  if (!head) return "Enter the path of the engine's executable.";
  const name = path.basename(head).toLowerCase().replace(/\.(?:exe|cmd|bat|com|ps1)$/, "");
  if (!path.isAbsolute(head)) {
    if (head !== path.basename(head) || !KNOWN_ENGINE_CLIS.has(name)) {
      return `Use the full path of the executable (for example /usr/local/bin/${name || "agent"}); only ${[...KNOWN_ENGINE_CLIS].join(", ")} may be given by name.`;
    }
  }
  if (COMMAND_RUNNERS.has(name)) return `${path.basename(head)} runs other commands; give the engine's own executable instead.`;
  if (INTERPRETER.test(name) && fixed.some((arg) => INLINE_CODE_FLAG.test(arg))) {
    return `${path.basename(head)} may run a script file here, not code passed on the command line.`;
  }
  return null;
}

/** Leave headroom below CreateProcess' 32,767 UTF-16 code-unit limit for
 * libuv's quoting and environment-specific executable expansion. */
export const WINDOWS_SAFE_COMMAND_LINE_CHARS = 30_000;

/** Conservative size of the command line libuv will give CreateProcess.
 * JSON string quoting escapes every slash/quote case Windows quoting needs,
 * so this can over-count but cannot hide a dangerous launch. */
export function estimatedWindowsCommandLineChars(resolved: ResolvedSpawn): number {
  return [resolved.command, ...resolved.args].reduce(
    (total, value) => total + JSON.stringify(value).length + 1,
    0,
  );
}

export function assertSafeCliArgv(
  resolved: ResolvedSpawn,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "win32") return;
  if (estimatedWindowsCommandLineChars(resolved) <= WINDOWS_SAFE_COMMAND_LINE_CHARS) return;
  const error = new Error(
    "agent CLI launch arguments exceed Windows' safe command-line limit; pass large prompts through stdin or a file",
  ) as NodeJS.ErrnoException;
  error.code = "ENAMETOOLONG";
  throw error;
}

// Only spawnCli establishes a private POSIX group. A plain spawned child
// (for example inside an MCP gate) may share our own group: never signal it.
const cliGroups = new WeakSet<ChildProcess>();
const CHILD_OOM_SCORE_ADJ = memoryGuardSettings().childOomScoreAdj;
const stopping = new WeakMap<ChildProcess, Promise<boolean>>();

type LinuxProcess = { pid: number; parent: number; start: string; state: string };
/** Linux start times of a CLI and the helpers captured while it was still the parent. */
const linuxTrees = new WeakMap<ChildProcess, Map<number, string>>();

function linuxProcess(pid: number): LinuxProcess | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  }
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const start = fields[19];
  const state = fields[0];
  const parent = Number(fields[1]);
  if (!start || !state || !Number.isInteger(parent)) throw new Error("Unreadable Linux process identity");
  return { pid, parent, start, state };
}

/** Linux sandbox helpers can leave the CLI's process group and reparent during a protocol interrupt.
 * Snapshot their identities (pid + start time) so Stop can still reap them after reparenting. */
export function captureCliTree(child: ChildProcess): void {
  if (process.platform !== "linux" || !cliGroups.has(child) || !child.pid) return;
  let tree = linuxTrees.get(child);
  if (!tree) {
    tree = new Map();
    linuxTrees.set(child, tree);
  }
  const snapshot = new Map<number, LinuxProcess>();
  let entries: string[];
  try { entries = readdirSync("/proc"); } catch { return; }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const current = linuxProcess(pid);
      if (current) snapshot.set(pid, current);
    } catch { /* unreadable pid */ }
  }
  const parents = new Set([...tree].filter(([pid, start]) => snapshot.get(pid)?.start === start).map(([pid]) => pid));
  let discovered: boolean;
  do {
    discovered = false;
    for (const current of snapshot.values()) {
      if (current.pid === process.pid || !parents.has(current.parent) || tree.get(current.pid) === current.start) continue;
      tree.set(current.pid, current.start);
      parents.add(current.pid);
      discovered = true;
    }
  } while (discovered);
}

function linuxDescendantsStopped(child: ChildProcess): boolean {
  for (const [pid, start] of linuxTrees.get(child) ?? []) {
    if (pid === child.pid) continue;
    try {
      const current = linuxProcess(pid);
      if (current?.start === start && current.state !== "Z" && current.state !== "X") return false;
    } catch { return false; }
  }
  return true;
}

function linuxRootIdentityMatches(child: ChildProcess): boolean | undefined {
  const start = child.pid && linuxTrees.get(child)?.get(child.pid);
  if (!child.pid || process.platform !== "linux" || !cliGroups.has(child)) return true;
  if (!start) return undefined;
  try {
    const current = linuxProcess(child.pid);
    return !current || current.start === start;
  } catch { return undefined; }
}

function signalLinuxDescendants(child: ChildProcess, value: NodeJS.Signals): void {
  for (const [pid, start] of [...(linuxTrees.get(child) ?? [])].reverse()) {
    if (pid === child.pid || pid <= 1 || pid === process.pid) continue;
    try {
      const current = linuxProcess(pid);
      if (current?.start === start && current.state !== "Z" && current.state !== "X") process.kill(pid, value);
    } catch { /* already gone or unreadable */ }
  }
}

const MAX_ENDED_SESSIONS = 4_096;
const engineSessions = { live: new Set<number>(), ended: new Set<number>(), bots: new Map<number, string>() };
/** The bot whose turn is being sent, so the engine it spawns is known as that
 * bot's (#1098: on a shared server a bot's browser opens the servers its
 * owner's own bots started, and only those). */
const engineBot = new AsyncLocalStorage<string>();

/** Runs `send` (a turn's dispatch) as `botId`'s: every bot engine spawnCli
 * starts inside it is remembered as that bot's. */
export function runAsBotEngine<T>(botId: string, send: () => T): T {
  return engineBot.run(botId, send);
}

/** POSIX session ids of the engines that run bots' turns (each leads its own
 * session). A server opened by any process in one counts as the bot's, even
 * after the shell that started it exits: a bot's browser may open it on a
 * server host (server/browser/egress, port of OpenMausBot #2930). `bots`
 * names the bot each session was started for, when it is known. */
export function botEngineSessions(): { live: ReadonlySet<number>; ended: ReadonlySet<number>; bots: ReadonlyMap<number, string> } {
  return engineSessions;
}

function rememberEngineSession(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  engineSessions.live.add(pid);
  const botId = engineBot.getStore();
  if (botId) engineSessions.bots.set(pid, botId);
  else engineSessions.bots.delete(pid);
  child.once("exit", () => {
    engineSessions.live.delete(pid);
    engineSessions.ended.add(pid);
    if (engineSessions.ended.size > MAX_ENDED_SESSIONS) {
      const oldest = engineSessions.ended.values().next().value!;
      engineSessions.ended.delete(oldest);
      engineSessions.bots.delete(oldest);
    }
  });
}

/** `bot`: an engine running bots' turns, whose own servers that bot's
 * browser may open on a server host. `sagax`: everything else (logins,
 * probes, the browser engine itself). */
export type CliOwner = "bot" | "sagax";

export function spawnCli(
  cli: string,
  args: string[],
  opts: SpawnOptions,
  owner: CliOwner = "sagax",
): ChildProcessByStdio<Writable, Readable, Readable> {
  const resolved = resolveCli(cli, args);
  assertSafeCliArgv(resolved);
  const child = spawn(resolved.command, resolved.args, {
    ...opts,
    // posix: own process group so kill(-pid) reaps child MCP servers;
    // win32: taskkill /T does the reaping instead (see killCliTree)
    ...(process.platform === "win32" ? { windowsHide: true } : { detached: true }),
  }) as ChildProcessByStdio<Writable, Readable, Readable>; // callers always pipe all three
  if (process.platform !== "win32") {
    cliGroups.add(child);
    noteEngineGroupStarted(child.pid);
    reapGroupAfterExit(child);
  }
  if (process.platform === "linux" && child.pid) {
    const tree = new Map<number, string>();
    try {
      const root = linuxProcess(child.pid);
      if (root) tree.set(root.pid, root.start);
    } catch { /* identity unread; kill will refuse the group */ }
    linuxTrees.set(child, tree);
  }
  if (process.platform !== "win32" && owner === "bot") rememberEngineSession(child);
  // An engine dies before the server when the container runs out of memory
  // (server/engine-memory-guard.ts); its MCP proxies inherit the score.
  markOomVictim(child.pid, CHILD_OOM_SCORE_ADJ);

  // A write to a dying child's stdin fails differently per platform, and one
  // of the ways is fatal. On POSIX the kill is synchronous, the stream is
  // already destroyed by the time anything writes, and the write throws into
  // the caller's try/catch. On Windows killCliTree goes through taskkill — a
  // subprocess — so there is a window where the child is dead but its pipe is
  // not, and a write during it errors *asynchronously* on the stream. No
  // driver listens for that, an unlistened stream error is an uncaught
  // exception, and the whole harness exits over one dead CLI. The error
  // carries no information the drivers don't already get from `close`, which
  // is where every one of them settles the turn — so it is swallowed, not
  // logged.
  child.stdin?.on("error", () => {});
  return child;
}

/** After a CLI's own process exits, what it started has this long to exit on
 * its own (an MCP server reads the closed stdin and stops) before the group
 * is stopped: TERM, then KILL after REAP_GRACE_MS. */
export const REAP_AFTER_EXIT_MS = 2_000;
const REAP_GRACE_MS = 3_000;

/** A CLI that exits, on its own or stopped, takes its whole group along:
 * the sub-agents, MCP servers and commands it started would otherwise run
 * on, re-parented to init, with nothing left to stop them. Only the CLI's
 * own end triggers this, so work that runs as long as its session does is
 * never cut short. */
function reapGroupAfterExit(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  child.once("exit", () => {
    const timer = setTimeout(() => {
      void killCliTree(child, REAP_GRACE_MS).then((gone) => { if (gone) noteEngineGroupEnded(pid); }, () => {});
    }, REAP_AFTER_EXIT_MS);
    timer.unref?.();
  });
}

const EXEC_KILL_GRACE_MS = 2_000;

export function execCli(
  cli: string,
  args: string[],
  opts: ExecFileOptions,
  cb: (err: Error | null, stdout: string, stderr?: string) => void,
): void {
  const resolved = resolveCli(cli, args);
  try {
    assertSafeCliArgv(resolved);
  } catch (error) {
    queueMicrotask(() => cb(error instanceof Error ? error : new Error(String(error)), "", ""));
    return;
  }
  const run = (done: () => void = () => {}) => {
    let escalate: NodeJS.Timeout | undefined;
    const child = execFile(resolved.command, resolved.args, { ...opts, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
      clearTimeout(escalate);
      done();
      cb(err, stdout, stderr);
    });
    // Node calls back only once the child exits, and a CLI wrapper that traps SIGTERM outlives the timeout's signal.
    // Only the child is stopped: execFile starts no process group, so a grandchild that ignores SIGTERM can outlive it.
    if (opts.timeout) {
      escalate = setTimeout(() => void killCliTree(child, 0), opts.timeout + EXEC_KILL_GRACE_MS);
      escalate.unref?.();
    }
  };
  // A known engine CLI boots a whole runtime even to print its version:
  // while the server boots, those probes share the engine start limit
  // (server/engine-start-gate.ts).
  if (!engineStartGate.booting || !isEngineCli(cli)) {
    run();
    return;
  }
  void engineStartGate.acquire("probe", `${cli} ${args.join(" ")}`).then((slot) => {
    try {
      run(() => slot.release());
    } catch (error) {
      slot.release();
      cb(error instanceof Error ? error : new Error(String(error)), "", "");
    }
  });
}

/** Concurrent probes on a busy machine can outlast the timeout, so a CLI that answered before keeps its last version. */
export function cliVersionReader(cli: string): (err: Error | null, stdout: string) => { version: string } | { reason: string } {
  let last: string | null = null;
  return (err, stdout) => {
    const version = err ? "" : stdout.trim();
    if (version) return { version: (last = version) };
    const failure = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
    const timedOut = failure?.killed === true && typeof failure.code !== "string";
    if (timedOut && last) return { version: last };
    return { reason: timedOut ? `\`${cli}\` took longer than 8 seconds to answer --version. The machine may be busy; check again.` : `\`${cli}\` CLI not found` };
  };
}

/** Whether `cli` (a bare name or a path) runs one of the built-in engines. */
export function isEngineCli(cli: string): boolean {
  const name = cli.trim().split(/[\\/]/).pop()?.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, "") ?? "";
  return KNOWN_ENGINE_CLIS.has(name);
}

/** Human wording for a failed CLI spawn.
 *
 * Node reports these as bare errno strings — "spawn grok ENOENT" — which
 * reads as a crash. On a CLI spawn the common codes mean exactly one thing
 * each, and both are setup problems the user can fix, so say which. The
 * `setup` flag lets the UI offer "Install" instead of a "Retry" that is
 * guaranteed to fail the same way.
 *
 * Node also reports a missing working folder as the CLI's own ENOENT, so a
 * bot whose folder was moved or deleted read as "isn't installed" even
 * though the CLI was there. Pass the spawn's `cwd` to tell the
 * two apart. */
type SpawnFailure = { message: string; setup: boolean };

export function describeSpawnFailure(err: NodeJS.ErrnoException, cli: string, cwd?: string): SpawnFailure {
  if (err.code === "ENOENT") {
    if (cwd && !existsSync(cwd))
      return { message: `This chat's working folder no longer exists${sagaxFolder(cwd) ? "" : `: ${cwd}`}. Choose another folder in the bot's settings, or create it again.`, setup: false };
    return { message: `\`${cli}\` isn't installed, or isn't on this app's PATH`, setup: true };
  }
  if (err.code === "EACCES" || err.code === "EPERM")
    return { message: `\`${cli}\` isn't executable — check its file permissions`, setup: true };
  if (err.code === "ENAMETOOLONG")
    return {
      message: `\`${cli}\` received too much launch data for Windows; update this provider or pass its prompt through stdin/a file`,
      setup: false,
    };
  return { message: `spawn failed: ${err.message}`, setup: false };
}

/** Stop an owned CLI group, including helpers after its root exits. timeoutMs
 * is the TERM grace period; SIGKILL gets one further second to settle. On Linux,
 * helpers captured before they reparented (sandbox jobs that leave the group
 * during a protocol interrupt) are signalled individually and must exit before
 * success. Helpers daemonized before capture remain outside this ownership. */
export function killCliTree(child: ChildProcess, timeoutMs = 5_000): Promise<boolean> {
  const existing = stopping.get(child);
  if (existing) return existing;
  const pid = child.pid;
  if (!pid) return Promise.resolve(true);
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return Promise.resolve(false);

  captureCliTree(child);
  const run = stopCliTree(child, pid, Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 5_000);
  stopping.set(child, run);
  // A failed attempt may be retried. Remember success so a delayed caller
  // cannot signal a reused PID/group after this child's group disappeared.
  void run.then((stopped) => { if (!stopped) stopping.delete(child); });
  return run;
}

async function stopCliTree(child: ChildProcess, pid: number, timeoutMs: number): Promise<boolean> {
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  if (process.platform !== "win32") {
    const group = cliGroups.has(child);
    const settled = () => {
      if (!exited() || !linuxDescendantsStopped(child)) return false;
      if (!group || linuxRootIdentityMatches(child) === false) return true;
      if (linuxRootIdentityMatches(child) === undefined) return false;
      try {
        process.kill(-pid, 0);
        return false;
      } catch (error) {
        // EPERM and other failures do not prove that the group is gone.
        return (error as NodeJS.ErrnoException).code === "ESRCH";
      }
    };
    const signal = (value: NodeJS.Signals) => {
      captureCliTree(child);
      signalLinuxDescendants(child, value);
      try {
        // Signal the live root group even when start identity was never recorded
        // (f827be010): an exited root with a matching identity, or a still-live
        // root, still owns its group. A reused pid (identity mismatch) does not.
        if (group && (!exited() || linuxRootIdentityMatches(child) === true)) process.kill(-pid, value);
        else if (!group && !exited()) child.kill(value);
      } catch {
        if (!exited()) {
          try { child.kill(value); } catch { /* report uncertainty below */ }
        }
      }
    };
    const wait = async (ms: number) => {
      const deadline = Date.now() + ms;
      while (!settled()) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          // Timers run before libuv's poll phase reads SIGCHLD: a blocked loop reaches the deadline with the exit unread.
          await new Promise((resolve) => setImmediate(resolve));
          return settled();
        }
        await exitOrDelay(child, Math.min(25, remaining));
      }
      return true;
    };
    if (settled()) return true;
    signal("SIGTERM");
    if (await wait(timeoutMs)) return true;
    signal("SIGKILL");
    return wait(1_000);
  }

  if (exited()) return true;

  return new Promise((resolve) => {
    let timer: NodeJS.Timeout;
    let finished = false;
    const done = (stopped: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.off("close", closed);
      child.off("exit", closed);
      resolve(stopped);
    };
    const closed = () => done(true);
    child.once("close", closed);
    timer = setTimeout(() => done(false), timeoutMs);
    timer.unref?.();

    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (err) => {
      if (finished) return;
      if (!err) {
        // taskkill can finish before Node observes the process exit. Do not
        // report success until both have happened; callers may rename the
        // executable immediately. Conversely, inherited pipes can delay
        // close after exit, so a confirmed exit need not wait for those pipes.
        if (exited()) done(true);
        else child.once("exit", closed);
        return;
      }
      try {
        // taskkill is unavailable or the tree lookup failed. At least stop
        // the process we own instead of leaving the entire turn running.
        child.kill();
      } catch {
        /* already gone */
      }
    });
  });
}

function exitOrDelay(child: ChildProcess, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      child.off("exit", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    child.once("exit", done);
  });
}

/** True once the process itself has exited, within `ms`; members it left in its group are not counted. */
export async function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const deadline = Date.now() + ms;
  while (!exited() && Date.now() < deadline) await exitOrDelay(child, Math.min(250, deadline - Date.now()));
  if (!exited()) await new Promise((resolve) => setImmediate(resolve));
  return exited();
}

/** Unix socket on POSIX, named pipe on Windows (Node cannot listen on a filesystem socket path there: EACCES). */
export function brokerSocketPath(dataDir: string, tag: string): string {
  return process.platform === "win32"
    // Named pipes share a global namespace; DATA_DIR cannot isolate two
    // concurrent app instances the way a POSIX socket directory does.
    ? `\\\\.\\pipe\\openmausbot-perm-${process.pid}-${tag}`
    : join(dataDir, `perm-${tag}.sock`);
}
