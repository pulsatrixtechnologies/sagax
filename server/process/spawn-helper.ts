// Child processes started by a small helper process (#3680).
//
// On Linux, creating a process forks the caller: the kernel copies the page
// tables of the whole caller, and the caller then waits until the child has
// reached its exec. In a server of 1.4 to 1.9 GB with thousands of mappings
// that took 1.2 to 2.0 s of the main thread on a hosted server, and every
// person on it waited (measured in the server's own image, a parent grown to
// 1.4 GB: the stop follows the parent's size, not its environment, its open
// descriptors, its stdio or `detached`; a helper of 40 MB makes it 0.1 ms).
//
// So the server starts this helper once at boot, before it grows, and the
// processes it starts are created by the helper: `spawnChild` is the one way
// to start a child (engines through `spawnCli`, probes and `ps`/`lsof` reads
// through `execChild`, its `execFile` shape). The
// server sends the request over the helper's IPC channel and gets back the
// child's pid and its stdio sockets (passed as handles, so the bytes flow
// between the child and the server directly). The child gets exactly the
// command, arguments, environment, working folder, user and group it would
// get from the server's own `spawn`: they are sent explicitly, never taken
// from the helper.
//
// The helper runs with a lower scheduling priority (CHILD_NICE), which every
// child inherits at fork: a burst of engine starts then leaves the server's
// main thread its processor (the same harness: a parent next to six busy
// children stopped 57 ms per spawn at the same priority, 17 ms with nice 10).
//
// When the helper is down the server starts processes itself and says so in
// one log line; the helper is started again at once, and a request it had not
// answered is retried once on the new one (or started by the server).
import { execFile, spawn, type ChildProcess, type ExecFileOptions, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { Socket } from "node:net";
import { setPriority } from "node:os";
import { basename } from "node:path";
import { performance } from "node:perf_hooks";
import { Duplex, PassThrough, Writable, type Readable } from "node:stream";
import { promisify } from "node:util";

/** The scheduling priority of the processes the server starts (a higher nice
 * value is a lower priority; no privilege is needed to lower one). */
export const CHILD_NICE = 10;

type StdioKind = "pipe" | "ignore" | "inherit";
type Request = {
  op: "spawn";
  id: number;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** One entry per descriptor: 0 to 2, then extra pipes (a browser's DevTools pipe on 3 and 4). */
  stdio: StdioKind[];
  detached: boolean;
  uid?: number;
  gid?: number;
  argv0?: string;
};
type FailureInfo = { code?: string; errno?: number; syscall?: string; path?: string; message: string };
type Reply =
  | { op: "spawned"; id: number; pid: number }
  | { op: "stdio"; id: number; fd: number }
  | { op: "exit"; id: number; code: number | null; signal: NodeJS.Signals | null }
  | { op: "failed"; id: number; error: FailureInfo };

// The helper itself: plain CommonJS run with `node -e`, so it needs no file
// of its own in any bundle. Its stdio reads are stopped before the handles
// are sent, so not one byte of a child's output is read by the helper.
const HELPER_SOURCE = `
"use strict";
const { spawn } = require("node:child_process");
try { require("node:os").setPriority(${CHILD_NICE}); } catch {}
const info = (e) => ({ code: e && e.code, errno: e && e.errno, syscall: e && e.syscall, path: e && e.path, message: String(e && e.message || e) });
const send = (m, h) => { try { process.send(m, h); } catch {} };
const attached = new Set();
process.on("message", (m) => {
  if (m && m.op === "signal") { for (const c of attached) { try { c.kill(m.signal); } catch {} } return; }
  if (!m || m.op !== "spawn") return;
  let child;
  try {
    child = spawn(m.command, m.args, { cwd: m.cwd, env: m.env, stdio: m.stdio, detached: m.detached, uid: m.uid, gid: m.gid, argv0: m.argv0, windowsHide: true });
  } catch (e) { send({ op: "failed", id: m.id, error: info(e) }); return; }
  child.once("error", (e) => { if (!child.pid) send({ op: "failed", id: m.id, error: info(e) }); });
  if (!child.pid) return;
  send({ op: "spawned", id: m.id, pid: child.pid });
  for (let fd = 0; fd < m.stdio.length; fd++) {
    const stream = child.stdio[fd];
    if (m.stdio[fd] !== "pipe" || !stream) continue;
    if (stream._handle && typeof stream._handle.readStop === "function") stream._handle.readStop();
    send({ op: "stdio", id: m.id, fd }, stream);
  }
  if (!m.detached) { attached.add(child); child.once("exit", () => attached.delete(child)); }
  child.once("exit", (code, signal) => send({ op: "exit", id: m.id, code, signal }));
});
process.on("disconnect", () => process.exit(0));
`;

/** Writes made before a child's real socket arrives. #4049: each one is
 * answered, with an error when the stream is destroyed first (the start
 * failed or the child ended), so no caller waits forever on its callback. */
class PendingWrites {
  private queue: Array<{ run: () => void; callback: (error?: Error | null) => void }> = [];

  add(run: () => void, callback: (error?: Error | null) => void): void {
    this.queue.push({ run, callback });
  }

  run(): void {
    for (const { run } of this.queue.splice(0)) run();
  }

  fail(error: Error | null): void {
    const reason = error ?? Object.assign(new Error("the child's stream closed before the child started"), { code: "ERR_STREAM_DESTROYED" });
    for (const { callback } of this.queue.splice(0)) callback(reason);
  }
}

/** The stdin of a child the helper is still starting: writes wait for the real socket. */
class PendingStdin extends Writable {
  private target: Writable | null = null;
  private readonly waiting = new PendingWrites();

  get pending(): boolean {
    return this.target === null;
  }

  attach(target: Writable): void {
    if (this.destroyed) { target.destroy(); return; }
    this.target = target;
    target.on("error", () => this.destroy());
    target.on("close", () => this.destroy());
    this.waiting.run();
  }

  override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.target) this.target.write(chunk, encoding, callback);
    else this.waiting.add(() => this._write(chunk, encoding, callback), callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.target) this.target.end(callback);
    else this.waiting.add(() => this._final(callback), callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.target?.destroy();
    this.waiting.fail(error);
    callback(error);
  }
}

/** An extra pipe (descriptor 3 and up) of a child the helper is still
 * starting: both ways, like Node's own, and joined to the real socket once it
 * arrives. */
class PendingPipe extends Duplex {
  private target: Duplex | null = null;
  private readonly waiting = new PendingWrites();

  get pending(): boolean {
    return this.target === null;
  }

  attach(target: Duplex): void {
    if (this.destroyed) { target.destroy(); return; }
    this.target = target;
    target.on("data", (chunk: Buffer) => { if (!this.push(chunk)) target.pause(); });
    target.on("end", () => this.push(null));
    target.on("error", () => this.destroy());
    target.on("close", () => {
      this.push(null);
      if (this.readableEnded || this.readableLength === 0) this.destroy();
      else this.once("end", () => this.destroy());
    });
    this.waiting.run();
  }

  override _read(): void {
    this.target?.resume();
  }

  override _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.target) this.target.write(chunk, encoding, callback);
    else this.waiting.add(() => this._write(chunk, encoding, callback), callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.target) this.target.end(callback);
    else this.waiting.add(() => this._final(callback), callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.target?.destroy();
    this.waiting.fail(error);
    callback(error);
  }
}

const childrenById = new Map<number, HelperChild>();

/** What `spawn` returns, for a child the helper starts. It has the members the
 * server's callers read: pid (once started), stdio, exitCode, signalCode,
 * killed, kill, and the spawn, error, exit and close events. */
export class HelperChild extends EventEmitter {
  pid: number | undefined = undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  readonly connected = false;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly stdio: Array<Writable | Readable | Duplex | null>;
  readonly spawnfile: string;
  readonly spawnargs: string[];
  /** Settles once the child is started or failed to start. */
  readonly started: Promise<void>;
  private settleStarted!: () => void;
  private queuedSignals: Array<NodeJS.Signals | number> = [];
  private closesNeeded = 0;
  private closed = false;
  private failed = false;
  /** True until the helper says the child started or failed to (#3901: a
   * failed child has no pid either, but it is not starting any more). */
  get starting(): boolean {
    return this.pid === undefined && !this.failed;
  }
  private watch: NodeJS.Timeout | null = null;

  request: Request;

  constructor(request: Request) {
    super();
    this.request = request;
    this.spawnfile = request.command;
    this.spawnargs = [request.argv0 ?? request.command, ...request.args];
    this.stdin = request.stdio[0] === "pipe" ? new PendingStdin() : null;
    this.stdout = request.stdio[1] === "pipe" ? new PassThrough() : null;
    this.stderr = request.stdio[2] === "pipe" ? new PassThrough() : null;
    this.stdio = [this.stdin, this.stdout, this.stderr, ...request.stdio.slice(3).map((kind) => (kind === "pipe" ? new PendingPipe() : null))];
    for (const stream of [this.stdout, this.stderr]) {
      if (!stream) continue;
      this.closesNeeded++;
      stream.once("close", () => { this.closesNeeded--; this.maybeClose(); });
    }
    this.started = new Promise((resolve) => { this.settleStarted = resolve; });
  }

  kill(signal: NodeJS.Signals | number = "SIGTERM"): boolean {
    if (this.exitCode !== null || this.signalCode !== null || this.failed) return false;
    if (this.pid === undefined) {
      this.queuedSignals.push(signal);
      return true;
    }
    try {
      process.kill(this.pid, signal);
      this.killed = true;
      return true;
    } catch {
      return false;
    }
  }

  ref(): void {}
  unref(): void {}

  onSpawned(pid: number): void {
    if (this.pid !== undefined || this.failed) return;
    this.pid = pid;
    this.settleStarted();
    this.emit("spawn");
    for (const signal of this.queuedSignals.splice(0)) this.kill(signal);
  }

  onStdio(fd: number, stream: Socket | Writable | Readable): void {
    if (fd >= 3) {
      const pending = this.stdio[fd];
      if (pending instanceof PendingPipe) pending.attach(stream as Duplex);
      else (stream as Socket).destroy?.();
      return;
    }
    if (fd === 0 && this.stdin instanceof PendingStdin) {
      // The helper's socket is a socketpair end and reads too: what it reads
      // (nothing, from a child's stdin) is let go.
      (stream as Socket).resume?.();
      this.stdin.attach(stream as Socket);
      return;
    }
    const out = fd === 1 ? this.stdout : this.stderr;
    if (!out) return;
    const source = stream as Readable;
    source.on("error", () => (out as PassThrough).destroy());
    source.pipe(out as PassThrough);
  }

  onExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    if (this.watch) clearInterval(this.watch);
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
    // #4049: a pipe whose socket never came can take no more writes; the
    // ones waiting for it are answered with an error.
    for (const stream of this.stdio) if ((stream instanceof PendingStdin || stream instanceof PendingPipe) && stream.pending) stream.destroy();
    // As Node does at exit: an output nobody reads is drained so it can end.
    for (const stream of [this.stdout, this.stderr]) if (stream && stream.readableFlowing === null) stream.resume();
    this.maybeClose();
  }

  onFailed(error: FailureInfo): void {
    if (this.pid !== undefined || this.failed) return;
    this.failed = true;
    this.settleStarted();
    const err = Object.assign(new Error(error.message), {
      code: error.code, errno: error.errno, syscall: error.syscall, path: error.path, spawnargs: this.spawnargs.slice(1),
    });
    this.exitCode = typeof error.errno === "number" ? error.errno : -1;
    this.emit("error", err);
    this.stdin?.destroy();
    this.stdout?.destroy();
    this.stderr?.destroy();
    for (const extra of this.stdio.slice(3)) extra?.destroy();
    this.maybeClose();
  }

  /** The helper went away after starting this child: its end is read from
   * /proc, without its exit status. */
  watchWithoutHelper(): void {
    if (this.pid === undefined || this.exitCode !== null || this.signalCode !== null || this.watch) return;
    const pid = this.pid;
    const gone = () => {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
        return state === "Z" || state === "X";
      } catch {
        try { process.kill(pid, 0); return false; } catch { return true; }
      }
    };
    this.watch = setInterval(() => { if (gone()) this.onExit(null, "SIGKILL"); }, 1_000);
    this.watch.unref?.();
  }

  /** The helper went away before answering: the server starts the child itself. */
  adopt(real: ChildProcess): void {
    real.once("spawn", () => this.onSpawned(real.pid!));
    real.on("error", (error: NodeJS.ErrnoException) => {
      if (real.pid === undefined) this.onFailed({ code: error.code, errno: error.errno, syscall: error.syscall, path: error.path, message: error.message });
      else this.emit("error", error);
    });
    real.once("exit", (code, signal) => this.onExit(code, signal));
    if (real.stdin) this.onStdio(0, real.stdin);
    if (real.stdout) this.onStdio(1, real.stdout);
    if (real.stderr) this.onStdio(2, real.stderr);
    real.stdio.forEach((stream, fd) => { if (fd >= 3 && stream) this.onStdio(fd, stream as Duplex); });
  }

  private maybeClose(): void {
    if (this.closed || this.closesNeeded > 0 || (this.exitCode === null && this.signalCode === null)) return;
    this.closed = true;
    childrenById.delete(this.request.id);
    if (childrenById.size === 0) helper?.channel?.unref();
    this.emit("close", this.exitCode, this.signalCode);
  }
}

let wanted = false;
let helper: ChildProcess | null = null;
let helperDown = false;
let launchedAt = 0;
let retryAt = 0;
let nextId = 0;
/** A helper that dies this soon after its start is not started again at once. */
const QUICK_DEATH_MS = 1_000;
const RETRY_MS = 10_000;
let log: (line: string) => void = (line) => console.warn(line);

/** A Ctrl+C on the server's terminal signals the server's process group; the
 * helper runs in a group of its own, so the server passes the signal on and
 * the helper gives it to the children that are not detached, the ones that
 * would have been in the server's group (#3709). A process with no SIGINT
 * handler of its own still ends on it, once the helper has the signal. */
function passInterrupt(): void {
  const alone = process.listenerCount("SIGINT") === 1;
  const end = () => {
    if (!alone) return;
    process.off("SIGINT", passInterrupt);
    process.kill(process.pid, "SIGINT");
  };
  if (!helper?.connected) return end();
  try { helper.send({ op: "signal", signal: "SIGINT" }, end); } catch { end(); }
}

/** Start the helper (the server calls this once at boot). */
export function startSpawnHelper(options: { log?: (line: string) => void } = {}): void {
  if (options.log) log = options.log;
  if (!wanted) process.on("SIGINT", passInterrupt);
  wanted = true;
  if (!helper) launch();
}

/** Stop the helper; later spawns are the server's own again. */
export function stopSpawnHelper(): void {
  wanted = false;
  process.off("SIGINT", passInterrupt);
  const current = helper;
  helper = null;
  if (current && current.exitCode === null && current.signalCode === null) current.kill("SIGKILL");
}

/** The helper's pid while it runs. */
export function spawnHelperPid(): number | undefined {
  return helper?.pid;
}

function launch(): void {
  // The helper needs no variable of the server's (each child gets its own
  // environment in its request), so none of them sits in its /proc environ;
  // NODE_OPTIONS would give it the server's flags (an inspector port).
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, ["--max-old-space-size=64", "-e", HELPER_SOURCE], {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      env,
      // Its own group: a Ctrl+C on the server's terminal is not the helper's.
      detached: true,
      windowsHide: true,
    });
  } catch (error) {
    markDown(`could not start: ${(error as Error).message}`);
    return;
  }
  helper = child;
  launchedAt = Date.now();
  if (helperDown) log("[spawn-helper] back; processes are started by the helper again");
  helperDown = false;
  child.unref();
  child.channel?.unref();
  child.on("message", (message: Reply, handle?: Socket) => onReply(message, handle));
  child.once("error", (error) => lost(child, error.message));
  child.once("exit", (code, signal) => lost(child, signal ? `stopped by ${signal}` : `exited with ${code}`));
}

function markDown(reason: string): void {
  if (!helperDown) log(`[spawn-helper] down (${reason}); the server starts processes itself until it is back`);
  helperDown = true;
}

function lost(child: ChildProcess, reason: string): void {
  if (helper !== child) return;
  helper = null;
  markDown(reason);
  const unanswered: HelperChild[] = [];
  for (const proxy of childrenById.values()) {
    if (proxy.pid === undefined) unanswered.push(proxy);
    else proxy.watchWithoutHelper();
  }
  if (!wanted) return;
  if (Date.now() - launchedAt < QUICK_DEATH_MS) retryAt = Date.now() + RETRY_MS;
  else launch();
  // Retried once: on the new helper, else by the server.
  for (const proxy of unanswered) {
    childrenById.delete(proxy.request.id);
    if (!resend(proxy)) proxy.adopt(spawnDirect(proxy.request));
  }
}

function onReply(message: Reply, handle?: Socket): void {
  const proxy = childrenById.get(message.id);
  if (!proxy) {
    handle?.destroy();
    return;
  }
  if (message.op === "spawned") proxy.onSpawned(message.pid);
  else if (message.op === "stdio" && handle) proxy.onStdio(message.fd, handle);
  else if (message.op === "exit") proxy.onExit(message.code, message.signal);
  else if (message.op === "failed") proxy.onFailed(message.error);
}

function resend(proxy: HelperChild): boolean {
  const current = helper;
  if (!current?.connected) return false;
  const id = ++nextId;
  const request = { ...proxy.request, id };
  proxy.request = request;
  childrenById.set(id, proxy);
  current.channel?.ref();
  try {
    current.send(request);
    return true;
  } catch {
    childrenById.delete(id);
    return false;
  }
}

function stdioKinds(stdio: SpawnOptions["stdio"]): StdioKind[] | null {
  const one = (value: unknown): StdioKind | null =>
    value === undefined || value === null || value === "pipe" ? "pipe" : value === "ignore" || value === "inherit" ? value : null;
  if (stdio === undefined || typeof stdio === "string") {
    const kind = one(stdio);
    return kind ? [kind, kind, kind] : null;
  }
  if (!Array.isArray(stdio)) return null;
  const kinds = [0, 1, 2].map((fd) => one(stdio[fd]));
  // Extra descriptors: pipes only ("ipc" and handles stay with the server's own spawn).
  for (const extra of stdio.slice(3)) kinds.push(extra === "pipe" ? "pipe" : extra === "ignore" || extra === null || extra === undefined ? "ignore" : null);
  return kinds.every(Boolean) ? kinds as StdioKind[] : null;
}

// `signal` and `killSignal` stay in the server: an abort stops the child with
// `killSignal` and reports an AbortError, as Node's own spawn does.
const SUPPORTED = new Set(["cwd", "env", "stdio", "detached", "uid", "gid", "argv0", "windowsHide", "shell", "signal", "killSignal"]);

function requestFor(command: string, args: readonly string[], options: SpawnOptions): Request | null {
  if (Object.keys(options).some((key) => !SUPPORTED.has(key) && (options as Record<string, unknown>)[key] !== undefined)) return null;
  if (options.shell || (options.cwd !== undefined && typeof options.cwd !== "string")) return null;
  const stdio = stdioKinds(options.stdio);
  if (!stdio) return null;
  return {
    op: "spawn",
    id: ++nextId,
    command,
    args: [...args],
    // The server's own, read now: the child never sees the helper's.
    cwd: options.cwd ?? process.cwd(),
    env: { ...(options.env ?? process.env) },
    stdio,
    detached: options.detached === true,
    ...(options.uid !== undefined ? { uid: options.uid } : {}),
    ...(options.gid !== undefined ? { gid: options.gid } : {}),
    ...(options.argv0 !== undefined ? { argv0: options.argv0 } : {}),
  };
}

function spawnDirect(request: Request): ChildProcess {
  const { command, args, op: _op, id: _id, ...options } = request;
  return spawnNiced(command, args, options);
}

/** The server's own spawn, at the children's priority while the helper is wanted. */
function spawnNiced(command: string, args: readonly string[], options: SpawnOptions): ChildProcess {
  const child = spawn(command, args, options);
  if (wanted && child.pid) {
    try { setPriority(child.pid, CHILD_NICE); } catch { /* the child keeps the server's priority */ }
  }
  return child;
}

/** The error an aborted start reports, as Node's spawn and execFile give it. */
function abortError(reason: unknown): Error {
  return Object.assign(new Error("The operation was aborted", { cause: reason }), { name: "AbortError", code: "ABORT_ERR" });
}

/** An AbortSignal on a helper's child: stopped with `killSignal`, then an
 * AbortError, as Node's spawn does with its own `signal` option. */
function abortOnSignal(child: HelperChild, signal: AbortSignal | undefined, killSignal: NodeJS.Signals | number | undefined): void {
  if (!signal) return;
  const abort = () => {
    if (child.kill(killSignal ?? "SIGTERM")) child.emit("error", abortError(signal.reason));
  };
  if (signal.aborted) {
    process.nextTick(abort);
    return;
  }
  signal.addEventListener("abort", abort, { once: true });
  child.once("close", () => signal.removeEventListener("abort", abort));
}

/** #3598: a start whose synchronous part (on the server's main thread) takes
 * this long is logged, with the program's name, the server's resident memory
 * and the starts of the same stretch. */
export const SLOW_START_MS = 100;
/** #3598: the starts one synchronous stretch of the main thread may make
 * (a turn's engine with its probe, a hook and a read): past it the stretch
 * is logged with its programs, and a test fails when a turn's preparation
 * goes past it. */
export const STRETCH_STARTS_LIMIT = 4;

/** The starts made since the main thread last gave the loop back. */
let stretch: { starts: number; ms: number; programs: string[] } | null = null;

/** The program's own name, never its folder (a person's path) nor its arguments. */
function programName(command: string): string {
  return basename(command) || "?";
}

function endStretch(): void {
  const done = stretch;
  stretch = null;
  if (done && done.starts > STRETCH_STARTS_LIMIT) {
    log(`[spawn-stretch] ${done.starts} process starts in one synchronous stretch (${Math.round(done.ms)} ms): ${done.programs.join(", ")}`);
  }
}

/** Count one start in the current stretch, and log it when its synchronous
 * part was slow (#3598). Names and numbers only. */
export function noteProcessStart(command: string, ms: number): void {
  const program = programName(command);
  if (!stretch) {
    stretch = { starts: 0, ms: 0, programs: [] };
    setImmediate(endStretch);
  }
  stretch.starts += 1;
  stretch.ms += ms;
  stretch.programs.push(program);
  if (ms >= SLOW_START_MS) {
    const rssMb = Math.round(process.memoryUsage.rss() / (1024 * 1024));
    log(`[spawn-slow] ${program} took ${Math.round(ms)} ms on the main thread to start; server rss ${rssMb} MB; start ${stretch.starts} of this stretch (${Math.round(stretch.ms)} ms)`);
  }
}

/**
 * `spawn`, through the helper when it runs. Same arguments and the same kind
 * of result; with options the helper does not carry (a stream as stdio,
 * extra descriptors, a timeout), or while it is down, the server spawns itself.
 */
function spawnChildImpl(command: string, argsOrOptions?: readonly string[] | SpawnOptions, maybeOptions?: SpawnOptions): ChildProcess {
  const startedAt = performance.now();
  try {
    return startChild(command, argsOrOptions, maybeOptions);
  } finally {
    noteProcessStart(command, performance.now() - startedAt);
  }
}

function startChild(command: string, argsOrOptions?: readonly string[] | SpawnOptions, maybeOptions?: SpawnOptions): ChildProcess {
  const args = Array.isArray(argsOrOptions) ? argsOrOptions as readonly string[] : [];
  const options: SpawnOptions = (Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions as SpawnOptions | undefined) ?? {};
  const current = wanted && !helperDown ? helper : null;
  const request = current?.connected ? requestFor(command, args, options) : null;
  if (!current || !request) {
    if (wanted && !helper && Date.now() >= retryAt) launch();
    return spawnNiced(command, args, options);
  }
  const proxy = new HelperChild(request);
  childrenById.set(request.id, proxy);
  abortOnSignal(proxy, options.signal, options.killSignal);
  current.channel?.ref();
  try {
    current.send(request);
  } catch {
    childrenById.delete(request.id);
    proxy.adopt(spawnDirect(request));
  }
  return proxy as unknown as ChildProcess;
}

/** Typed as Node's `spawn` (its overloads give each stdio shape its stream
 * types), so a caller changes only the name. */
export const spawnChild = spawnChildImpl as typeof spawn;

/** What `execFile` takes, for `execChild`. */
export type ExecChildOptions = Omit<SpawnOptions, "stdio"> & {
  timeout?: number;
  killSignal?: NodeJS.Signals | number;
  maxBuffer?: number;
  encoding?: BufferEncoding | "buffer" | null;
};
/** The error of a run that failed, as `execFile` gives it. */
export type ExecChildError = Omit<NodeJS.ErrnoException, "code"> & { code?: string | number | null; killed?: boolean; signal?: NodeJS.Signals | null; cmd?: string };

/**
 * `execFile` on `spawnChild`: the child is created by the helper like every
 * other one, its stdout and stderr are collected, and the callback gets the
 * same error, stdout and stderr as `execFile`'s (exit code, `killed` after the
 * timeout, ERR_CHILD_PROCESS_STDIO_MAXBUFFER past maxBuffer).
 */
export function execChild(
  file: string,
  args: readonly string[],
  options: ExecChildOptions,
  callback: (error: ExecChildError | null, stdout: string, stderr: string) => void,
): ChildProcess {
  // No helper here (not Linux, or not started): this is Node's own execFile.
  if (!wanted) {
    const startedAt = performance.now();
    try {
      return execFile(file, args, options as ExecFileOptions, callback as Parameters<typeof execFile>[3]);
    } finally {
      noteProcessStart(file, performance.now() - startedAt);
    }
  }
  const { timeout = 0, killSignal = "SIGTERM", maxBuffer = 1024 * 1024, encoding = "utf8", ...spawnOptions } = options;
  // An AbortSignal stays with the helper's child too: it is stopped with
  // killSignal and the callback gets the AbortError, as from execFile.
  const child = spawnChild(file, args, { ...spawnOptions, killSignal, stdio: ["pipe", "pipe", "pipe"] });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let outBytes = 0;
  let errBytes = 0;
  let failure: ExecChildError | null = null;
  let killedHere = false;
  let done = false;
  const stop = () => {
    killedHere = true;
    try { child.kill(killSignal); } catch { /* already gone */ }
  };
  const collect = (into: Buffer[], name: "stdout" | "stderr") => (chunk: Buffer) => {
    const size = name === "stdout" ? outBytes : errBytes;
    const room = Math.max(0, maxBuffer - size);
    into.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
    if (name === "stdout") outBytes += chunk.length;
    else errBytes += chunk.length;
    if (chunk.length > room && !failure) {
      failure = Object.assign(new RangeError(`${name} maxBuffer length exceeded`), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
      stop();
    }
  };
  child.stdout?.on("data", collect(out, "stdout"));
  child.stderr?.on("data", collect(err, "stderr"));
  const timer = timeout > 0 ? setTimeout(stop, timeout) : null;
  const text = (chunks: Buffer[]) => {
    const all = Buffer.concat(chunks);
    return (encoding && encoding !== "buffer" ? all.toString(encoding) : all) as unknown as string;
  };
  const finish = (code: number | null, signal: NodeJS.Signals | null) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    const stdout = text(out);
    const stderr = text(err);
    if (!failure && code === 0 && signal === null) {
      callback(null, stdout, stderr);
      return;
    }
    const cmd = [file, ...args].join(" ");
    const error: ExecChildError = failure ?? Object.assign(new Error(`Command failed: ${cmd}\n${stderr}`), {
      code, killed: child.killed || killedHere, signal,
    });
    error.cmd = cmd;
    callback(error, stdout, stderr);
  };
  // Every error is listened to: an abort can come before a failed start.
  child.on("error", (error: NodeJS.ErrnoException) => {
    if (!failure) failure = error;
    child.stdout?.destroy();
    child.stderr?.destroy();
    finish(null, null);
  });
  child.once("close", (code: number | null, signal: NodeJS.Signals | null) => finish(code, signal));
  return child;
}

/** `execChild` as a promise, the shape of `promisify(execFile)`: stdout and
 * stderr on success, else the error carrying them; `child` is the process. */
export function execChildAsync(
  file: string,
  args: readonly string[],
  options: ExecChildOptions = {},
): Promise<{ stdout: string; stderr: string }> & { child: ChildProcess } {
  if (!wanted) {
    const run = promisify(execFile) as unknown as (file: string, args: readonly string[], options: ExecChildOptions) => Promise<{ stdout: string; stderr: string }> & { child?: ChildProcess };
    const pending = run(file, args, { encoding: "utf8", ...options });
    return Object.assign(pending, { child: pending.child! });
  }
  let child!: ChildProcess;
  const done = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    child = execChild(file, args, options, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
  return Object.assign(done, { child });
}

/** Runs `then` with the child's pid once it has one (now, for the server's own children). */
export function whenStarted(child: ChildProcess, then: (pid: number) => void): void {
  if (child.pid) {
    then(child.pid);
    return;
  }
  if ((child as unknown) instanceof HelperChild) void (child as unknown as HelperChild).started.then(() => { if (child.pid) then(child.pid); });
}

/** For a child the helper is still starting, settles once it is started or failed; else null. */
export function pendingStart(child: ChildProcess): Promise<void> | null {
  const proxy = child as unknown;
  return proxy instanceof HelperChild && proxy.starting ? proxy.started : null;
}
