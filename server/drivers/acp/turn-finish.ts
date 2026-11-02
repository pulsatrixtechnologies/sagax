/** ACP turn finish phase: prompt/startup error handling. */
import { killCliTree } from "../../procs.ts";
import { TurnNotStartedError } from "../../contracts.ts";
import { deletePromptSplitReceipt } from "../prompt-split.ts";
import { classifyError } from "../retry.ts";
import { engineFailureKind, engineFailureMessage } from "../engine-errors.ts";
import { redactSecretsInText } from "../../redact.ts";
import { isAccountError } from "./helpers.ts";
import type { AcpTurnCtx } from "./turn-context.ts";

export async function finishAcpTurnError(ctx: AcpTurnCtx, e: unknown): Promise<void> {
  const {
    support, DRIVER_KIND, turn, turnId, threadId, turnConfig, cwd, spawnEnv, mcpServers,
    sessionKey, cursor, renewedFromChat, launchedThisTurn, reused, latency, controlsHost,
    retiring, retireChild, closeSession, sessions, sessionAllows, emit, base,
    request, initialize, authenticateOnce, sessionInputs, launchSession, settle,
    active, freshNextTurn, threadNotices, startQuietWatch, setAccountModels, asks,
    acknowledge, rejectStartup, startupAck, started,
  } = ctx;
  let session = ctx.session;
  let state = ctx.state;
  let current = ctx.current;
  let cliTurn = ctx.cliTurn;
  let promptTurn = ctx.promptTurn;
  let reportedModel = ctx.reportedModel;
  let variant = ctx.variant;
  let staleProcess = ctx.staleProcess;
  let approvalUnconfirmed = ctx.approvalUnconfirmed;
  let accountModels = ctx.accountModels;
  let models = ctx.models;
  let pendingSplitReceipt = ctx.pendingSplitReceipt;
  let runtimeAcceptsImages = ctx.runtimeAcceptsImages;
  let init = ctx.init;
  let selectedModel = ctx.selectedModel;
  let rebuiltFromReplay = ctx.rebuiltFromReplay;
  void turnConfig; void cwd; void spawnEnv; void mcpServers; void sessionKey; void cursor;
  void renewedFromChat; void launchedThisTurn; void reused; void latency; void controlsHost;
  void retiring; void retireChild; void sessions; void sessionAllows; void request;
  void initialize; void authenticateOnce; void sessionInputs; void launchSession;
  void threadNotices; void startQuietWatch; void startupAck; void started;
  void promptTurn; void reportedModel; void variant; void accountModels; void models;
  void runtimeAcceptsImages; void init; void selectedModel; void rebuiltFromReplay;
  void setAccountModels; void acknowledge;

// A rejected prompt can still have compacted native history. Its
// old receipt must not suppress the next turn's standing rules.
if (pendingSplitReceipt && state.promptSent && state.usageCompacted) {
  deletePromptSplitReceipt(DRIVER_KIND, pendingSplitReceipt.key);
}
if (!state.settled) {
  const message = e instanceof Error ? e.message : String(e);
  // A stop the person asked for is a cancellation, not a failure
  // to leave in the chat: before the prompt ("turn stopped"), or
  // during the handshake, where closing the session rejects the
  // pending request ("session closed").
  if (message === "turn stopped" || state.stopped) {
    settle(threadId, session, true, "cancelled");
    return;
  }
  const code = support.classifyError?.(e) ?? (engineFailureKind(message) === "credits" ? "insufficient_funds" : undefined);
  // Authentication setup is a user action, not a retry. The
  // classifier is preferred; loginNote remains a compatibility
  // fallback for existing ACP supports.
  const needsAuth = code === "invalid_credentials" || code === "inactive_subscription"
    || code === "insufficient_funds" || message === support.loginNote;
  // A key, credit, quota or subscription problem is the account's,
  // not the process's: the child that reported it is healthy, so it
  // stays pooled and the retry after a fix starts warm.
  const accountError = isAccountError(code);
  // The server log keeps the RPC failure itself (its JSON-RPC
  // code, the classified cause, the method and the vendor's
  // words, redacted): a turn that ends in rpc_error must never
  // leave nothing between its [omb-turn] line and the next one.
  const rpcCode = (e as any)?.code;
  console.error(`[acp] ${support.displayName} turn failed: rpc ${typeof rpcCode === "number" || typeof rpcCode === "string" ? rpcCode : "none"}${code ? ` (${code})` : ""}: ${redactSecretsInText(message).slice(0, 400)}`);
  const failure = classifyError({ text: message });
  const transientStartup = failure.transient || (failure.reason === "unknown" && code === "upstream_outage");
  const denied = /\b(?:(?:permission|access) denied|(?:approval|permission) (?:required|denied|rejected)|requires? (?:approval|permission)|policy (?:restriction|violation)|(?:blocked|denied|restricted) by (?:the )?policy)\b/i.test(message);
  // An unconfirmed approval switch sent no prompt and its process
  // is discarded either way, so a fresh one can take the turn.
  const retryableStartup = approvalUnconfirmed || (transientStartup && (!code || code === "upstream_outage")
    && ![-32700, -32600, -32601, -32602].includes((e as any)?.code));
  if (turn.startupRecovery && retryableStartup && !needsAuth && !accountError && !denied
      && !state.promptSent && !state.startupActivity && !state.producedItem && !state.text
      && !state.stopped && !session.closing && !asks.size && !current.runningTools.size) {
    // Quiesce before killing: the child's close event must not
    // publish a terminal completion before the harness can recover.
    state.settled = true;
    session.current = null;
    if (current.interruptTimer) clearTimeout(current.interruptTimer);
    closeSession(threadId, "startup-recovery");
    const stopped = await killCliTree(session.child).catch(() => false);
    if (current.interruptTimer) clearTimeout(current.interruptTimer);
    active.delete(threadId);
    if (stopped && !state.stopped) {
      rejectStartup(new TurnNotStartedError(turnId, message));
      return;
    }
    acknowledge();
    if (!state.stopped) emit({ ...base(threadId, turnId), type: "runtime.error", message: engineFailureMessage(support.displayName, message) ?? message });
    emit({ ...base(threadId, turnId), type: "turn.completed", ok: state.stopped,
      stopReason: state.stopped ? "cancelled" : "rpc_error", cost: null });
    return;
  }
  const contextFull = engineFailureKind(message) === "context_full";
  if (contextFull) freshNextTurn.add(threadId);
  emit({
    ...base(threadId, turnId),
    type: "runtime.error",
    message: (accountError ? support.describeAccountError?.(code, cliTurn.model) : undefined) ?? engineFailureMessage(support.displayName, message) ?? message,
    ...(needsAuth ? { setup: true } : {}), ...((e as any)?.acpPromptStall === true ? { stalled: true } : {}),
  });
  // Internal RPC failures can leave a live child poisoned just
  // like a silent prompt. Evict before completion listeners can
  // start the next turn. Never replay this accepted prompt: it
  // may already have executed tools. The next explicit turn can
  // resume the recorded session on a fresh process. A context-full
  // failure must not leave the already-full native session pooled
  // either: Retry starts lightened from the chat rebuild.
  if (!needsAuth && !accountError && ((e as any)?.acpPromptStall === true || (e as any)?.acpSessionFailure === true
      || code === "upstream_outage" || contextFull) && session.child.exitCode === null && !session.closing) {
    closeSession(threadId, contextFull ? "context-full" : ((e as any)?.acpPromptStall === true ? "prompt-stall" : "rpc-failure"));
  } else if (approvalUnconfirmed && session.child.exitCode === null && !session.closing) {
    // Fail closed: the session may still hold a looser mode from
    // an earlier turn. Nothing was prompted; the next turn starts
    // a fresh process, whose session begins in the runtime's own
    // default mode, and applies its mode there.
    closeSession(threadId, "approval-unconfirmed");
  } else if (staleProcess && !state.promptSent && session.child.exitCode === null && !session.closing) {
    closeSession(threadId, "stale-models");
  }
  settle(threadId, session, false, needsAuth ? "auth_required" : contextFull ? "context_full" : "rpc_error");
}

  ctx.session = session;
  ctx.state = state;
  ctx.current = current;
  ctx.cliTurn = cliTurn;
  ctx.promptTurn = promptTurn;
  ctx.reportedModel = reportedModel;
  ctx.variant = variant;
  ctx.staleProcess = staleProcess;
  ctx.approvalUnconfirmed = approvalUnconfirmed;
  ctx.accountModels = accountModels;
  ctx.models = models;
  ctx.pendingSplitReceipt = pendingSplitReceipt;
  ctx.runtimeAcceptsImages = runtimeAcceptsImages;
  ctx.init = init;
  ctx.selectedModel = selectedModel;
  ctx.rebuiltFromReplay = rebuiltFromReplay;
  setAccountModels(accountModels);
}
