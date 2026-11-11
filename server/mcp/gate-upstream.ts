// How the MCP gate (mcp-gate.ts) starts the server it stands in front of.
//
// #3623: every mount of an engine turn is a gate process the engine starts,
// and each gate used to start its upstream as a second Node process. On a
// turn with eight or nine mounts that is sixteen to eighteen Node starts at
// once, before the engine can ask any of them for its tool list. A Node
// process costs a few hundred milliseconds of processor to boot; a worker
// thread in the gate's own process costs a tenth of that. Measured on one
// machine, eight upstreams to their first answer: 370 to 440 ms and 2 s of
// processor as processes, 42 to 51 ms and 0.17 s as threads.
//
// Only Sagax's own relays run as a thread: an upstream started with this
// very executable whose script lies beside the gate (the proxies Sagax
// resolves through proxy-paths.ts). They are written for stdin and stdout,
// which a worker started with `stdin: true` and `stdout: true` gives them
// unchanged. Anything else (a person's own server, a wrapper, an executable
// with flags before its script) is a process, exactly as before. Each gate
// still serves one mount of one turn: the thread lives and dies with it and
// sees only the environment the process would have seen.
//
// A relay thread that has not answered the first request written to it
// within THREAD_FIRST_ANSWER_MS, or that fails or ends before answering, gets
// the same relay started beside it as its own process, given every line
// written so far; whichever answers first serves the mount and the other is
// stopped. One bad start costs that much, never the engine's whole wait for
// its tool servers, and a thread that is only slow loses nothing. The gate's
// log names the mount and the time.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { PassThrough, Writable, type Readable } from "node:stream";
import { Worker } from "node:worker_threads";

import { reportBackgroundError } from "../background-error.ts";
import { resolveCliSpawn } from "../env-path.ts";
import { killCliTree } from "../procs.ts";

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

/** How long a relay thread has to answer the first request written to it
 * before the gate starts that relay as its own process. */
export const THREAD_FIRST_ANSWER_MS = 2_000;

/** The script to run in a thread, or undefined when the upstream must be a
 * process: `command` is this executable and `args[0]` a script inside
 * `ownDir` (the gate's own directory). */
export function threadScript(command: string, args: readonly string[], execPath: string, ownDir: string): string | undefined {
  const script = args[0];
  if (!script || command !== execPath || !isAbsolute(script) || !SCRIPT_EXTENSIONS.has(extname(script))) return undefined;
  const inside = relative(resolve(ownDir), resolve(script));
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) return undefined;
  return script;
}

/** When an upstream failed: before it ran (a process that could not be
 * spawned) or while it ran (a thread that threw after answering). */
export type UpstreamFailure = "start" | "run";

export interface GateUpstream {
  /** what serves the mount now: a thread, or a process (from the start, or
   * since a thread that did not answer was replaced) */
  readonly kind: "thread" | "process";
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  /** the upstream ended: its exit code, or 1 when a signal or an error ended it */
  onExit(listener: (code: number) => void): void;
  /** it could not start, or failed while it ran */
  onError(listener: (error: unknown, when: UpstreamFailure) => void): void;
  /** Ends it at once (the gate is going away). */
  kill(): void;
  /** Ends it the way the engine ended the gate: a process gets the signal
   * and shuts down on its own; a thread sees its input close and gets
   * `graceMs` to shut down (a remote relay closes its session), then stops. */
  shutdown(graceMs: number): Promise<void>;
}

interface StartInput {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  ownDir: string;
  execPath?: string;
  /** the mount's name, for the gate's log */
  name?: string;
  /** where the gate logs (its stderr) */
  log?: (line: string) => void;
  /** tests only: the first-answer limit of a relay thread */
  firstAnswerMs?: number;
  /** tests only: starts the thread (default: a worker on `script`) */
  startThread?: (script: string, options: { argv: string[]; env: NodeJS.ProcessEnv }) => Worker;
}

export function startGateUpstream(input: StartInput): GateUpstream {
  const script = threadScript(input.command, input.args, input.execPath ?? process.execPath, input.ownDir);
  return script ? startThreadUpstream(script, input) : startProcessUpstream(input);
}

function startProcessUpstream(input: StartInput): GateUpstream {
  // The CLI used to spawn this server itself, on every platform, so the gate
  // has to spawn it exactly as well. On Windows CreateProcess cannot exec an
  // npm .cmd shim or a node-shebang script, which is what `npx -y mcp-remote`
  // is: resolveCliSpawn rewrites it to the real executable without a shell, so
  // quoting-sensitive JSON argv survives. A shell here would re-interpret the
  // server's own arguments.
  const resolved = resolveCliSpawn(input.command, [...input.args]);
  const child = spawn(resolved.command, resolved.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: input.env,
    shell: false,
    // a console app spawned from the desktop shell flashes a window otherwise
    ...(process.platform === "win32" ? { windowsHide: true } : {}),
  });
  // If the gate is killed rather than closed (the CLI reaping its MCP
  // servers at the end of a turn), the real server must not be left behind,
  // and on Windows only taskkill /T reaps a tree.
  let reaping = false;
  const reap = () => {
    if (reaping) return;
    reaping = true;
    void killCliTree(child).catch(reportBackgroundError);
  };
  return {
    kind: "process",
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    onExit: (listener) => { child.on("exit", (code, signal) => listener(code ?? (signal ? 1 : 0))); },
    onError: (listener) => { child.on("error", (error) => listener(Object.assign(error, { command: resolved.command }), "start")); },
    kill: reap,
    shutdown: async () => { reap(); },
  };
}

function startThreadUpstream(script: string, input: StartInput): GateUpstream {
  const log = input.log ?? ((line: string) => { process.stderr.write(line); });
  const label = input.name ?? script;
  const limitMs = input.firstAnswerMs ?? THREAD_FIRST_ANSWER_MS;
  // What the gate reads and writes stays the same streams for the gate's
  // whole life; behind them is the thread, or the process started for it.
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const exitListeners: Array<(code: number) => void> = [];
  const errorListeners: Array<(error: unknown, when: UpstreamFailure) => void> = [];
  /** every chunk written before the first answer, for a process started later */
  const written: Buffer[] = [];
  let inputEnded = false;
  let firstWriteAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** the relay as its own process, once the thread was late or failed */
  let fallback: GateUpstream | undefined;
  let fallbackEnded = false;
  /** which one answered first and serves the mount from then on */
  let winner: "thread" | "process" | undefined;

  const worker = (input.startThread ?? ((file, options) => new Worker(file, { ...options, stdin: true, stdout: true, stderr: true })))(
    script, { argv: input.args.slice(1), env: input.env },
  );
  let exited = false;
  const done = once(worker, "exit").then(() => { exited = true; }, () => { exited = true; });
  worker.stderr.pipe(stderr, { end: false });

  /** Relays one source's output once it is the winner; the first answer of
   * either one makes it the winner and stops the other. */
  const relay = (who: "thread" | "process", source: Readable) => {
    source.on("data", (chunk: Buffer) => {
      if (winner === undefined) win(who);
      if (winner !== who) return;
      if (!stdout.write(chunk)) {
        source.pause();
        stdout.once("drain", () => source.resume());
      }
    });
    source.once("end", () => { if (winner === who) stdout.end(); });
  };
  const win = (who: "thread" | "process") => {
    winner = who;
    written.length = 0;
    if (timer) clearTimeout(timer);
    if (who === "process") {
      worker.stderr.unpipe(stderr);
      if (!exited) void worker.terminate().catch(reportBackgroundError);
    } else if (fallback) {
      fallback.stderr.unpipe(stderr);
      fallback.kill();
    }
  };
  relay("thread", worker.stdout);

  /** The thread is late or failed: the same relay as its own process, given
   * every line written so far. The thread keeps its chance until one of the
   * two answers, so a thread that is only slow loses nothing. */
  const startFallback = (why: string) => {
    if (fallback || winner !== undefined) return;
    if (timer) clearTimeout(timer);
    log(`mcp-gate(${label}): the relay thread ${why}; starting it as its own process\n`);
    const started = startProcessUpstream(input);
    fallback = started;
    relay("process", started.stdout);
    started.stderr.pipe(stderr, { end: false });
    // a process stopped because the thread answered first may still be
    // flushing a line written to it: that is no failure of the gate
    started.stdin.on("error", (error) => { if (winner !== "thread") reportBackgroundError(error); });
    started.onExit((code) => {
      fallbackEnded = true;
      if (winner === "process" || (winner === undefined && exited)) for (const listener of exitListeners) listener(code);
    });
    started.onError((error, when) => {
      if (winner === "process" || (winner === undefined && exited)) for (const listener of errorListeners) listener(error, when);
    });
    for (const chunk of written) started.stdin.write(chunk);
    if (inputEnded) started.stdin.end();
  };

  const threadLost = () => winner === undefined && !inputEnded;
  worker.on("error", (error) => {
    if (threadLost() && !fallback) return startFallback(`failed before its first answer (${String(error)})`);
    if (winner === "thread") for (const listener of errorListeners) listener(error, "run");
  });
  worker.on("exit", (code) => {
    if (threadLost() && firstWriteAt !== undefined && !fallback) return startFallback(`ended (code ${code}) before its first answer`);
    if (winner === "thread" || (winner === undefined && (!fallback || fallbackEnded))) for (const listener of exitListeners) listener(code ?? 1);
  });

  const forward = (target: Writable, chunk: Buffer): Promise<void> | undefined =>
    target.write(chunk) ? undefined : new Promise((settle) => target.once("drain", () => settle()));
  const stdin = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (winner === undefined) {
        written.push(chunk);
        if (firstWriteAt === undefined) {
          firstWriteAt = Date.now();
          timer = setTimeout(() => startFallback(`did not answer its first request in ${Date.now() - firstWriteAt!} ms`), limitMs);
          timer.unref?.();
        }
      }
      const waits: Array<Promise<void>> = [];
      if (winner !== "process" && !exited) { const wait = forward(worker.stdin!, chunk); if (wait) waits.push(wait); }
      if (winner !== "thread" && fallback && !fallbackEnded) { const wait = forward(fallback.stdin, chunk); if (wait) waits.push(wait); }
      if (!waits.length) return callback();
      void Promise.all(waits).then(() => callback());
    },
    final(callback) {
      inputEnded = true;
      if (winner !== "process" && !exited) worker.stdin!.end();
      if (winner !== "thread" && fallback) fallback.stdin.end();
      callback();
    },
  });
  stdin.on("error", reportBackgroundError);

  return {
    get kind() { return winner === "process" ? "process" as const : "thread" as const; },
    stdin,
    stdout,
    stderr,
    onExit: (listener) => { exitListeners.push(listener); },
    onError: (listener) => { errorListeners.push(listener); },
    kill: () => {
      if (timer) clearTimeout(timer);
      fallback?.kill();
      if (!exited) void worker.terminate();
    },
    shutdown: async (graceMs) => {
      if (timer) clearTimeout(timer);
      if (winner !== "thread" && fallback) await fallback.shutdown(graceMs);
      if (winner === "process" || exited) return;
      stdin.end();
      let grace: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([done, new Promise<void>((settle) => { grace = setTimeout(settle, graceMs); })]);
      if (grace) clearTimeout(grace);
      if (!exited) await worker.terminate();
    },
  };
}
