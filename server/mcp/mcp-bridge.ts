// The shared stdio bridge for the host computer, Local VM, and BYO VPS.
//
// It is almost transparent — bytes in, bytes out — with three deliberate
// near-side exceptions:
//
//   1. `ping`. The bundled cua-driver (through at least v0.22.1) does not
//      implement this MCP method and would answer with -32601. Answering it
//      here keeps the handshake alive without reaching the driver.
//   2. The who-is-driving `gate` (opt-in via `gate`). Before a `tools/call`
//      reaches the driver, the harness says whether this turn may act now —
//      it waits there while the computer is busy — and a call it holds back
//      is answered here, in its words, and never forwarded.
//   3. `tools/list` schemas. Every engine passes a tool's inputSchema to its
//      model provider, and strict providers refuse a root that is not a plain
//      object — failing the whole turn. The answer to a tools/list is
//      rewritten to a provider-safe root (see mcp-tool-schema.ts); the far
//      end still validates each call against its own schema.
//
// Both behaviors live here so neither entry point can drift:
//   1. Exit without truncation. `process.exit()` in a close/error handler
//      discards whatever is still buffered on stdout — a final MCP result
//      would be cut mid-frame. The bridge sets exitCode and unpipes instead,
//      letting stdio drain before the process ends on its own.
//   2. A dead-transport watchdog (opt-in via `liveness`). docker's ssh
//      connection helper accepts no ConnectTimeout/ServerAlive options, so a
//      VPS dropping mid-turn leaves the exec silently wedged until the OS
//      gives up — the harness sees a hung tool call, not an error.
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import { CONTROL_ACT_WITHIN_MS, CONTROL_UNCONFIRMED, CONTROL_WAITED, controlRefusal, createControlClient, type ControlState } from "../control-client.ts";
import { augmentedPath, resolveCliSpawn } from "../env-path.ts";
import { createToolListNormalizer } from "./mcp-tool-schema.ts";
import { reportBackgroundError } from "../background-error.ts";
import { toolSchemaProfileFromEnv } from "../tool-schema-profile.ts";

// 45s of TOTAL silence before the bridge even probes. An MCP session is
// legitimately quiet between tool calls and a slow screenshot can take tens
// of seconds, so silence alone never kills anything — it only triggers a
// liveness probe, and only a probe that FAILS ends the bridge. Any byte on
// stdin/stdout/stderr resets the window.
export const BRIDGE_INACTIVITY_MS = 45_000;
const PROBE_TIMEOUT_MS = 10_000;

export interface BridgeLiveness {
  command: string;
  args: string[];
}

/** Run the liveness command; alive means "exited 0 within the timeout". A
 * separate bounded command checks the transport without waiting for an
 * answer on the possibly wedged MCP stream. */
export function runLivenessProbe(probe: BridgeLiveness, timeoutMs = PROBE_TIMEOUT_MS, env?: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(probe.command, probe.args, {
      shell: false,
      env: env ?? { ...process.env, PATH: augmentedPath() },
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, timeoutMs);
    timer.unref?.();
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export interface WatchdogHandle {
  /** Any traffic in either direction — resets the inactivity window. */
  touch: () => void;
  stop: () => void;
}

/** Inactivity → probe → (only then) declare dead. Traffic arriving while a
 * probe is in flight vetoes even a failed probe: bytes are better evidence
 * of life than a health command racing a congested link. */
export function createInactivityWatchdog(options: {
  inactivityMs: number;
  probe: () => Promise<boolean>;
  onDead: () => void;
}): WatchdogHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let probing = false;
  let touchedWhileProbing = false;

  const arm = () => {
    if (stopped) return;
    timer = setTimeout(fire, options.inactivityMs);
    timer.unref?.();
  };
  const settleProbe = (alive: boolean) => {
    probing = false;
    if (stopped) return;
    if (alive || touchedWhileProbing) {
      arm();
      return;
    }
    options.onDead();
  };
  const fire = () => {
    probing = true;
    touchedWhileProbing = false;
    void options.probe().then(settleProbe, () => settleProbe(false)).catch(reportBackgroundError);
  };

  arm();
  return {
    touch() {
      if (stopped) return;
      if (probing) {
        touchedWhileProbing = true;
        return;
      }
      if (timer) clearTimeout(timer);
      arm();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export interface BridgeOptions {
  command: string;
  args: string[];
  /** Explicit child environment; absent preserves the existing PATH setup. */
  env?: NodeJS.ProcessEnv;
  /** Names the far end in stderr messages, e.g. "Cua Driver". */
  label: string;
  /** Enables the dead-transport watchdog. Omitted for the Local VM, whose
   * runtime CLI talks to a local daemon and fails fast on its own. */
  liveness?: BridgeLiveness;
  /** Enables the who-is-driving gate: the harness's loopback control
   * endpoint plus its per-boot token. Absent → fully transparent bridge. */
  gate?: { url: string; token: string };
  /** A last look at each whole frame from the child before it reaches the
   * agent (local-computer-guidance.ts). Absent: frames pass as they are. */
  rewriteResponse?: (line: string) => string;
}

/** Collect a byte stream into complete newline-terminated lines. MCP's
 * stdio transport is one JSON-RPC frame per line, so line boundaries are
 * the only safe place to inspect — or inject — anything. */
export function createLineSplitter(onLine: (line: string) => void): {
  push: (chunk: Buffer | string) => void;
  flush: () => void;
} {
  let pending = "";
  const decoder = new StringDecoder("utf8");
  return {
    push(chunk) {
      pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        onLine(line);
      }
    },
    flush() {
      pending += decoder.end();
      if (pending) onLine(pending);
      pending = "";
    },
  };
}

/** The gate itself, factored free of process wiring so a test can drive it
 * with plain strings. Frames are handled on a serialized queue: the
 * check is async, and answering frame N+1 before frame N would
 * reorder the agent's protocol stream. Only a `tools/call` is ever
 * refused; every other frame — handshakes, tools/list, notifications,
 * lines that are not JSON — passes through untouched. A check that throws
 * refuses as unconfirmed, never as a person's hold. A call answered free
 * only after `actWithinMs` from reaching the bridge — the harness held its
 * check while the computer was busy, or it sat in this queue behind another
 * call's — is not forwarded either (CONTROL_ACT_WITHIN_MS). */
export function createGateInterceptor(options: {
  check: () => Promise<ControlState>;
  forward: (line: string) => void;
  refuse: (line: string) => void;
  actWithinMs?: number;
}): (line: string) => Promise<void> {
  const actWithinMs = options.actWithinMs ?? CONTROL_ACT_WITHIN_MS;
  let queue: Promise<void> = Promise.resolve();
  return (line: string) => {
    const arrivedAt = Date.now();
    queue = queue.then(async () => {
      let frame: any = null;
      try {
        frame = JSON.parse(line);
      } catch {
        // not a frame this gate understands — never stand between the
        // agent and its driver on anything but a recognized tool call
      }
      if (!frame || frame.method !== "tools/call") {
        options.forward(line);
        return;
      }
      const state = await options.check().catch((): ControlState => ({ held: true, helpOpen: false, blockedReason: CONTROL_UNCONFIRMED }));
      if (!state.held && Date.now() - arrivedAt <= actWithinMs) {
        options.forward(line);
        return;
      }
      options.refuse(
        JSON.stringify({
          jsonrpc: "2.0",
          id: frame.id ?? null,
          result: { content: [{ type: "text", text: state.held ? controlRefusal(state) : CONTROL_WAITED }], isError: true },
        }),
      );
    });
    return queue;
  };
}

export interface McpBridgeInterceptorOptions {
  /** Writes a JSON-RPC response line to the agent's stdout. */
  answer: (line: string) => void;
  /** Forwards a line to the far-end child. */
  forward: (line: string) => void;
  /** Optional who-is-driving gate; when set, `tools/call` may be refused. */
  gate?: { check: () => Promise<ControlState> };
}

/** The near-side MCP method filter. `ping` is answered here so the bundled
 * cua-driver is never invoked for it; everything else is delegated to the
 * gate (if configured) or forwarded untouched. */
export function createMcpBridgeInterceptor(
  options: McpBridgeInterceptorOptions,
): (line: string) => void | Promise<void> {
  const afterPing = options.gate
    ? createGateInterceptor({ check: options.gate.check, forward: options.forward, refuse: options.answer })
    : (line: string) => { options.forward(line); };
  return (line: string) => {
    let frame: any = null;
    try {
      frame = JSON.parse(line);
    } catch {
      // not a frame this bridge understands — forward untouched
    }
    if (frame && frame.method === "ping") {
      // Notifications have no `id` and require no response.
      if (frame.id !== undefined) {
        options.answer(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }));
      }
      return;
    }
    return afterPing(line);
  };
}

export function runMcpBridge(options: BridgeOptions): void {
  const env = options.env ?? { ...process.env, PATH: augmentedPath() };
  const { command, args } = resolveCliSpawn(options.command, options.args, env);
  const child = spawn(command, args, {
    shell: false,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // docker may exit before it drains stdin; pipe() leaves this error unhandled.
  child.stdin.on("error", () => {});
  child.stderr.pipe(process.stderr);

  const client = options.gate
    ? createControlClient({ url: options.gate.url, token: options.gate.token })
    : null;

  const answer = (line: string) => process.stdout.write(line + "\n");
  const forward = (line: string) => child.stdin.write(line + "\n");
  const intercept = createMcpBridgeInterceptor({
    answer,
    forward,
    ...(client ? { gate: { check: () => client.state(true) } } : {}),
  });
  const toolLists = createToolListNormalizer(toolSchemaProfileFromEnv(), (line) => process.stderr.write(`${options.label}: ${line}\n`));
  let pendingInput = Promise.resolve();
  const inbound = createLineSplitter((line) => {
    toolLists.observeRequest(line);
    const completion = intercept(line);
    if (completion) pendingInput = completion;
  });

  const onStdin = (chunk: Buffer) => inbound.push(chunk);
  process.stdin.on("data", onStdin);
  process.stdin.on("end", () => {
    inbound.flush();
    // A final tools/call can still be awaiting the control endpoint. Do not
    // close the far end before the serialized gate has forwarded it.
    void pendingInput.finally(() => child.stdin.end()).catch(reportBackgroundError);
  });

  // Injected responses and refusals must never land inside one of the
  // child's half-written frames, so the child's stdout is re-emitted at
  // line granularity as well.
  const rewrite = options.rewriteResponse ?? ((line: string) => line);
  const outbound = createLineSplitter((line) => process.stdout.write(rewrite(toolLists.rewriteResponse(line)) + "\n"));
  child.stdout.on("data", (chunk) => outbound.push(chunk));
  child.stdout.on("end", () => outbound.flush());

  const detach = () => {
    process.stdin.off("data", onStdin);
    process.stdin.pause();
  };

  let watchdog: WatchdogHandle | null = null;
  if (options.liveness) {
    const liveness = options.liveness;
    watchdog = createInactivityWatchdog({
      inactivityMs: BRIDGE_INACTIVITY_MS,
      probe: () => runLivenessProbe(liveness, PROBE_TIMEOUT_MS, options.env),
      onDead: () => {
        process.stderr.write(
          `${options.label} transport went silent and stopped answering liveness probes; ending the bridge\n`,
        );
        process.exitCode = 1;
        detach();
        child.kill("SIGKILL");
        // A docker wedged on a dead ssh connection may never deliver close.
        // Nothing can be buffered on stdout after 45 quiet seconds, so this
        // hard exit — unlike the close-handler one this file exists to avoid —
        // cannot truncate anything.
        const failsafe = setTimeout(() => process.exit(1), 2_000);
        failsafe.unref?.();
      },
    });
    const touch = () => watchdog?.touch();
    process.stdin.on("data", touch);
    child.stdout.on("data", touch);
    child.stderr.on("data", touch);
  }

  child.on("error", (error) => {
    process.stderr.write(`could not connect to ${options.label}: ${error.message}\n`);
    process.exitCode = 1;
    watchdog?.stop();
    detach();
  });
  child.on("close", (code, signal) => {
    if (signal) process.stderr.write(`${options.label} connection ended with ${signal}\n`);
    // Let stdout and stderr drain before the bridge exits.
    process.exitCode = process.exitCode ?? code ?? 1;
    watchdog?.stop();
    detach();
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => child.kill(signal));
  }
}
