/** ACP turn prompt phase: build prompt, send, continue, settle success. */
import { fitPromptBytes } from "./prompt-fit.ts";
import { joinCachePrime } from "../../voice/voice-first-sentence.ts";
import {
  deletePromptSplitReceipt, writePromptSplitReceipt,
} from "../prompt-split.ts";
import { lastSeenPhrase } from "./quiet-status.ts";
import {
  formatQuietLimit, promptIdleTimeoutMs,
} from "./constants.ts";
import {
  acpVariantOption, isReasoningOnlyEmpty, lowerReasoningEffort, readAcpImageBlocks, reasoningContinueMax,
  REASONING_CONTINUE_NUDGE, reasoningOnlySoftMessage,
} from "./helpers.ts";
import { engineFailureKind, engineFailureMessage } from "../engine-errors.ts";
import type { AcpTurnCtx } from "./turn-context.ts";
import { composeAcpPromptInput } from "./turn-prompt-build.ts";
import { noteEnginePrompt } from "../../turns/turn-trace.ts";

export async function promptAcpTurn(ctx: AcpTurnCtx): Promise<void> {
  const {
    support, DRIVER_KIND, turn, turnId, threadId, turnConfig, cwd, spawnEnv,
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
  const sessionId = ctx.sessionId;
  void cwd; void sessionKey; void cursor; void renewedFromChat; void active; void asks;
  void turnConfig; void spawnEnv; void controlsHost; void retiring; void retireChild;
  void sessionAllows; void initialize; void authenticateOnce; void sessionInputs;
  void launchSession; void threadNotices; void rejectStartup; void startupAck; void started;
  void setAccountModels;

  const modelOf = (result: any): string | null => {
    const option = (Array.isArray(result?.configOptions) ? result.configOptions : []).find(
      (entry: any) => entry?.id === (support.selectModel?.configId ?? "model"),
    );
    return typeof option?.currentValue === "string" ? option.currentValue : null;
  };
  const receiveModelVariants = (result: any) => {
    session.sessionConfigResult = result;
    if (!support.modelVariants) return;
    const nativeModel = modelOf(result) ?? cliTurn.model;
    if (!nativeModel) return;
    const option = acpVariantOption(result);
    emit({
      ...base(threadId, turnId),
      type: "session.model-variants",
      model: nativeModel === cliTurn.model ? (reportedModel ?? nativeModel) : nativeModel,
      variants: {
        options: option?.options ?? [],
        ...(option?.currentValue !== undefined ? { currentValue: option.currentValue } : {}),
      },
    });
  };
  const requestedVariantOption = () => {
    if (!support.modelVariants) throw new Error(`${support.displayName} does not support model variants`);
    const option = acpVariantOption(session.sessionConfigResult);
    if (!option || !option.options.some((entry) => entry.id === variant)) {
      throw new Error(`${support.displayName} does not advertise variant ${variant} for this model`);
    }
    return option;
  };

  const composedPrompt = composeAcpPromptInput(ctx);
  let promptInput = composedPrompt.promptInput;
  promptTurn = composedPrompt.promptTurn;
  pendingSplitReceipt = composedPrompt.pendingSplitReceipt;
  state = composedPrompt.state;

const composedText = support.buildPromptText
  ? support.buildPromptText(promptInput)
  : promptInput.system
    ? `${promptInput.system}\n\n${promptInput.text}`
    : promptInput.text;
// 2026-11-02: under the size the agent takes whole, so nothing is moved to
// a file the bot cannot read. #3510: whole lines only, never a cut in the
// middle (prompt-fit.ts); the opening block was already fitted by section.
const fitted = fitPromptBytes(composedText, support.promptByteLimit);
if (fitted.cut) console.info(`[acp] ${DRIVER_KIND} prompt over ${support.promptByteLimit} bytes: left out the earlier-context line (${fitted.cut} bytes) (thread ${threadId})`);
const text = fitted.text;
const overLimit = support.promptByteLimit ? Buffer.byteLength(text, "utf8") - support.promptByteLimit : 0;
if (overLimit > 0) console.info(`[acp] ${DRIVER_KIND} prompt over the engine's limit ${support.promptByteLimit} by ${overLimit} bytes, sent whole (thread ${threadId})`);
const imageBlocks = support.images === true && runtimeAcceptsImages
  ? await readAcpImageBlocks(turn.images ?? [])
  : [];
if (support.modelVariants && cliTurn.model && modelOf(session.sessionConfigResult) !== cliTurn.model) {
  throw new Error(`${support.displayName} changed model before the prompt`);
}
if (variant !== undefined && requestedVariantOption().currentValue !== variant) {
  throw new Error(`${support.displayName} changed variant before the prompt`);
}
if (session.cachePrime) {
  const pending = session.cachePrime;
  await joinCachePrime(pending, () => {
    if (sessionId) session.acp.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
  }, session.cachePrimeJoinMs);
  if (sessions.get(threadId) === session) {
    session.cachePrime = undefined;
    session.cachePrimeJoinMs = undefined;
  }
}
if (state.settled || state.stopped || session.closing) throw new Error("turn stopped");
state.promptSent = true;
latency.promptAt = Date.now();
latency.path = launchedThisTurn ? "spawn" : reused ? "pooled" : "load";
// #4215: the conversation's timing line says whether the engine was warm
noteEnginePrompt(threadId, latency.path !== "spawn", latency.promptAt);
latency.promptChars = text.length;
if (pendingSplitReceipt) latency.full = pendingSplitReceipt.receipt.turnsSinceFull === 0;
acknowledge();
const promptIdleMs = promptIdleTimeoutMs();
const quiet = startQuietWatch(threadId, session, current);
const sendPrompt = (promptText: string = text) => request(
  "session/prompt",
  { sessionId, prompt: [{ type: "text", text: promptText }, ...imageBlocks] },
  undefined,
  undefined,
  promptIdleMs,
  () => {
    const last = quiet.lastState();
    return `${DRIVER_KIND} sent nothing for ${formatQuietLimit(promptIdleMs)} with no tool running, so the turn was stopped as stuck` +
      `${last ? ` (last seen: ${lastSeenPhrase(last)})` : ""}. ` +
      "Send the message again to retry. On a self-hosted server, SAGAX_ACP_PROMPT_IDLE_TIMEOUT_MS sets this limit (0 turns it off).";
  },
  );
// A Grok-side stall: the provider sometimes takes 30-90 s to its
// first token (measured on the production server, 2026-10-11; the CLI
// logged a single attempt each time). When nothing at all has come
// back - no text, thought, tool call or question - nothing has run
// and nothing was approved, so the prompt is cancelled and asked
// once more. Any sign of life, a running tool or an open ask turns
// the retry off for this turn.
// The last context size this session reported (the split receipt
// carries it across processes) lets the guard wait longer for a
// big uncached prefill than for a short conversation.
const lastUsed = pendingSplitReceipt?.previous?.lastUsed ?? state.usagePeak;
const stallMs = support.stallRetryMs?.({
  contextTokens: typeof lastUsed === "number" && lastUsed > 0 ? lastUsed : null,
  promptChars: text.length,
}) ?? 0;
if (stallMs > 0) latency.stallMs = stallMs;
let result: any;
// A reasoning-capable engine (Grok/xAI-managed, and any other ACP
// engine that mirrors it) can spend a turn's whole output budget on
// reasoning and commit no content and no tool call. Grok reports
// exactly that over session/prompt as an rpc -32603 whose detail is
// "empty response from model (reasoning_only)". Thought chunks, or
// a leaked assistant delta that never became an item, must not
// block recovery or let the raw Internal error through: nudge the
// live session when nothing was committed, else soft-settle with
// stopReason reasoning_only. Bounded, so a model that only ever
// reasons ends gracefully rather than looping.
const reasoningMax = reasoningContinueMax();
let reasoningRetries = 0;
// The effort a reasoning-only nudge lowered, to put back once the nudge
// settles: a pooled process keeps its session for the next turn, and that
// turn must run at the bot's own effort. A restore that fails closes the
// process after this turn (the next one relaunches with the bot's flags).
let loweredEffort: { configId: string; value: string } | null = null;
let effortRestoreFailed = false;
// Short on purpose: an effort switch is a local config write, and a hung one
// must not hold the turn's settle.
const EFFORT_SWITCH_TIMEOUT_MS = 15_000;
const restoreEffort = async () => {
  const lowered = loweredEffort;
  if (!lowered) return;
  loweredEffort = null;
  if (session.child.exitCode !== null || session.closing) return;
  try {
    await request("session/set_config_option", { sessionId, configId: lowered.configId, value: lowered.value },
      EFFORT_SWITCH_TIMEOUT_MS, receiveModelVariants);
    if (acpVariantOption(session.sessionConfigResult)?.currentValue !== lowered.value) effortRestoreFailed = true;
  } catch {
    effortRestoreFailed = true;
  }
};
let effortWasLowered = false;
const lowerEffortForNudge = async () => {
  const option = acpVariantOption(session.sessionConfigResult);
  const lower = lowerReasoningEffort(option);
  if (!option || !lower || option.currentValue === undefined) return;
  try {
    await request("session/set_config_option", { sessionId, configId: option.configId, value: lower },
      EFFORT_SWITCH_TIMEOUT_MS, receiveModelVariants);
    loweredEffort = { configId: option.configId, value: option.currentValue };
    effortWasLowered = acpVariantOption(session.sessionConfigResult)?.currentValue === lower;
  } catch (error) {
    // The nudge still goes out at the bot's own effort.
    console.warn(`[acp] ${support.displayName} kept its reasoning effort for the nudge: ${error instanceof Error ? error.message : String(error)}`);
  }
};
for (;;) {
  try {
    if (reasoningRetries === 0 && stallMs > 0) {
      state.promptActivity = false;
      let stalled = false;
      const stallTimer = setTimeout(() => {
        if (state.promptActivity || state.settled || state.stopped || session.closing || session.current !== current
            || current.asks.size || current.runningTools.size) return;
        stalled = true;
        latency.stallRetried = true;
        // Internal detail for the logs, not a row in the chat.
        console.warn(`[acp] ${support.displayName} sent nothing for ${Math.round(stallMs / 1000)} s, so Sagax asked again.`);
        session.acp.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
      }, stallMs);
      stallTimer.unref?.();
      try {
        result = await sendPrompt();
      } finally {
        clearTimeout(stallTimer);
      }
      if (stalled && result?.stopReason === "cancelled" && !state.promptActivity && !state.stopped && !state.settled && !session.closing) {
        result = await sendPrompt();
      }
    } else {
      result = await sendPrompt(reasoningRetries === 0 ? text : REASONING_CONTINUE_NUDGE);
    }
  } catch (promptError) {
    const reasoningOnly = isReasoningOnlyEmpty(promptError);
    // A reply or an image already out, or an open ask/tool, means a
    // nudge could duplicate work. Finished tool calls do not: the live
    // session holds their results, and the nudge asks only for the
    // answer or the next call (2026-11-02: a routine always ran tools
    // first, so it never got the nudge and failed outright). Uncommitted
    // assistant deltas are abandoned: they are not a final answer, and
    // keeping them used to force the raw Internal error through (#1820).
    // 2026-11-02 (prod, Grok): a turn that said a line and reacted to a
    // message before its reasoning-only answer was never nudged, so it
    // failed after 0 continuations and the person waited twice for Grok's
    // own 15 retries. What the bot already said or did stays in the live
    // session; the nudge asks only for what is missing.
    const canNudge = reasoningOnly
      && current.asks.size === 0
      && current.runningTools.size === 0
      && reasoningRetries < reasoningMax
      && !state.stopped && !state.settled && !session.closing
      && session.current === current && session.sessionId === sessionId
      && session.child.exitCode === null;
    if (canNudge) {
      state.text = "";
      reasoningRetries += 1;
      // Ask at a lower effort when the session offers one: the same effort
      // already spent the whole answer on reasoning.
      if (reasoningRetries === 1) await lowerEffortForNudge();
      // Internal detail for the logs, not a row in the chat.
      console.warn(`[acp] ${support.displayName} returned its reasoning without an answer, so Sagax asked it to finish${effortWasLowered ? " with lower effort" : ""}.`);
      continue;
    }
    if (reasoningOnly) {
      // Bound reached, nudge disabled, or work already committed:
      // soft-end. Never the raw "Internal error … (session/prompt)".
      // Drop uncommitted deltas so settle does not flush a leak as
      // a reply beside the soft error.
      if (!state.producedItem) state.text = "";
      loweredEffort = null; // the session closes below: nothing to restore
      console.log(`[acp] ${support.displayName} returned reasoning only after ${reasoningRetries} continuation(s); turn ended gracefully (${threadId})`);
      emit({
        ...base(threadId, turnId),
        type: "runtime.error",
        message: `${support.displayName} ${reasoningOnlySoftMessage({
          retried: reasoningRetries > 0,
          loweredEffort: effortWasLowered,
          stepsRan: current.endedToolIds.size > 0,
        })}`,
      });
      if (session.child.exitCode === null && !session.closing) closeSession(threadId, "reasoning-only");
      settle(threadId, session, false, "reasoning_only");
      return;
    }
    await restoreEffort();
    if (effortRestoreFailed && session.child.exitCode === null && !session.closing) closeSession(threadId, "effort-restore");
    throw promptError;
  }
  break;
}
await restoreEffort();
settleAcpPromptOutcome({
  pendingSplitReceipt, state, DRIVER_KIND, result, latency, emit, base,
  threadId, turnId, session, settle, freshNextTurn, closeSession, support,
  effortRestoreFailed,
});

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

/** Receipt, token usage and stop reason after session/prompt resolves. */
function settleAcpPromptOutcome(input: Pick<AcpTurnCtx,
  "pendingSplitReceipt" | "state" | "DRIVER_KIND" | "latency" | "emit" | "base" |
  "threadId" | "turnId" | "session" | "settle" | "freshNextTurn" | "closeSession" | "support"
> & { result: any; effortRestoreFailed: boolean }): void {
  const {
    pendingSplitReceipt, state, DRIVER_KIND, result, latency, emit, base,
    threadId, turnId, session, settle, freshNextTurn, closeSession, support,
    effortRestoreFailed,
  } = input;
  if (pendingSplitReceipt) {
    // session/prompt resolving is the acceptance boundary: a
    // rejected prompt leaves the receipt unwritten, so the next
    // turn redelivers what this one never received. After a
    // compaction, drop it so the next turn re-sends the full prompt.
    if (state.usageCompacted) {
      deletePromptSplitReceipt(DRIVER_KIND, pendingSplitReceipt.key);
    } else {
      const previousLastUsed = typeof pendingSplitReceipt.previous?.lastUsed === "number"
        ? pendingSplitReceipt.previous.lastUsed
        : undefined;
      const lastUsed = state.usageLast ?? previousLastUsed;
      writePromptSplitReceipt(
        DRIVER_KIND,
        pendingSplitReceipt.key,
        {
          ...pendingSplitReceipt.receipt,
          ...(lastUsed === undefined ? {} : { lastUsed }),
          ...(state.usagePeak === null ? {} : { peakUsed: state.usagePeak }),
        },
      );
    }
  }
  // opencode 1.18.18 reports usage at the result root; grok and
  // gemini put it under _meta. Read both rather than lose the count.
  const usage = result?.usage ?? result?._meta ?? {};
  if (typeof usage.inputTokens === "number" || typeof usage.outputTokens === "number") {
    // opencode 1.18.25 keeps only the uncached share in inputTokens
    // and reports cache reads beside it (omitted when 0); some
    // agents count them inside inputTokens. `input` is the whole
    // prompt with `cachedInput` naming its cached part — the same
    // convention as the Claude driver and the store — and
    // totalTokens tells the two wire shapes apart. Cache writes
    // stay out of `input`, exactly as in the Claude driver, and an
    // absent cache count emits the bare shape with no cachedInput
    // key: absent is not zero.
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    latency.inputTokens = input;
    if (typeof usage.cachedReadTokens === "number") latency.cachedTokens = usage.cachedReadTokens;
    const cachedRead = typeof usage.cachedReadTokens === "number" && usage.cachedReadTokens > 0
      ? usage.cachedReadTokens
      : null;
    const exclusive = cachedRead !== null
      && (typeof usage.totalTokens !== "number"
        || usage.totalTokens >= input + output + cachedRead);
    emit({
      ...base(threadId, turnId),
      type: "thread.token-usage.updated",
      input: cachedRead !== null && exclusive ? input + cachedRead : input,
      output,
      ...(cachedRead !== null
        ? { cachedInput: exclusive ? cachedRead : Math.min(cachedRead, input) }
        : {}),
      // What fills the window now, so Sagax folds the thread before
      // the agent compacts it on its own (server/context/context-budget.ts).
      ...(state.usageLast !== null && state.usageLast > 0 ? { contextTokens: state.usageLast } : {}),
      ...(state.usageSize ? { contextWindow: state.usageSize } : {}),
    });
  }
  const reason = result?.stopReason;
  if (reason === "end_turn") settle(threadId, session, true, null);
  // After Stop, whatever reason the agent gives is the stop.
  else if (reason === "cancelled" || state.stopped) settle(threadId, session, true, "cancelled");
  else {
    const errorMessage = typeof result?.error === "string" && result.error
      ? result.error
      : typeof result?.message === "string" && result.message
        ? result.message
        : `Model turn failed: ${reason ?? "unknown error"}`;
    if (engineFailureKind(errorMessage) === "context_full") {
      freshNextTurn.add(threadId);
      if (session.child.exitCode === null && !session.closing) closeSession(threadId, "context-full");
    }
    emit({
      ...base(threadId, turnId),
      type: "runtime.error",
      message: engineFailureMessage(support.displayName, errorMessage) ?? errorMessage,
    });
    settle(threadId, session, false, engineFailureKind(errorMessage) === "context_full" ? "context_full" : (reason ?? "failed"));
  }
  // The nudge's lower effort could not be put back: never let the next turn
  // run on it in this pooled process.
  if (effortRestoreFailed && session.child.exitCode === null && !session.closing) closeSession(threadId, "effort-restore");
}
