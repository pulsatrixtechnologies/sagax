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
import { spawn } from "node:child_process";
import { once } from "node:events";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { Worker } from "node:worker_threads";

import { reportBackgroundError } from "../background-error.ts";
import { resolveCliSpawn } from "../env-path.ts";
import { killCliTree } from "../procs.ts";

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

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

export interface GateUpstream {
  kind: "thread" | "process";
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  /** the upstream ended: its exit code, or 1 when a signal or an error ended it */
  onExit(listener: (code: number) => void): void;
  /** it could not start (a process) or threw (a thread) */
  onError(listener: (error: unknown) => void): void;
  /** Ends it at once (the gate is going away). */
  kill(): void;
  /** Ends it the way the engine ended the gate: a process gets the signal
   * and shuts down on its own; a thread sees its input close and gets
   * `graceMs` to shut down (a remote relay closes its session), then stops. */
  shutdown(graceMs: number): Promise<void>;
}

export function startGateUpstream(input: {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  ownDir: string;
  execPath?: string;
}): GateUpstream {
  const script = threadScript(input.command, input.args, input.execPath ?? process.execPath, input.ownDir);
  if (script) {
    const worker = new Worker(script, {
      argv: input.args.slice(1),
      env: input.env,
      stdin: true,
      stdout: true,
      stderr: true,
    });
    let exited = false;
    const done = once(worker, "exit").then(() => { exited = true; }, () => { exited = true; });
    return {
      kind: "thread",
      stdin: worker.stdin!,
      stdout: worker.stdout,
      stderr: worker.stderr,
      onExit: (listener) => { worker.on("exit", (code) => listener(code ?? 1)); },
      onError: (listener) => { worker.on("error", listener); },
      kill: () => { if (!exited) void worker.terminate(); },
      shutdown: async (graceMs) => {
        if (exited) return;
        worker.stdin?.end();
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([done, new Promise<void>((settle) => { timer = setTimeout(settle, graceMs); })]);
        if (timer) clearTimeout(timer);
        if (!exited) await worker.terminate();
      },
    };
  }
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
    onError: (listener) => { child.on("error", (error) => listener(Object.assign(error, { command: resolved.command }))); },
    kill: reap,
    shutdown: async () => { reap(); },
  };
}
