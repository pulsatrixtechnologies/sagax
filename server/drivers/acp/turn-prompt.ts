/** ACP turn prompt phase: build prompt, send, continue, settle success. */
import { joinCachePrime } from "../../voice-first-sentence.ts";
import {
  deletePromptSplitReceipt, promptHalves, readPromptSplitReceipt, splitSessionPrompt, writePromptSplitReceipt,
} from "../prompt-split.ts";
import { lastSeenPhrase } from "./quiet-status.ts";
import {
  ACP_PROMPT_RE_ANCHOR_TURNS, formatQuietLimit, promptIdleTimeoutMs,
} from "./constants.ts";
import {
  acpVariantOption, isReasoningOnlyEmpty, readAcpImageBlocks, reasoningContinueMax,
  REASONING_CONTINUE_NUDGE, REASONING_ONLY_SOFT_MESSAGE,
} from "./helpers.ts";
import { engineFailureKind, engineFailureMessage } from "../engine-errors.ts";
import type { AcpTurnCtx } from "./turn-context.ts";

export async function promptAcpTurn(ctx: AcpTurnCtx): Promise<void> {
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
  void receiveModelVariants;
  const requestedVariantOption = () => {
    if (!support.modelVariants) throw new Error(`${support.displayName} does not support model variants`);
    const option = acpVariantOption(session.sessionConfigResult);
    if (!option || !option.options.some((entry) => entry.id === variant)) {
      throw new Error(`${support.displayName} does not advertise variant ${variant} for this model`);
    }
    return option;
  };

// A support's own standing line (support.stableSystemHint) joins
// the stable half, so it rides once per session like the rest.
const hint = support.stableSystemHint ?? "";
const split = promptHalves(turn);
let halves = hint && split.stable !== null ? { ...split, stable: split.stable + hint } : split;
if (hint && promptTurn.system) promptTurn = { ...promptTurn, system: promptTurn.system + hint };
// A support's own context section (Grok: the tools this bot
// already used) rides the volatile half as one more section, so
// a change re-sends that section alone.
let volatileSections = turn.systemVolatileSections;
const extraSection = halves.stable !== null
  ? support.volatileSection?.({ botId: turn.botId, serverNames: mcpServers.map((server) => server.name), sessionId, threadId, accountConnectors: turn.grokCloudConnectors === true }) ?? null
  : null;
if (extraSection && extraSection.text.trim()) {
  halves = { ...halves, volatile: halves.volatile ? `${halves.volatile}\n\n${extraSection.text}` : extraSection.text };
  volatileSections = [...(volatileSections ?? []), extraSection];
  if (promptTurn.system) promptTurn = { ...promptTurn, system: `${promptTurn.system}\n\n${extraSection.text}` };
}
let promptInput = promptTurn;
if (halves.stable !== null) {
  const receiptKey = JSON.stringify([threadId, sessionId]);
  const previousReceipt = readPromptSplitReceipt(DRIVER_KIND, receiptKey);
  // Carry the high-water mark, not just the final report: several
  // ordinary dips across turns can add up to a compaction.
  state.usagePeak = previousReceipt?.peakUsed ?? previousReceipt?.lastUsed ?? null;
  const composed = splitSessionPrompt(
    halves.stable,
    halves.volatile,
    previousReceipt,
    promptTurn.system,
    promptTurn.text,
    Boolean(turn.mentionTurn),
    ACP_PROMPT_RE_ANCHOR_TURNS,
    volatileSections,
  );
  promptInput = { ...promptTurn, system: "", text: composed.text };
  pendingSplitReceipt = { key: receiptKey, receipt: composed.receipt, previous: previousReceipt };
  // Visible to finishAcpTurnError if sendPrompt throws before this phase returns.
  ctx.pendingSplitReceipt = pendingSplitReceipt;
}
const text = support.buildPromptText
  ? support.buildPromptText(promptInput)
  : promptInput.system
    ? `${promptInput.system}\n\n${promptInput.text}`
    : promptInput.text;
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
  });
  if (sessions.get(threadId) === session) session.cachePrime = undefined;
}
if (state.settled || state.stopped || session.closing) throw new Error("turn stopped");
state.promptSent = true;
latency.promptAt = Date.now();
latency.path = launchedThisTurn ? "spawn" : reused ? "pooled" : "load";
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
    // An item (reply, image, tool) or an open ask/tool means a
    // nudge could duplicate work. Uncommitted assistant deltas are
    // abandoned: they are not a final answer, and keeping them
    // used to force the raw Internal error through (#1820).
    const canNudge = reasoningOnly
      && !state.producedItem
      && current.asks.size === 0
      && current.runningTools.size === 0
      && reasoningRetries < reasoningMax
      && !state.stopped && !state.settled && !session.closing
      && session.current === current && session.sessionId === sessionId
      && session.child.exitCode === null;
    if (canNudge) {
      state.text = "";
      reasoningRetries += 1;
      // Internal detail for the logs, not a row in the chat.
      console.warn(`[acp] ${support.displayName} returned its reasoning without an answer, so Sagax asked it to finish.`);
      continue;
    }
    if (reasoningOnly) {
      // Bound reached, nudge disabled, or work already committed:
      // soft-end. Never the raw "Internal error … (session/prompt)".
      // Drop uncommitted deltas so settle does not flush a leak as
      // a reply beside the soft error.
      if (!state.producedItem) state.text = "";
      console.log(`[acp] ${support.displayName} returned reasoning only after ${reasoningRetries} continuation(s); turn ended gracefully (${threadId})`);
      emit({
        ...base(threadId, turnId),
        type: "runtime.error",
        message: `${support.displayName} ${REASONING_ONLY_SOFT_MESSAGE}`,
      });
      if (session.child.exitCode === null && !session.closing) closeSession(threadId, "reasoning-only");
      settle(threadId, session, false, "reasoning_only");
      return;
    }
    throw promptError;
  }
  break;
}
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
    // the agent compacts it on its own (server/context-budget.ts).
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
