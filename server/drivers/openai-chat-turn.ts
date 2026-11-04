// Turn runner for createOpenAIChatRuntime (extracted for the #1383 function-size budget).
import type { SendTurnInput } from "../contracts.ts";
import { warmResourcePerson } from "../resources/warm-resources.ts";
import { newId } from "../contracts.ts";
import { ASK_USER_TOOL, ASK_USER_TOOL_DEFINITION, askQuestionSummary, parseAskQuestions, questionChoices } from "../../shared/ask-question.ts";
import { allowsTool, parseToolScope } from "../../shared/tool-scope.ts";
import { redactSecretsInText } from "../redact.ts";
import { cwToolResult, toolDetailPreview, toolFailurePreview } from "../tools/tool-summary.ts";
import { isPhoneToolCallName, PHONE_TOOL_OUTPUT_NOT_KEPT } from "../../shared/phone-tools.ts";
import { ChatToolSessionError, mountChatTools, type ChatToolSession, type ChatToolResult } from "./chat-mcp-tools.ts";
import { assertImageTransport, chatImageBudget, chatToolImages, type ChatContentPart } from "./chat-images.ts";
import { createChatToolApproval } from "./chat-tool-approval.ts";
import { ChatProtocolError, object } from "./openai-chat-protocol.ts";
import { appendNative } from "./native.ts";
import { classifyError, computeBackoff, interruptibleDelay, RETRY_MAX_ATTEMPTS } from "./retry.ts";
import { outOfCreditsMessage } from "./engine-errors.ts";
import { RequestTooLargeError, sizeChange, smallerResend } from "./chat-size-limit.ts";
import { requestTooLargeMessage } from "../../shared/request-too-large.ts";
import { providerReplyCutMessage, providerReplyCutReason } from "../../shared/provider-reply-cut.ts";
import { classifyContinuable, writeTurnHandoff } from "../turns/turn-continuation.ts";
import { fullAccessActs } from "../approvals/full-access-gate.ts";
import { ModelUnsupportedError, UnsupportedChatToolsError, UnsupportedReasoningReplayError, RejectedToolCallError } from "./openai-chat-completion.ts";
import type { Completion, RuntimeOptions, Usage } from "./openai-chat-types.ts";
import type { OpenAIChatMessage } from "./openai-chat-message.ts";
import {
  MAX_CHAT_ROUNDS,
  MAX_DELIVERED_THREADS,
  MAX_MODEL_SWITCHES,
  MAX_TURN_TOOL_CALLS,
  CORRECTIVE_ROUND,
  NUDGE_ANNOUNCED_ACTION,
  TEXT_ONLY_SCREENSHOT_NOTE,
  announcesAction,
  asError,
  noModelLeftMessage,
  refusedToolCallFailure,
  stoppedAfter,
} from "./openai-chat-shared.ts";
import { turnTrace } from "../turns/turn-trace.ts";
import { chatToolsFingerprint, chatToolsTurnLimit, withWarmTokens, type WarmToolSessions } from "./openai-chat-tools-warm.ts";

export type OpenAIChatActiveTurn = {
  abort: AbortController;
  turnId: string;
  done: Promise<void>;
  approval: ReturnType<typeof createChatToolApproval>;
  asides: Array<{ text: string; steerId?: string }>;
  ending: boolean;
};

export type OpenAIChatSendTurnDeps<Config> = {
  resolveKey: (turn?: SendTurnInput) => string;
  options: RuntimeOptions<Config>;
  pingModels: (turn?: SendTurnInput) => Promise<boolean>;
  rememberWarm: (threadId: string) => void;
  releaseWarm: (threadId: string) => void;
  active: Map<string, OpenAIChatActiveTurn>;
  warmThreads: Set<string>;
  warmToolSessions: WarmToolSessions;
  messagesFor: (turn: SendTurnInput) => OpenAIChatMessage[];
  unsupportedModels: Set<string>;
  nextModel: (tried: ReadonlySet<string>) => string | undefined;
  sessionGrants: Map<string, Set<string>>;
  emit: (event: any) => void;
  base: (threadId: string, turnId: string) => any;
  complete: (...args: any[]) => Promise<Completion>;
  reasoningReplayRejected: Set<string>;
  refuseModel: (model: string) => void;
  seesImages: (turn: SendTurnInput) => boolean;
};

/** One OpenAI-compatible chat-completions turn (tools, steers, model fallback). */
export async function runOpenAIChatTurn<Config>(deps: OpenAIChatSendTurnDeps<Config>, turn: SendTurnInput) {
  const { resolveKey, options, pingModels, rememberWarm, releaseWarm, active, warmThreads, warmToolSessions, messagesFor, unsupportedModels, nextModel, sessionGrants, emit, base, complete, reasoningReplayRejected, refuseModel, seesImages } = deps;
    const apiKey = resolveKey(turn);
    if (!apiKey && !options.allowNoKey) throw new Error(options.missingKeyError);
    if (turn.warmOnly === true) {
      if (!turn.warmSignal?.aborted) {
        if (await pingModels(turn)) rememberWarm(turn.threadId);
        // #1975: mount MCP now so a cold HTTP thread reuses them on the
        // first real turn (same fingerprint / warmCommsEnv as #1953).
        if (options.tools !== false && turn.integrations) {
          turnTrace(turn.threadId, "tools-prewarm-start");
          const outcome = await warmToolSessions.prewarm(turn, {
            computerUse: Boolean(options.computerUse),
            toolLimit: options.toolLimit,
            driverKind: options.driverKind,
            // The speaker is independent of the account paying for the turn.
            person: warmResourcePerson(turn),
            signal: turn.warmSignal,
          });
          if (outcome === "mounted" || outcome === "kept") {
            rememberWarm(turn.threadId);
            turnTrace(turn.threadId, "tools-prewarmed");
          }
        }
        turn.warmSignal?.addEventListener("abort", () => releaseWarm(turn.threadId), { once: true });
      }
      return { turnId: newId() };
    }
    if (active.has(turn.threadId)) throw new Error("a turn is already running on this thread");
    if (options.computerUse && (turn.images?.length || turn.integrations?.localComputer || turn.integrations?.browser)) assertImageTransport(options.apiUrl);

    const turnId = newId();
    const reused = warmThreads.has(turn.threadId);
    if (turn.keepWarm === true) rememberWarm(turn.threadId);
    const abort = new AbortController();
    const messages = messagesFor(turn);
    // This turn's own request: a smaller resend (chat-size-limit.ts) keeps it whole.
    const request = messages.at(-1)!;
    const retainImages = chatImageBudget();
    for (const message of messages) retainImages(message.content);
    const requested = turn.model || options.models().default;
    let model = requested;
    /** Models this turn tried, the refused ones included. */
    const triedModels = new Set<string>([model]);
    // A model already refused for conversations is not sent again: the turn
    // starts on the next one, as the switch below does.
    if (options.modelFallback && unsupportedModels.has(model)) model = nextModel(triedModels) ?? model;
    triedModels.add(model);
    const secrets = [apiKey].filter((value): value is string => Boolean(value));
    for (const integration of Object.values(turn.integrations ?? {})) {
      const entries = object(integration);
      const specs = entries && "command" in entries ? [entries] : Object.values(entries ?? {}).map(object);
      for (const spec of specs) {
        for (const [key, value] of Object.entries(object(spec?.env) ?? {})) {
          if (/key|token|password|secret|authorization/i.test(key) && typeof value === "string" && value) secrets.push(value);
        }
      }
    }
    const safeText = (text: string) => {
      let safe = text;
      for (const secret of secrets) if (secret) safe = safe.split(secret).join("[redacted]");
      return redactSecretsInText(safe);
    };
    const preview = (value: unknown) => toolDetailPreview(JSON.parse(JSON.stringify(value, (_key, part) =>
      typeof part === "string" ? safeText(part) : part)));
    const native = (dir: "out" | "in", msg: unknown) => appendNative(turn.threadId, {
      dir, source: options.nativeLog.source,
      msg: JSON.parse(JSON.stringify(msg, (_key, part) => typeof part === "string" ? safeText(part) : part)),
    });
    const grantsKey = JSON.stringify([turn.threadId, turn.botId ?? null]);
    const granted = sessionGrants.get(grantsKey) ?? new Set<string>();
    sessionGrants.delete(grantsKey);
    sessionGrants.set(grantsKey, granted);
    if (sessionGrants.size > MAX_DELIVERED_THREADS) sessionGrants.delete(sessionGrants.keys().next().value!);
    const approval = createChatToolApproval({
      signal: abort.signal,
      // A guest's turn neither uses the owner's grants nor keeps one: its
      // cards offer allow once only (index.ts request.opened).
      granted: turn.guestConfined ? undefined : granted,
      // below Full only: at Full this runtime answers its own gate
      // (fullAccessActs below); judged in index.ts otherwise.
      // full-access: chat-engine
      open: (ask) => emit({
        ...base(turn.threadId, turnId), type: "request.opened", requestType: "permission",
        requestId: ask.id, tool: ask.tool, summary: ask.summary, allowSession: ask.grant !== undefined,
        ...(ask.mcpTool ? { mcpTool: ask.mcpTool } : {}),
      }),
      resolved: (ask, allowed, source) => emit({
        ...base(turn.threadId, turnId), type: "request.resolved", requestId: ask.id,
        behavior: allowed ? "allow" : "deny", source,
      }),
      openQuestion: (ask, questions) => {
        const choices = questionChoices(questions);
        emit({
          ...base(turn.threadId, turnId), type: "request.opened", requestType: "question",
          requestId: ask.id, tool: ask.tool, summary: ask.summary,
          questions, ...(choices ? { choices } : {}),
        });
      },
      resolvedQuestion: (ask, answered, source) => emit({
        ...base(turn.threadId, turnId), type: "request.resolved", requestId: ask.id,
        behavior: answered ? "answer" : "deny", source,
      }),
    });
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const turnEntry = { abort, turnId, done, approval, asides: [] as Array<{ text: string; steerId?: string }>, ending: false };
    active.set(turn.threadId, turnEntry);
    emit({ ...base(turn.threadId, turnId), type: "turn.started" });
    emit({ ...base(turn.threadId, turnId), type: "session.started", sessionId: null, model });
    if (model !== requested) emit({ ...base(turn.threadId, turnId), type: "session.model-fallback", requested, actual: model });

    void (async () => {
      let tools: ChatToolSession | undefined;
      let mountIntegrations: SendTurnInput["integrations"] | undefined;
      let toolsFp = "";
      let toolsReused = false;
      const usage: Usage = { input: 0, output: 0 };
      let hasUsage = false;
      let ok = false;
      let stopReason: string | null = null;
      let failure: string | undefined;
      let toolFailed = false;
      let toolStopped = false;
      let correctiveRounds = 0;
      const denials: string[] = [];
      const seenCalls = new Set<string>();
      let nudged = false;
      // Asides spliced into the request that is in flight. Cleared once the
      // model answers that request. Still set when the turn ends means the
      // model never read them.
      let unread: Array<{ text: string; steerId?: string }> = [];
      try {
        const parsed = parseToolScope(turn.toolScope);
        if (!parsed.ok) throw new Error(parsed.error);
        const scope = parsed.scope;
        const questionAllowed = options.tools !== false && allowsTool(scope, { kind: "native", name: ASK_USER_TOOL });
        // Never name more tools than the provider takes: past its limit the
        // session defers the rest behind a search (chat-mcp-tools.ts), and
        // ask_user, added below, keeps its place within the limit. Same
        // formula as warmOnly prewarm (chatToolsTurnLimit) so fingerprints match.
        const limit = chatToolsTurnLimit({
          toolsEnabled: options.tools !== false,
          toolLimit: options.toolLimit,
          driverKind: options.driverKind,
          toolScope: turn.toolScope,
        });
        if (!limit.ok) throw new Error(limit.error);
        const toolLimit = limit.toolLimit;
        turnTrace(turn.threadId, "tools-mount-start");
        // Per-turn tokens ride files (spawn-contract warmCommsEnv) so a kept
        // agents MCP process serves the next turn of this thread without a
        // cold spawn before first token (#1953). A warmOnly prewarm (#1975)
        // lands in the same cache under the same fingerprint.
        const warmTurn = options.tools === false ? turn : withWarmTokens(turn, turn.threadId);
        mountIntegrations = options.tools === false ? undefined : warmTurn.integrations;
        toolsFp = chatToolsFingerprint(mountIntegrations, {
          computerUse: Boolean(options.computerUse),
          toolScope: turn.toolScope,
          toolLimit,
          callTimeoutMs: turn.mcpCallTimeoutMs,
        });
        const cached = mountIntegrations ? warmToolSessions.get(turn.threadId, toolsFp, warmResourcePerson(turn)) : undefined;
        if (cached) {
          tools = cached;
          toolsReused = true;
          warmToolSessions.claim(turn.threadId);
          turnTrace(turn.threadId, "tools-reused");
        } else {
          tools = await mountChatTools(mountIntegrations, abort.signal, options.computerUse, scope, turn.mcpCallTimeoutMs, toolLimit);
          if (mountIntegrations) {
            warmToolSessions.set(turn.threadId, toolsFp, tools, { person: warmResourcePerson(turn), active: true });
            toolsReused = true; // The cache owns cleanup for new mounts too.
          }
        }
        turnTrace(turn.threadId, "tools-mounted");
        for (const { server, reason } of tools.skipped) {
          // A technical detail for the logs, never a row in the chat.
          console.warn(`[chat-tools] MCP server "${server}" was skipped for this turn: ${safeText(reason)}`);
        }
        let optionalQuestionOnly = questionAllowed && tools.definitions.length === 0;
        // The runtime's one built-in tool rides the same list: ask_user is
        // how a chat-completions engine reaches a person. An MCP server that
        // squats the name cannot shadow it — dispatch intercepts the name
        // before validate — but the definition is then skipped so the list
        // never advertises two.
        if (questionAllowed && !tools.definitions.some((definition) => definition.function.name === ASK_USER_TOOL)) {
          tools.definitions.push(ASK_USER_TOOL_DEFINITION);
        }
        for (let round = 0; round < MAX_CHAT_ROUNDS; round++) {
          abort.signal.throwIfAborted();
          // Drain parked mid-turn input here, before the next completion
          // request: the previous round's tool results are complete, so a
          // user message lands on a consistent array (never inside a tool
          // batch) and the provider sees it as the newest input.
          unread = turnEntry.asides.splice(0);
          if (unread.length) messages.push({ role: "user", content: unread.map((aside) => aside.text).join("\n\n") });
          // The last step cannot take another round. Refuse a steer now so
          // the harness queues it as the next turn instead of losing it
          // under "Stopped after N steps".
          turnEntry.ending = round === MAX_CHAT_ROUNDS - 1;
          native("out", options.nativeLog.outgoing(turn, messages, model, tools.definitions));
          let attempt = 0;
          let resized = false;
          let completion: Completion;
          for (;;) {
            let streamed = false;
            let answerStreamed = false;
            let firstDeltaTraced = false;
            const pending = { assistant_text: "", reasoning_text: "" };
            const delta = (text: string, streamKind: keyof typeof pending, flush = false) => {
              let combined = pending[streamKind] + text;
              // Mask complete matches before holding a suffix: otherwise a key
              // such as "abab" could be split at its own repeated prefix.
              for (const secret of secrets) if (secret) combined = combined.split(secret).join("[redacted]");
              let hold = 0;
              // A configured credential can straddle chunks. Hold any suffix
              // that could be its prefix until the next chunk disambiguates it.
              if (!flush) for (const secret of secrets) {
                for (let length = Math.min(secret.length - 1, combined.length); length > hold; length--) {
                  if (combined.endsWith(secret.slice(0, length))) { hold = length; break; }
                }
              }
              pending[streamKind] = hold ? combined.slice(-hold) : "";
              const visible = safeText(hold ? combined.slice(0, -hold) : combined);
              if (visible) {
                if (streamKind === "assistant_text" && !firstDeltaTraced) {
                  firstDeltaTraced = true;
                  turnTrace(turn.threadId, "first-delta-emit");
                }
                emit({ ...base(turn.threadId, turnId), type: "content.delta", streamKind, delta: visible });
              }
            };
            try {
              turnTrace(turn.threadId, "request-built");
              completion = await complete(messages, model, true, abort.signal, (text: string, streamKind: "assistant_text" | "reasoning_text") => {
                streamed = true;
                if (streamKind === "assistant_text") answerStreamed = true;
                delta(text, streamKind);
              }, tools.definitions, undefined, undefined, apiKey, turn.effort);
              delta("", "assistant_text", true);
              delta("", "reasoning_text", true);
              break;
            } catch (value) {
              const error = asError(value);
              const verdict = classifyError(error);
              // A schema rejection of the echoed reasoning executed nothing
              // upstream, so the same transcript without that one property
              // repeats no operation. The error needs the field in the
              // request, so the stripped resend cannot loop.
              if (error instanceof UnsupportedReasoningReplayError && !streamed && !abort.signal.aborted) {
                reasoningReplayRejected.add(model);
                for (const message of messages) delete message.reasoning_content;
                continue;
              }
              // A provider refuses an oversized request before running
              // anything, so one smaller copy may go again: older pictures
              // first, then this round's long tool outputs, then the oldest
              // history (chat-size-limit.ts). Only once per round.
              if (error instanceof RequestTooLargeError && !abort.signal.aborted) {
                const resend = resized ? null : smallerResend(messages, request, error.bytes);
                native("out", { refused: "request_too_large", bytes: error.bytes, ...(resend ? { before: resend.before, after: resend.after } : {}) });
                console.warn(`${options.driverKind}: ${model} refused a ${error.bytes}-byte request as too large; ${resend ? `resending smaller (${sizeChange(resend.before, resend.after)})` : "not resending"}`);
                if (!resend) throw new ChatProtocolError(requestTooLargeMessage(options.models().options.find((option) => option.id === model)?.label ?? model));
                messages.splice(0, messages.length, ...resend.messages);
                resized = true;
                emit({ ...base(turn.threadId, turnId), type: "turn.retrying", attempt: 1, delayMs: 0, reason: "request_too_large" });
                continue;
              }
              // A refused tool call ran nothing, so the same request goes
              // again; the model usually answers properly next time. Not once
              // answer text streamed: the phones' live bubble would join it to
              // the next attempt's. Streamed thinking stays thinking. Each
              // refusal, failed_generation included, goes to the native log.
              if (error instanceof RejectedToolCallError) {
                native("in", { refused: "tool_use_failed", attempt: attempt + 1, error: error.refusal });
                if (!answerStreamed && !abort.signal.aborted && attempt < RETRY_MAX_ATTEMPTS - 1) {
                  emit({ ...base(turn.threadId, turnId), type: "turn.retrying", attempt: ++attempt, delayMs: 0, reason: "tool_use_failed" });
                  continue;
                }
                if (!abort.signal.aborted) throw new ChatProtocolError(refusedToolCallFailure(error, seenCalls.size > 0));
              }
              // Only our optional question changed a previously plain request.
              // A structured parameter rejection has executed nothing; never
              // downgrade mounted tools, streamed output or a handled call.
              if (optionalQuestionOnly && round === 0 && !streamed && !seenCalls.size && !abort.signal.aborted &&
                  error instanceof UnsupportedChatToolsError && verdict.reason === "invalid_request") {
                optionalQuestionOnly = false;
                tools.definitions.length = 0;
                continue;
              }
              // The provider refused the model itself (not a chat model, no
              // tools with reasoning): nothing ran upstream, so the same
              // request goes on at once on another model of the catalog, and
              // the refused one leaves it. The chat shows nothing; the Events
              // lens says why (#1668's rule). Never once answer text streamed.
              const modelRefused = error instanceof ModelUnsupportedError ||
                (error instanceof UnsupportedChatToolsError && tools.definitions.length > 0);
              if (modelRefused && !answerStreamed && !abort.signal.aborted) {
                refuseModel(model);
                const next = triedModels.size <= MAX_MODEL_SWITCHES ? nextModel(triedModels) : undefined;
                native("in", { refused: "model_unsupported", model, ...(next ? { next } : {}) });
                if (!next) throw new ChatProtocolError(noModelLeftMessage(options.models().options.find((option) => option.id === model)?.label ?? model));
                console.warn(`${options.driverKind}: ${model} refused this conversation; continuing on ${next}`);
                emit({ ...base(turn.threadId, turnId), type: "runtime.notice",
                  message: `${model} cannot answer this conversation: the same turn continues on ${next}.` });
                emit({ ...base(turn.threadId, turnId), type: "session.model-fallback", requested, actual: next });
                // Another model cannot read the refused one's reasoning.
                for (const message of messages) { delete message.reasoning_content; delete message.reasoning; delete message.reasoning_details; }
                model = next;
                triedModels.add(next);
                continue;
              }
              // Once a call has been handled, never replay it through a turn retry.
              if (options.retryScale === undefined || abort.signal.aborted || streamed || seenCalls.size ||
                  error instanceof ChatProtocolError || !verdict.transient || attempt >= RETRY_MAX_ATTEMPTS - 1) throw error;
              const delayMs = computeBackoff(attempt++);
              emit({ ...base(turn.threadId, turnId), type: "turn.retrying", attempt, delayMs, reason: verdict.reason });
              await interruptibleDelay(delayMs * options.retryScale, abort.signal).promise;
              abort.signal.throwIfAborted();
            }
          }
          native("in", options.nativeLog.incoming(completion));
          // The completion that carried the parked words came back: the model
          // read them. Said so, the harness counts them received and never
          // offers them to the next turn as unseen, which answered them a
          // second time (2026-11-01).
          for (const aside of unread) {
            if (aside.steerId) emit({ ...base(turn.threadId, turnId), type: "steer.received", steerId: aside.steerId });
          }
          unread = [];
          if (completion.usage) {
            usage.input += completion.usage.input;
            usage.output += completion.usage.output;
            hasUsage = true;
            emit({ ...base(turn.threadId, turnId), type: "thread.token-usage.updated", ...usage });
          }
          // Reasoning on a tool-call round belongs to the protocol, not a final reply.
          const reply = completion.text.trim() ? completion.text : completion.toolCalls.length ? "" : completion.reasoning;
          if (reply.trim()) emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "assistant_text", text: safeText(reply) });
          abort.signal.throwIfAborted();
          if (!completion.toolCalls.length) {
            const cut = providerReplyCutReason(completion.finishReason);
            if (!reply.trim()) {
              // A content filter or length stop with no text: the cut is the
              // cause, not a blank completion.
              if (cut) throw new ChatProtocolError(providerReplyCutMessage(cut));
              throw new ChatProtocolError("provider returned an empty response");
            }
            // Partial reply already emitted above. A cut is a readable line
            // (shared/provider-reply-cut.ts), not the raw finish_reason.
            if (cut) throw new ChatProtocolError(providerReplyCutMessage(cut));
            if (completion.finishReason && completion.finishReason !== "stop") {
              throw new ChatProtocolError(providerReplyCutMessage("generic"));
            }
            if (options.nudgeAnnouncedAction && !nudged && tools.definitions.length && announcesAction(completion.text)) {
              nudged = true;
              messages.push({ role: "assistant", content: completion.text }, { role: "user", content: NUDGE_ANNOUNCED_ACTION });
              continue;
            }
            if (toolFailed) {
              // A person's "no" is never answered with another attempt; a
              // failure may first get the configured corrective rounds.
              // The stop is recorded on the turn (stopReason) and the tool rows
              // carry the detail; no banner is added to the chat for it.
              if (!denials.length && !turnEntry.ending && correctiveRounds < (turn.toolErrorCorrectiveRounds ?? 0)) {
                correctiveRounds += 1;
                messages.push({ role: "user", content: CORRECTIVE_ROUND });
                continue;
              }
              stopReason = "tool_error";
              toolStopped = true;
              break;
            }
            // Input parked while this final answer streamed: answer it in one
            // more round rather than end the turn with it unread.
            if (turnEntry.asides.length) {
              messages.push({ role: "assistant", content: reply });
              continue;
            }
            ok = true;
            break;
          }
          if (!tools.definitions.length) throw new ChatProtocolError("provider returned tool calls, but no tools are available for this turn");
          // Validate IDs for the entire batch before executing any of its calls.
          for (const call of completion.toolCalls) {
            if (seenCalls.has(call.id)) throw new ChatProtocolError("provider reused a tool-call ID; refusing to repeat an operation");
            seenCalls.add(call.id);
          }
          // The whole batch is refused before any of it runs.
          if (seenCalls.size > MAX_TURN_TOOL_CALLS) throw new ChatProtocolError(stoppedAfter(`${MAX_TURN_TOOL_CALLS} tool calls`));
          messages.push({ role: "assistant", content: completion.text || null, tool_calls: completion.toolCalls,
            ...(completion.protocolReasoning && !reasoningReplayRejected.has(model) ? { [options.reasoningReplayField ?? "reasoning_content"]: completion.protocolReasoning } : {}),
            ...(completion.protocolReasoningDetails.length ? { reasoning_details: completion.protocolReasoningDetails } : {}),
          });
          // After a corrective round, the failure stays pending only until the bot runs tools again.
          if (correctiveRounds && !denials.length) toolFailed = false;
          const screenshotParts: ChatContentPart[] = [];
          for (const call of completion.toolCalls) {
            abort.signal.throwIfAborted();
            let result: ChatToolResult;
            let started = false;
            let fatal: Error | undefined;
            try {
              let args: unknown;
              try { args = JSON.parse(call.function.arguments); }
              catch { throw new ChatProtocolError("tool arguments are not complete JSON"); }
              if (!object(args)) throw new ChatProtocolError("tool arguments must be a JSON object");
              const inputPreview = preview(args);
              if (call.function.name === ASK_USER_TOOL) {
                if (!questionAllowed || !allowsTool(scope, { kind: "native", name: ASK_USER_TOOL })) throw new Error("Tool selection excludes this tool");
                // A question is the person's card, not a permission, so it is
                // handled before the gate below: under Full access that gate
                // would auto-run an unanswered ask, and under Ask it would
                // render Allow/Deny over a question nobody can answer that way.
                const questions = parseAskQuestions(args);
                abort.signal.throwIfAborted();
                emit({ ...base(turn.threadId, turnId), type: "item.started", itemType: "tool", itemId: call.id,
                  title: call.function.name, ...(inputPreview ? { input: inputPreview } : {}),
                });
                started = true;
                if (!questions) {
                  denials.push(ASK_USER_TOOL);
                  result = { ok: false, text: "The ask_user arguments are malformed: pass a JSON object with a questions array of one to six questions, each with a question string and at most twelve options carrying a label. Ask again with valid arguments." };
                } else {
                  // The tool result is the card's Q:/A: reply verbatim — never
                  // a summary, and never words the person did not send.
                  const answer = await approval.question(ASK_USER_TOOL, askQuestionSummary(questions), questions);
                  abort.signal.throwIfAborted();
                  if (answer === null) {
                    // An unanswered question is absence, not a "no": the card
                    // timed out or the person closed it. Keep the turn alive so
                    // the model's final response stands; it is told not to
                    // guess and may ask again later. An explicit deny of a
                    // permission stays terminal.
                    result = { ok: true, text: "The person did not answer this question. Do not guess an answer; ask again later or proceed without it." };
                  } else {
                    result = { ok: true, text: answer };
                  }
                }
              } else {
                tools.validate(call.function.name, args);
                // A searched server's call_tool is shown as the tool it runs;
                // its catalog reads ask nothing, as listing tools never did.
                const shown = tools.view(call.function.name, args as Record<string, unknown>);
                const shownPreview = shown.input === args ? inputPreview : preview(shown.input);
                // Full access is the person's explicit grant to answer every
                // prompt. This runtime has no provider reviewer to hand it to,
                // so it is honoured here: without it every single tool call on
                // an OpenAI-compatible engine stops for a card, and a Primary Bot's
                // delegated Full access cannot help either. #1905: read from
                // the one Full access decision (full-access-gate.ts).
                // full-access: chat-engine
                const allowed = fullAccessActs(turn.approvalMode) || !shown.ask
                  || await approval.ask(shown.title, shownPreview ?? "This tool has no arguments.", shown.grant, shown.mcpTool);
                abort.signal.throwIfAborted();
                emit({ ...base(turn.threadId, turnId), type: "item.started", itemType: "tool", itemId: call.id,
                  title: shown.title, ...(shownPreview ? { input: shownPreview } : {}),
                });
                started = true;
                if (allowed) {
                  result = await tools.execute(call.function.name, args as Record<string, unknown>, abort.signal);
                  if (result.images?.length && !seesImages(turn)) {
                    const { images: _dropped, ...rest } = result;
                    result = { ...rest, text: `${rest.text}\n${TEXT_ONLY_SCREENSHOT_NOTE}` };
                  }
                  if (result.images?.length) {
                    try {
                      assertImageTransport(options.apiUrl);
                      retainImages(result.images);
                    } catch (error) {
                      throw new ChatToolSessionError(asError(error).message);
                    }
                  }
                } else {
                  denials.push(shown.title);
                  result = { ok: false, text: "Permission denied or expired; the tool was not executed." };
                }
              }
            } catch (error) {
              if (error instanceof ChatToolSessionError) fatal = error;
              result = { ok: false, text: abort.signal.aborted
                ? "Tool interrupted; an operation already dispatched may have taken effect. Verify its state before retrying."
                : safeText(asError(error).message).slice(0, 2_000) };
            }
            if (!started) emit({ ...base(turn.threadId, turnId), type: "item.started", itemType: "tool", itemId: call.id, title: call.function.name });
            const text = safeText(result.text);
            // a phone's answer reaches the model, never the event log or the chat (phone_tool)
            // a failure reads as its words, not the { ok, result } envelope the model gets
            const output = isPhoneToolCallName(call.function.name) ? PHONE_TOOL_OUTPUT_NOT_KEPT
              : result.ok ? preview({ ok: result.ok, result: text }) : toolFailurePreview(text) ?? preview({ ok: result.ok, result: text });
            emit({
              ...base(turn.threadId, turnId), type: "item.completed", itemType: "tool", itemId: call.id, ok: result.ok, output,
              ...(result.ok ? cwToolResult(call.function.name, text) : {}),
            });
            if (!result.ok) toolFailed = true;
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: result.ok, result: text }) });
            screenshotParts.push(...chatToolImages(call.id, result.images));
            abort.signal.throwIfAborted();
            if (fatal) throw fatal;
          }
          if (screenshotParts.length) messages.push({ role: "user", content: screenshotParts });
        }
        if (!ok && !toolStopped) throw new ChatProtocolError(stoppedAfter(`${MAX_CHAT_ROUNDS} steps`));
      } catch (value) {
        stopReason = abort.signal.aborted ? "interrupted" : stopReason ?? "error";
        failure = safeText(asError(value).message).slice(0, 2_000);
      } finally {
        turnEntry.ending = true;
        approval.close();
        let cleanupFailed = false;
        try {
          if (tools) {
            // Keep the mount for the next turn of this thread when the
            // fingerprint still matches (warmCommsEnv already rewrote the
            // token files). An interrupted turn drops it so a half-dead
            // MCP child is never reused.
            if (!abort.signal.aborted && mountIntegrations) {
              warmToolSessions.keep(turn.threadId, tools, toolsFp, { person: warmResourcePerson(turn), prewarmed: false });
            } else if (toolsReused) {
              await warmToolSessions.release(turn.threadId);
            } else {
              await tools.close();
            }
          }
        } catch {
          ok = false;
          stopReason = "error";
          cleanupFailed = true;
          failure = "Tool processes could not be stopped; their execution state is uncertain.";
          await warmToolSessions.release(turn.threadId).catch(() => {});
        }
        if (abort.signal.aborted) { ok = false; stopReason = "interrupted"; }
        if (!ok && (unread.length || turnEntry.asides.length)) {
          emit({
            ...base(turn.threadId, turnId), type: "runtime.notice",
            message: "This turn ended before the model read a message sent while it ran. Send that message again.",
          });
        }
        if (failure && (!abort.signal.aborted || cleanupFailed)) {
          // "upstream" (an OpenAI-compatible URL) names no provider, and the Cloud trial credit reads its raw line.
          const message = options.httpErrorLabel === "upstream" ? failure : outOfCreditsMessage(options.httpErrorLabel, failure);
          emit({ ...base(turn.threadId, turnId), type: "runtime.error", message, terminal: !abort.signal.aborted });
        }
        // Automatic continuity: a resumable terminal (the step or tool-call
        // cap) persists a handoff and raises cap.exhausted so the harness
        // can start a `Continue:` thread. Interruptions, tool errors and
        // provider errors (a rate limit included) are excluded by
        // classifyContinuable.
        if (!ok && !abort.signal.aborted) {
          const continuable = classifyContinuable(stopReason, failure);
          if (continuable) {
            const handoffPath = writeTurnHandoff({
              threadId: turn.threadId,
              turnId,
              model,
              usage,
              hasUsage,
              failure,
              toolCalls: seenCalls.size,
              messages,
            });
            if (handoffPath) emit({ ...base(turn.threadId, turnId), type: "cap.exhausted", handoffPath, reason: continuable });
          }
        }
        if (active.get(turn.threadId) === turnEntry) active.delete(turn.threadId);
        emit({ ...base(turn.threadId, turnId), type: "turn.completed", ok, stopReason, cost: null,
          ...(hasUsage && (options.includeUsageInCompleted || seenCalls.size) ? { usage } : {}),
          ...(denials.length ? { denials } : {}),
        });
        resolveDone();
      }
    })();
    return { turnId, ...(reused ? { reused: true } : {}) };
}

export function createOpenAIChatSendTurn<Config>(deps: OpenAIChatSendTurnDeps<Config>) {
  return (turn: SendTurnInput) => runOpenAIChatTurn(deps, turn);
}
