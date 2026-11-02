/** Claude stdout line dispatcher and stream wiring (#1383). */
import { appendNative } from "../native.ts";
import { describeSpawnFailure } from "../../procs.ts";
import { diagnosticClaudeUserMessage } from "./messages.ts";
import { handleClaudeContent } from "./stream-content.ts";
import { handleClaudeResult } from "./stream-result.ts";
import type { ClaudeTurnCtx } from "./turn-ctx.ts";

export function attachClaudeStream(ctx: ClaudeTurnCtx): void {
  const {
    session, threadId, turn, emit, base, settle, authRecovery, child,
    closeSession, currentTurnId, config, cwd, liveCommands, liveCommandsKey,
    stopSession, support,
  } = ctx;
  const { GUEST_FORBIDDEN_TOOLS } = support;

  const handleLine = (line: string) => {
if (session.closing) return;
let o: any;
try {
  o = JSON.parse(line);
} catch {
  return;
}
authRecovery.frame(threadId, o, session.costTotal);
// A stdin message echoed back (--replay-user-messages) carries its
// images again: keep their bytes out of the log, as when it was sent.
appendNative(threadId, { dir: "in", source: "claude.sdk.message", msg: o?.type === "user" && o.isReplay === true && o.message ? diagnosticClaudeUserMessage(o) : o });
// #1373: the answer to a control request this driver sent on stdin.
if (o?.type === "control_response") {
  const response = o.response && typeof o.response === "object" ? o.response as { request_id?: unknown; subtype?: unknown } : null;
  const id = typeof response?.request_id === "string" ? response.request_id : undefined;
  const waiter = id ? session.controlWaiters?.get(id) : undefined;
  if (id && waiter) {
    session.controlWaiters!.delete(id);
    waiter(response?.subtype === "success");
  }
  return;
}
// A warm process has no user turn. Record init (the resume cursor is
// published only when a real turn attaches) and drop everything else,
// so a call warm never writes a transcript row.
if (session.idleWarm && !session.turn) {
  if (o?.type === "system" && o.subtype === "init") {
    const tools: unknown[] = Array.isArray(o.tools) ? o.tools : [];
    if (turn.guestConfined && (o.permissionMode !== "default" || tools.some((tool) => typeof tool === "string" && GUEST_FORBIDDEN_TOOLS.has(tool)))) {
      session.closing = true;
      stopSession(session);
      return;
    }
    session.sawInit = true;
    const liveBot = turn.botId;
    if (liveBot && Array.isArray(o.slash_commands)) {
      const liveAccess = turn.access;
      liveCommands.set(liveCommandsKey(liveBot, liveAccess?.via === "subscription" ? liveAccess.identity : undefined), {
        names: o.slash_commands.filter((name: unknown): name is string => typeof name === "string"),
        terminal: Array.isArray(o.terminal_slash_commands) ? o.terminal_slash_commands.filter((name: unknown): name is string => typeof name === "string") : [],
      });
    }
    session.nativePermissionMode = typeof o.permissionMode === "string" ? o.permissionMode : null;
    if (typeof o.session_id === "string") session.sessionId = o.session_id;
    if (typeof o.model === "string") session.sessionModel = o.model;
  }
  return;
}
// The continuation a held result waits for has spoken: any frame
// after its `init` — status, thinking, text, its own result. The
// echo of its own message is not speech: it comes before the call.
if (session.turn?.continuationSilence && !(o.type === "system" && o.subtype === "init") && !(o.type === "user" && o.isReplay === true)) {
  clearTimeout(session.turn.continuationSilence);
  session.turn.continuationSilence = null;
}

    switch (o.type) {
      case "system":
      case "stream_event":
      case "assistant":
      case "user":
      case "rate_limit_event":
      case "tool_progress":
        handleClaudeContent(ctx, o);
        break;
      case "result":
        handleClaudeResult(ctx, o);
        break;
      default:
        break;
    }
  };
  ctx.handleLine = handleLine;

let buf = "";
// decode as UTF-8 across chunk boundaries — a raw `buf += chunk` splits
// multibyte characters that straddle two reads and corrupts the text
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.trim()) handleLine(line);
  }
});

child.stderr.on("data", (c) => {
  session.stderr += c;
  if (session.stderr.length > 8192) session.stderr = session.stderr.slice(-8192);
});

child.on("error", (e) => {
  // A warm has no turn to fail in the thread. Close the idle process.
  if (session.idleWarm && !session.turn) {
    closeSession(threadId, "spawn error");
    return;
  }
  emit({ ...base(threadId, currentTurnId()), type: "runtime.error", ...describeSpawnFailure(e, config.cli, cwd) });
  settle(false, "spawn_error");
});


}
