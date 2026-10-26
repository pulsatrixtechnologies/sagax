// One live-control process per remote session. It spawns the control helper
// over the session's tunnel, forwards the technician's input to it only while
// control is granted, streams the helper's frames back to the viewer, and
// tears everything down on release, on a lost connection, or at a hard
// deadline. Nothing the person typed reaches the helper: every event is
// re-validated here and encoded as a fixed line. Input is audited by control
// action, never keystroke by keystroke (Loi 25 minimisation: no key logging).
import { spawn } from "node:child_process";

import {
  coalesceEvents,
  createHelperFrameDecoder,
  encodeControlEvent,
  parseControlEvent,
  type ControlEvent,
  type HelperMeta,
} from "../shared/remote-control.ts";
import type { RemoteSessionOs } from "../shared/remote-session.ts";
import { controlHelperCommand, controlSupported } from "./remote-control-helper.ts";
import { tailcatEnv, tailcatSshArgv } from "./remote-session-probe.ts";

export type ControlStopReason = "released" | "closed" | "deadline" | "helper_exit" | "protocol" | "replaced";

export interface ControlAuditEvent {
  at: number;
  sessionId: string;
  principalId: string;
  botId: string;
  kind: "control.start" | "control.notice" | "control.grant" | "control.release" | "control.stop" | "control.input_blocked";
  reason?: ControlStopReason;
  os?: RemoteSessionOs;
  /** Counts since the last grant, logged on release (never the keys themselves). */
  moves?: number;
  clicks?: number;
  keys?: number;
  chars?: number;
}

/** A spawned helper process, abstracted so a test can drive it. */
export interface ControlProcess {
  writeLine(line: string): void;
  onStdout(cb: (chunk: Uint8Array) => void): void;
  onExit(cb: () => void): void;
  /** Close the helper's stdin: its input loop ends (EOF) and it exits cleanly. */
  endInput(): void;
  kill(): void;
}

export type SpawnControl = (argv: string[]) => ControlProcess;

export interface OpenControl {
  session: { id: string; os: RemoteSessionOs; endAt: string };
  tunnel: { keyPath: string; address: string };
  bin: string;
  principalId: string;
  botId: string;
  /** Shown in the on-screen notice on the end user's computer. */
  technician?: string;
  /** Deliver the remote screen size to the viewer (once, and on change). */
  onMeta(meta: HelperMeta): void;
  /** Deliver one JPEG frame to the viewer. */
  onFrame(bytes: Uint8Array): void;
  /** The session ended on the server side; the viewer should stop. */
  onClosed(reason: ControlStopReason): void;
}

export interface ControlHandle {
  setControl(granted: boolean): void;
  input(events: readonly ControlEvent[]): void;
  /** Lift every key and button held right now (client blur or tab hidden). */
  releaseAll(): void;
  close(reason: ControlStopReason): void;
  readonly granted: boolean;
}

const MAX_SECONDS = 26 * 60 * 60;
const FPS = 6;
const QUALITY = 60;
// At most this many non-move events per second reach the helper; the rest are
// dropped so a runaway client cannot flood the tunnel.
const INPUT_EVENTS_PER_SECOND = 200;

function defaultSpawn(argv: string[]): ControlProcess {
  const child = spawn(argv[0]!, argv.slice(1), { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env: tailcatEnv() });
  child.stdin.on("error", () => { /* broken pipe after the helper exits; close follows */ });
  return {
    writeLine(line) { try { child.stdin.write(`${line}\n`); } catch { /* the process is gone; close follows */ } },
    onStdout(cb) { child.stdout.on("data", (chunk: Buffer) => cb(chunk)); },
    onExit(cb) { child.on("close", cb); child.on("error", cb); },
    endInput() { try { child.stdin.end(); } catch { /* already closed */ } },
    kill() { try { child.kill("SIGTERM"); } catch { /* already gone */ } },
  };
}

export function createRemoteControlSessions(deps: {
  audit: { write(event: ControlAuditEvent): void };
  now?: () => number;
  spawn?: SpawnControl;
}) {
  const now = deps.now ?? (() => Date.now());
  const spawnControl = deps.spawn ?? defaultSpawn;
  const handles = new Map<string, InternalHandle>();

  interface InternalHandle extends ControlHandle {
    id: string;
  }

  function open(input: OpenControl): ControlHandle | { error: string } {
    if (!controlSupported(input.session.os)) {
      return { error: "Live control is available on Windows for now. The screen stays view-only on this computer." };
    }
    const built = controlHelperCommand(input.session.os, {
      fps: FPS,
      quality: QUALITY,
      maxSeconds: deadlineSeconds(input.session.endAt),
      sessionId: input.session.id,
      ...(input.technician ? { technician: input.technician } : {}),
    });
    if (!built) return { error: "Live control is not available on this computer." };

    // A second open for the same session replaces the first (a viewer
    // reconnect): the old process is stopped so it never keeps injecting.
    handles.get(input.session.id)?.close("replaced");

    const proc = spawnControl(tailcatSshArgv(input.bin, input.tunnel.keyPath, input.tunnel.address, built.command));
    // Deliver the program on the first stdin line; the input events follow.
    proc.writeLine(built.preamble.trim());
    const decode = createHelperFrameDecoder();
    let granted = false;
    let closed = false;
    let blockedLogged = false;
    let moves = 0;
    let clicks = 0;
    let keys = 0;
    let chars = 0;
    // What is currently held down, so a release, a close or a replacement can
    // lift every key and button and nothing stays stuck on the remote host.
    const downKeys = new Set<number>();
    const downButtons = new Set<number>();
    let rateWindowStart = now();
    let rateCount = 0;

    const releaseAll = () => {
      for (const b of downButtons) proc.writeLine(encodeControlEvent({ t: "u", b: b as 0 | 1 | 2 }));
      for (const k of downKeys) proc.writeLine(encodeControlEvent({ t: "k", k, d: 0 }));
      downButtons.clear();
      downKeys.clear();
    };

    const audit = (kind: ControlAuditEvent["kind"], extra: Partial<ControlAuditEvent> = {}) => {
      deps.audit.write({ at: now(), sessionId: input.session.id, principalId: input.principalId, botId: input.botId, kind, ...extra });
    };

    const resetCounts = () => { moves = 0; clicks = 0; keys = 0; chars = 0; };

    const close = (reason: ControlStopReason) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (granted) {
        granted = false;
        releaseAll();
        audit("control.release", { moves, clicks, keys, chars });
      }
      handles.delete(input.session.id);
      // End stdin first so the helper's input loop sees EOF and exits cleanly,
      // then kill as a backstop.
      proc.endInput();
      proc.kill();
      audit("control.stop", { reason });
      input.onClosed(reason);
    };

    proc.onStdout((chunk) => {
      if (closed) return;
      const result = decode(chunk);
      if (!Array.isArray(result)) { close("protocol"); return; }
      for (const message of result) {
        if (message.kind === "meta") input.onMeta(message.meta);
        else input.onFrame(message.bytes);
      }
    });
    proc.onExit(() => close("helper_exit"));

    const timer = setTimeout(() => close("deadline"), deadlineSeconds(input.session.endAt) * 1000);
    if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();

    audit("control.start", { os: input.session.os });
    // The helper shows an always-on-top notice on the end user's screen for
    // as long as it runs: record that the person was told control started.
    audit("control.notice");

    const handle: InternalHandle = {
      id: input.session.id,
      get granted() { return granted; },
      setControl(on: boolean) {
        if (closed || on === granted) return;
        granted = on;
        if (on) {
          blockedLogged = false;
          resetCounts();
          audit("control.grant");
        } else {
          releaseAll();
          audit("control.release", { moves, clicks, keys, chars });
          resetCounts();
        }
      },
      input(events) {
        if (closed || !granted) {
          if (!closed && !granted && !blockedLogged) { blockedLogged = true; audit("control.input_blocked"); }
          return;
        }
        for (const ev of coalesceEvents(events)) {
          const valid = parseControlEvent(ev);
          if (!valid) continue;
          if (valid.t === "m") {
            moves++;
          } else {
            // Rate-cap everything but moves so a runaway client cannot flood.
            if (now() - rateWindowStart >= 1000) { rateWindowStart = now(); rateCount = 0; }
            if (rateCount >= INPUT_EVENTS_PER_SECOND) continue;
            rateCount++;
            if (valid.t === "d") { clicks++; downButtons.add(valid.b); }
            else if (valid.t === "u") { downButtons.delete(valid.b); }
            else if (valid.t === "k") { if (valid.d === 1) { keys++; downKeys.add(valid.k); } else { downKeys.delete(valid.k); } }
            else if (valid.t === "x") { chars += valid.s.length; }
          }
          proc.writeLine(encodeControlEvent(valid));
        }
      },
      releaseAll() {
        if (!closed && granted) releaseAll();
      },
      close,
    };
    handles.set(input.session.id, handle);
    return handle;
  }

  function deadlineSeconds(endAt: string): number {
    const end = Date.parse(endAt);
    if (!Number.isFinite(end)) return 60;
    const seconds = Math.floor((end - now()) / 1000);
    return Math.max(1, Math.min(MAX_SECONDS, seconds));
  }

  return {
    open,
    /** Stop control for one session (its stage-1 row was closed). */
    closeSession(id: string, reason: ControlStopReason = "closed") {
      handles.get(id)?.close(reason);
    },
    has(id: string) {
      return handles.has(id);
    },
  };
}

export type RemoteControlSessions = ReturnType<typeof createRemoteControlSessions>;
