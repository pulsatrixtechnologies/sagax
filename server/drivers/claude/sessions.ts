/** Claude session lifecycle helpers (stop/close/idle/warm/control) (#1383). */
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalMode } from "../../../shared/approval-mode.ts";
import { newId } from "../../contracts.ts";
import { killCliTree } from "../../procs.ts";
import { appendNative } from "../native.ts";
import { resolveClaudeConfigDir } from "./config.ts";
import { UNDELIVERED_VOLATILE, diagnosticClaudeUserMessage, type ClaudeUserMessage } from "./messages.ts";
import type { ClaudeSession } from "./session-types.ts";
import type { ClaudeActiveTurn, HeldVolatile } from "./turn-deps.ts";

/** How long a control request on the CLI's stdin waits for its answer. */
export const CONTROL_REQUEST_TIMEOUT_MS = 5_000;

export type SessionHelperDeps = {
  environment: (model?: string | null, access?: any) => NodeJS.ProcessEnv | Record<string, string | undefined>;
  sessions: Map<string, ClaudeSession>;
  active: Map<string, ClaudeActiveTurn>;
  warmContracts: Map<string, unknown>;
  warmHolds: Map<string, number>;
  heldVolatile: Map<string, HeldVolatile>;
  sessionConfigDirs: Map<string, string>;
  sessionFiles: Map<string, string>;
  sessionMisses: Map<string, number>;
  liveApprovalModes: Map<string, { turnId: string; mode: ApprovalMode }>;
  SESSION_IDLE_MS: number;
};

export function createSessionHelpers(deps: SessionHelperDeps) {
  const {
    environment, sessions, active, warmContracts, warmHolds, heldVolatile,
    sessionConfigDirs, sessionFiles, sessionMisses, liveApprovalModes, SESSION_IDLE_MS,
  } = deps;

  /** Size of a saved session's file (<config>/projects/<cwd>/<id>.jsonl),
   * the file a --resume parses and replays. */
  const sessionFileBytes = (sessionId: string): number | undefined => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return undefined;
    const cached = sessionFiles.get(sessionId);
    if (cached) {
      try { return statSync(cached).size; } catch { sessionFiles.delete(sessionId); }
    }
    if ((sessionMisses.get(sessionId) ?? 0) > Date.now()) return undefined;
    const dirs = new Set<string>();
    const known = sessionConfigDirs.get(sessionId);
    if (known) dirs.add(known);
    try { dirs.add(resolveClaudeConfigDir(undefined, environment())); } catch { /* ignore */ }
    for (const dir of dirs) {
      let entries: string[];
      try { entries = readdirSync(join(dir, "projects")); } catch { continue; }
      for (const entry of entries) {
        const file = join(dir, "projects", entry, `${sessionId}.jsonl`);
        try {
          const size = statSync(file).size;
          sessionFiles.set(sessionId, file);
          if (sessionFiles.size > 500) sessionFiles.delete(sessionFiles.keys().next().value!);
          return size;
        } catch { /* miss */ }
      }
    }
    sessionMisses.set(sessionId, Date.now() + 10 * 60_000);
    if (sessionMisses.size > 500) sessionMisses.delete(sessionMisses.keys().next().value!);
    return undefined;
  };

  const stopSession = (session: ClaudeSession) => {
    void killCliTree(session.child).then((stopped) => {
      if (stopped) void session.finishClose?.();
    });
  };

  const closeSession = (threadId: string, why: string) => {
    warmContracts.delete(threadId);
    warmHolds.delete(threadId);
    const s = sessions.get(threadId);
    if (!s || s.closing) return;
    s.closing = true;
    for (const waiter of s.controlWaiters?.values() ?? []) waiter(false);
    s.controlWaiters?.clear();
    if (s.sessionId && s.sawInit && !s.lastTurnFailed && s.volatile !== UNDELIVERED_VOLATILE && (!s.turn || s.turn.settled)) {
      heldVolatile.set(threadId, { sessionId: s.sessionId, volatile: s.volatile, ...(s.volatileSections ? { sections: s.volatileSections } : {}) });
      if (heldVolatile.size > 500) heldVolatile.delete(heldVolatile.keys().next().value!);
    } else heldVolatile.delete(threadId);
    if (s.idleTimer) clearTimeout(s.idleTimer);
    // Broker ownership belongs to this session. Detach and close it now,
    // before a replacement can bind the same per-thread socket; the old
    // child's later close event must never unlink a new broker.
    const broker = s.broker;
    s.broker = undefined;
    broker?.close();
    appendNative(threadId, { dir: "out", source: "claude.session", msg: { close: why } });
    // A process that ends takes its turn files along. A replacement built
    // for this same thread already holds its values in its own env.
    for (const file of s.turnFiles ?? []) {
      try { rmSync(file, { force: true }); } catch { /* already gone */ }
    }
    // stdin EOF is the CLI's exit signal; give it a moment, then insist
    try {
      s.child.stdin.end();
    } catch { /* already closed */ }
    const kill = setTimeout(() => {
      stopSession(s);
    }, 5_000);
    kill.unref?.();
  };

  const armIdle = (threadId: string) => {
    const s = sessions.get(threadId);
    if (!s) return;
    if (s.idleTimer) clearTimeout(s.idleTimer);
    const held = (warmHolds.get(threadId) ?? 0) - Date.now();
    s.idleTimer = setTimeout(() => closeSession(threadId, "idle"), Math.min(2_147_483_647, Math.max(SESSION_IDLE_MS, held)));
    s.idleTimer.unref?.();
  };

  /** Park a pooled process with no user turn. A later warm of the same
   * session bumps warmToken, so this signal's abort cannot close it. */
  const holdWarm = (threadId: string, session: ClaudeSession, token: string, signal?: AbortSignal) => {
    session.idleWarm = true;
    session.warmToken = token;
    session.turn = null;
    if (signal?.aborted) {
      closeSession(threadId, "call ended");
      return;
    }
    signal?.addEventListener("abort", () => {
      const live = sessions.get(threadId);
      if (live === session && !live.turn && live.warmToken === token) closeSession(threadId, "call ended");
    }, { once: true });
    armIdle(threadId);
  };

  const writeUser = (s: ClaudeSession, threadId: string, promptMsg: ClaudeUserMessage): Promise<boolean> => {
    if (!s.child.stdin.writable || s.child.stdin.destroyed) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        s.child.stdin.write(JSON.stringify(promptMsg) + "\n", (error) => {
          if (error) return resolve(false);
          appendNative(threadId, {
            dir: "out",
            source: "claude.sdk.message",
            msg: diagnosticClaudeUserMessage(promptMsg),
          });
          resolve(true);
        });
      } catch {
        resolve(false);
      }
    });
  };

  /** Send one control request on the CLI's stdin and wait for its answer.
   * False when the write fails, the CLI refuses, or it says nothing in time. */
  const controlRequest = (s: ClaudeSession, threadId: string, request: Record<string, unknown>): Promise<boolean> => {
    if (s.closing || !s.child.stdin.writable || s.child.stdin.destroyed) return Promise.resolve(false);
    const requestId = `sagax-${newId()}`;
    const waiters = (s.controlWaiters ??= new Map<string, (ok: boolean) => void>());
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (waiters.delete(requestId)) resolve(false);
      }, CONTROL_REQUEST_TIMEOUT_MS);
      timer.unref?.();
      waiters.set(requestId, (ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
      const frame = { type: "control_request", request_id: requestId, request };
      try {
        s.child.stdin.write(JSON.stringify(frame) + "\n", (error) => {
          if (!error) {
            appendNative(threadId, { dir: "out", source: "claude.control", msg: frame });
            return;
          }
          clearTimeout(timer);
          if (waiters.delete(requestId)) resolve(false);
        });
      } catch {
        clearTimeout(timer);
        if (waiters.delete(requestId)) resolve(false);
      }
    });
  };

  /** #1373: Ask, Edits or Auto chosen while this thread works. The CLI was
   * launched with --permission-mode and does not re-read it, so the new
   * level goes to the running process as set_permission_mode: its next
   * tool call is decided at that level (Ask: every call reaches Sagax's
   * broker, mcp__ogb__approve). Approve for me's fixed list of tools that
   * never need a person (claudeAutoAllowedTools) stays allowed: none of
   * them changes anything. Resolves false when the CLI did not confirm, and
   * the harness then stops the turn. */
  const applyApprovalMode = async (threadId: string, mode: ApprovalMode): Promise<boolean> => {
    if (mode !== "ask" && mode !== "edits" && mode !== "auto") return false;
    const running = active.get(threadId);
    // Nothing running: the next turn launches at the level it is sent with.
    if (!running) return true;
    liveApprovalModes.set(threadId, { turnId: running.turnId, mode });
    const s = sessions.get(threadId);
    // Between two processes of the same turn: the relaunch reads the level
    // recorded above before it spawns.
    if (!s || s.closing || !s.turn || s.turn.turnId !== running.turnId) return true;
    s.turn.input = { ...s.turn.input, approvalMode: mode };
    // A guest's confined turn already runs in Ask and stays there.
    if (s.turn.input.guestConfined) return true;
    const nativeMode = mode === "ask" ? "default" : "acceptEdits";
    const ok = await controlRequest(s, threadId, { subtype: "set_permission_mode", mode: nativeMode });
    if (!ok) return false;
    s.nativePermissionMode = nativeMode;
    // The process no longer runs at the mode its argv names: never reuse
    // it for a later turn, which launches at its own level.
    s.argsKey = `${s.argsKey}#live-approval`;
    return true;
  };

  return {
    sessionFileBytes,
    stopSession,
    closeSession,
    armIdle,
    holdWarm,
    writeUser,
    controlRequest,
    applyApprovalMode,
  };
}
