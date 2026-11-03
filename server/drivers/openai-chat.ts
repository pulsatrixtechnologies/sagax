import { createChatCompletions, ModelUnsupportedError, UnsupportedChatToolsError, UnsupportedReasoningReplayError, RejectedToolCallError } from "./openai-chat-completion.ts";
import type { Completion, RuntimeOptions, Usage } from "./openai-chat-types.ts";
import type { OpenAIChatMessage } from "./openai-chat-message.ts";
import { createHash } from "node:crypto";
import type { ProviderInstance, RuntimeEvent, RuntimeEventListener, SendTurnInput } from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { ASK_USER_TOOL, ASK_USER_TOOL_DEFINITION, askQuestionSummary, parseAskQuestions, questionChoices } from "../../shared/ask-question.ts";
import { allowsTool, parseToolScope } from "../../shared/tool-scope.ts";
import { redactSecretsInText } from "../redact.ts";
import { cwToolResult, toolDetailPreview, toolFailurePreview } from "../tools/tool-summary.ts";
import { isPhoneToolCallName, PHONE_TOOL_OUTPUT_NOT_KEPT } from "../../shared/phone-tools.ts";
import { ChatToolSessionError, mountChatTools, providerToolLimit, type ChatToolSession, type ChatToolResult } from "./chat-mcp-tools.ts";
import { assertImageTransport, chatImageBudget, chatToolImages, chatUserContent, type ChatContentPart } from "./chat-images.ts";
import { promptHalves, sectionDelta, sectionFingerprints, volatileContextNote, volatileSectionsUpdate, withContextNote } from "./prompt-split.ts";
import { createChatToolApproval } from "./chat-tool-approval.ts";
import { ChatProtocolError, object } from "./openai-chat-protocol.ts";
import { appendNative } from "./native.ts";
import { classifyError, computeBackoff, interruptibleDelay, RETRY_MAX_ATTEMPTS } from "./retry.ts";
import { outOfCreditsMessage } from "./engine-errors.ts";
import { RequestTooLargeError, sizeChange, smallerResend } from "./chat-size-limit.ts";
import { requestTooLargeMessage } from "../../shared/request-too-large.ts";
import { providerReplyCutMessage, providerReplyCutReason } from "../../shared/provider-reply-cut.ts";
import { classifyContinuable, writeTurnHandoff } from "../turns/turn-continuation.ts";
import { DUPLEX_INTERRUPT_WAIT_MS } from "../voice/voice-call-duplex.ts";
import { KEY_REJECTED_REASON, keyRejected } from "../key-rejections.ts";
import { fullAccessActs } from "../approvals/full-access-gate.ts";

export { ModelUnsupportedError } from "./openai-chat-completion.ts";

export type { OpenAIChatMessage } from "./openai-chat-message.ts";

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

/** At most this many models take over one turn after a refusal. */
const MAX_MODEL_SWITCHES = 3;

/** The plain words a turn ends with when no model of the engine can answer
 * it. "model ... is not supported" lets Auto skip it (model-auto.ts). */
export const noModelLeftMessage = (label: string) =>
  `This model is not supported for conversations (${label}), and no other model of this engine could take over. Choose another model.`;

/** #1696: the engine itself is out of conversation models; the host may move
 * the same turn to another engine (limit-failover-host.ts), as a usage limit does. */
export function isEngineExhaustedRefusal(message: string | undefined): boolean {
  return typeof message === "string" && /no other model of this engine could take over/i.test(message);
}

/** One turn's safety stops: model steps, and tool calls across all of them.
 * Tool-heavy models (a memory server, a browser) take dozens of steps, and
 * a stopped turn cannot simply be continued — the next turn is rebuilt from
 * the text transcript, which holds none of these tool results. The calls
 * that ran have taken effect, so the stop asks only for what is left: a
 * retry of the whole task would repeat them. */
const MAX_CHAT_ROUNDS = 64;
const MAX_TURN_TOOL_CALLS = 200;
const stoppedAfter = (count: string) =>
  `Stopped after ${count} without a final answer. The steps so far already ran, so ask only for what's left.`;

interface DeliveredUserMessage {
  /** The turn text the harness passed, recall left out, before any note. */
  text: string;
  /** That text as it went to the provider, which is how it is replayed. */
  sent: string;
  /** The trimmed volatile half, when this message carried its note. */
  volatile?: string;
  /** With a note: the volatile sections it carried (prompt-split.ts
   * sectionFingerprints), all of them (`full`) or only those it changed,
   * null for one it announced as gone. Replay merges them to know which
   * copy of each section the replayed history holds. */
  sections?: { full: boolean; prints: Record<string, string | null> };
  /** Fingerprint of the message just before it when it was sent ("" for
   * none), so an identical text sent elsewhere later is not mistaken for it. */
  after: string;
}

/** Bytes replaying messages as sent may add to the stored transcript, which
 * the harness already bounds. Spent oldest first: an earlier message keeps
 * its replayed form for as long as it stays in the window, so a request
 * that runs out of budget changes only at the end of the previous one. */
const MAX_REPLAY_EXTRA_BYTES = 24_000;
/** Threads remembered at once; the least recently sent is forgotten first. */
const MAX_DELIVERED_THREADS = 256;

const fingerprint = (text: string) => createHash("sha256").update(text).digest("base64url");

/** Line a stored transcript up with what its user messages carried. The
 * stored text is what the person typed, which the turn text ends with after
 * whatever the harness put in front (the clock), so a record matches a
 * message that is its whole text or its last paragraph, and follows the
 * same message it followed when sent. The first message of the window
 * matches on text alone, since what came before it may have been dropped.
 * Matching runs newest first, because the window drops the oldest
 * messages; a message no record matches is replayed as stored. */
function replayDelivered(
  transcript: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
  records: readonly DeliveredUserMessage[],
): { content: Map<number, string>; matched: DeliveredUserMessage[]; volatile: string | undefined; sections: Record<string, string> | undefined } {
  const found: Array<{ index: number; record: DeliveredUserMessage }> = [];
  let next = records.length - 1;
  for (let index = transcript.length - 1; index >= 0 && next >= 0; index--) {
    const message = transcript[index]!;
    if (message.role !== "user" || !message.text) continue;
    const after = index > 0 ? fingerprint(transcript[index - 1]!.text) : undefined;
    for (let at = next; at >= 0; at--) {
      const record = records[at]!;
      if (record.text !== message.text && !record.text.endsWith("\n\n" + message.text)) continue;
      if (after !== undefined && record.after !== after) continue;
      found.unshift({ index, record });
      next = at - 1;
      break;
    }
  }
  const content = new Map<number, string>();
  let volatile: string | undefined;
  // The copy of each volatile section the replayed notes hold: unknown
  // (undefined) until a full note is in the window, and again after a note
  // that recorded no sections.
  let sections: Record<string, string> | undefined;
  let budget = MAX_REPLAY_EXTRA_BYTES;
  for (const { index, record } of found) {
    const extra = Buffer.byteLength(record.sent) - Buffer.byteLength(transcript[index]!.text);
    if (extra > budget) break;
    budget -= extra;
    content.set(index, record.sent);
    if (record.volatile !== undefined) {
      volatile = record.volatile;
      if (!record.sections) sections = undefined;
      else if (!record.sections.full && !sections) {
        // Only a partial copy is in the window (its full note was trimmed
        // away): unknown, so the next turn delivers the whole half again.
        volatile = undefined;
      } else {
        const merged: Record<string, string> = record.sections.full ? {} : { ...sections };
        for (const [id, print] of Object.entries(record.sections.prints)) {
          if (print === null) delete merged[id];
          else merged[id] = print;
        }
        sections = merged;
      }
    }
  }
  return { content, matched: found.map(({ record }) => record), volatile, sections };
}

const CORRECTIVE_ROUND = "[Sagax: a tool call in this turn failed (its result is marked ok:false). Re-run the failed operations with corrected inputs where possible, check the results, then give your final answer. Do not report results you did not get.]";
const NUDGE_ANNOUNCED_ACTION = "You said what you would do next but called no tool. Do it now with your tools, or reply with your final answer if nothing is left to do.";

/** A short reply that only announces a next step, with nothing to answer. */
export function announcesAction(text: string): boolean {
  const reply = text.trim();
  if (!reply || reply.length > 400 || reply.includes("?")) return false;
  return /(?:[:\u2014\u2013]|\.\.\.|\u2026)$/.test(reply) ||
    /^(?:checking|let me|i'll|i will|i'm going to|i am going to|opening|pulling|looking|searching|navigating|reading|fetching|loading|now (?:i'll|let me|opening|checking|pulling|reading))\b/i.test(reply);
}

const TEXT_ONLY_ATTACHMENT_NOTE = "[The person attached image(s), but this model cannot see images. Say so if the request depends on them.]";
const TEXT_ONLY_SCREENSHOT_NOTE = "[Screenshot not shown: this model cannot see images. Read the page with a snapshot or a text tool instead.]";



/** What a failed turn says once the provider refused every attempt: what
 *  happened, the next step, then the provider's words. The refused call ran
 *  nothing, but tool calls from earlier steps of the turn did, and a Retry
 *  of the whole request would repeat them. */
function refusedToolCallFailure(error: RejectedToolCallError, earlierSteps: boolean): string {
  const words = typeof error.refusal.message === "string" ? error.refusal.message : error.message;
  const tool = /attempted to call tool '([^']+)'/.exec(words)?.[1];
  const what = tool ? `tried to use a tool it was not given ("${tool}")` : "made a tool call the provider rejected";
  const next = earlierSteps
    ? "The steps before it already ran, so ask only for what's left."
    : "Nothing ran. Retry; if it keeps happening, rephrase the request or choose another model.";
  return `The model ${what}. ${next} Provider: ${words.slice(0, 200)}`;
}

/** Shared runtime for the three providers that speak OpenAI chat completions. */
export function createOpenAIChatRuntime<Config>(options: RuntimeOptions<Config>): ProviderInstance {
  const { input } = options;
  const resolveKey = (turn?: SendTurnInput): string => {
    if (turn?.access?.via === "owner-key" || turn?.access?.via === "speaker-key") {
      if (turn.access.localKeyPrincipal && typeof options.apiKey === "function") return options.apiKey(turn).trim();
      return turn.access.environment?.SAGAX_PERSONAL_PROVIDER_KEY?.trim() || "";
    }
    return (typeof options.apiKey === "function" ? options.apiKey(turn) : options.apiKey).trim();
  };
  const listeners = new Set<RuntimeEventListener>();
  const active = new Map<string, {
    abort: AbortController;
    turnId: string;
    done: Promise<void>;
    approval: ReturnType<typeof createChatToolApproval>;
    /** Mid-turn user input parked by adapter.steer. Spliced into the
     * request array at the top of the next loop round — the one place the
     * array is between rounds, never mid-tool-batch — so the model reads
     * it before its next completion. Kept out of messages[] until then:
     * a parked item must never look like delivered input. */
    asides: Array<{ text: string; steerId?: string }>;
    /** Set once the turn stops taking rounds: a later steer is refused so the
     * harness sends it as the next turn instead of parking it where no round
     * will ever read it. */
    ending: boolean;
  }>();
  /** Models whose endpoint rejected an echoed `reasoning_content`. In memory
   * only: later rounds and turns omit the field instead of failing again. */
  const reasoningReplayRejected = new Set<string>();
  /** Voice-call threads whose HTTP pool we keep alive with GET /models.
   * There is no process to hold: Node's fetch idle timeout is a few seconds,
   * the call keepalive is minutes, so a ping while any thread is warm. */
  const warmThreads = new Set<string>();
  let warmPing: ReturnType<typeof setInterval> | null = null;

  const modelsUrl = () => `${options.apiUrl.replace(/\/$/, "")}/models`;
  const auth = (apiKey: string): Record<string, string> =>
    options.authHeaders ? options.authHeaders(apiKey) : { authorization: `Bearer ${apiKey}` };

  const pingModels = async (turn?: SendTurnInput) => {
    const apiKey = resolveKey(turn);
    try {
      const response = await fetch(modelsUrl(), {
        method: "GET",
        headers: auth(apiKey),
      });
      // Drain so undici returns the socket to the keep-alive pool.
      await response.arrayBuffer().catch(() => undefined);
      return response.ok;
    } catch {
      return false;
    }
  };

  const startWarmPing = () => {
    if (warmPing) return;
    const ms = Number(process.env.FAKE_GROK_WARM_PING_MS ?? "2500");
    if (!Number.isFinite(ms) || ms <= 0) return;
    warmPing = setInterval(() => { void pingModels(); }, ms);
    warmPing.unref?.();
  };

  const stopWarmPing = () => {
    if (!warmPing) return;
    clearInterval(warmPing);
    warmPing = null;
  };

  const rememberWarm = (threadId: string) => {
    const empty = warmThreads.size === 0;
    warmThreads.add(threadId);
    if (empty) startWarmPing();
  };

  const releaseWarm = (threadId: string) => {
    warmThreads.delete(threadId);
    if (warmThreads.size === 0) stopWarmPing();
  };

  /** What each user message of a thread actually carried, oldest first. The
   * stored transcript holds only what the person typed, while the request
   * carried the turn text (the clock) and maybe a context note; replaying
   * the stored text would rewrite history the provider has cached. In memory
   * only: after a restart a thread replays as stored, as it always did. */
  const delivered = new Map<string, DeliveredUserMessage[]>();
  /** "Always allow this session" grants by thread and bot: the exact tools a
   * person allowed one bot for the rest of the conversation. A room runs
   * every member on the room's thread, and one bot's allow is not another's.
   * This runtime has no native session, so the conversation's lives as long
   * as this instance does, as an ACP agent's does with its process; none
   * survives a restart. Not cleared on `sessionReset`: with no cursor to
   * resume, the harness sends that on nearly every turn of this runtime. */
  const sessionGrants = new Map<string, Set<string>>();

  const emit = (event: RuntimeEvent) => {
    for (const listener of Array.from(listeners)) listener(event);
  };
  const base = (threadId: string, turnId: string) => ({
    eventId: newEventId(),
    provider: options.driverKind,
    threadId,
    turnId,
    createdAt: new Date().toISOString(),
  });

  /** Models whose /responses request refused an optional part, or that
   * /responses does not serve at all. In memory only. */
  /** Models the provider refused for a conversation (ModelUnsupportedError). */
  const unsupportedModels = new Set<string>();

  const { complete } = createChatCompletions(options, auth);

  /** A model refused for conversations leaves the catalog for good (this
   * process); the next one to try is the catalog's default, else its first
   * row, never one already refused or tried in this turn. */
  const refuseModel = (model: string) => {
    unsupportedModels.add(model);
    options.onModelUnsupported?.(model);
  };
  const nextModel = (tried: ReadonlySet<string>): string | undefined => {
    if (!options.modelFallback) return undefined;
    const catalog = options.models();
    const usable = (id: string) => !unsupportedModels.has(id) && !tried.has(id);
    if (catalog.default && usable(catalog.default)) return catalog.default;
    return catalog.options.find((option) => usable(option.id))?.id;
  };

  const seesImages = (turn: SendTurnInput) =>
    options.imageInput?.(turn.model || options.models().default) ?? true;
  const messagesFor = (turn: SendTurnInput): OpenAIChatMessage[] => {
    // The system message is the head of the resent prefix, so only the
    // stable half belongs there: a volatile edit must not re-price the
    // tools, instructions and transcript the provider already cached.
    // The volatile half rides a user message instead. Earlier user messages
    // are replayed as they were sent, notes included, so the previous
    // request stays a prefix of this one and a note the model already has
    // is not repeated; the newest message carries one only when the replayed
    // history does not already end on the current copy. Automatic recall
    // informed its own turn only and is not replayed.
    const halves = promptHalves(turn);
    const transcript = turn.transcript ?? [];
    const replay = replayDelivered(transcript, delivered.get(turn.threadId) ?? []);
    const volatile = halves.volatile.trim();
    // Only the sections that changed ride when the replayed notes hold a
    // known copy of each (2026-10-19 perf parity, point 4).
    const skip = halves.stable === null || (!turn.mentionTurn && replay.volatile === volatile);
    const sectionsNote = skip || replay.volatile === undefined ? null
      : volatileSectionsUpdate(turn.systemVolatileSections, replay.sections, Boolean(turn.mentionTurn));
    const note = skip ? "" : sectionsNote ?? volatileContextNote(volatile, Boolean(replay.volatile));
    const current = turn.systemVolatileSections ? sectionFingerprints(turn.systemVolatileSections) : undefined;
    const sectionsRecord = !note || !current ? undefined
      : sectionsNote === null ? { full: true, prints: current as Record<string, string | null> }
      : { full: false, prints: sectionDelta(current, replay.sections ?? {}, Boolean(turn.mentionTurn)) };
    const textOnly = (text: string) => !options.computerUse || seesImages(turn) || !turn.images?.length ? text
      : `${text}\n\n${TEXT_ONLY_ATTACHMENT_NOTE}`;
    const userTurn = note ? { ...turn, text: withContextNote(note, turn.text) } : turn;
    const content = options.computerUse && seesImages(turn) ? chatUserContent(userTurn) : textOnly(userTurn.text);
    const kept = turn.recalled ? turn.text.replace(`${turn.recalled}\n\n`, "") : turn.text;
    const record = {
      text: kept,
      sent: textOnly(withContextNote(note, kept)),
      ...(note ? { volatile } : {}),
      ...(sectionsRecord ? { sections: sectionsRecord } : {}),
      after: transcript.length ? fingerprint(transcript.at(-1)!.text) : "",
    };
    delivered.delete(turn.threadId);
    delivered.set(turn.threadId, [...replay.matched, record]);
    if (delivered.size > MAX_DELIVERED_THREADS) delivered.delete(delivered.keys().next().value!);
    const system = halves.stable ?? turn.system;
    return [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      ...transcript.map((message, index) => ({
        role: message.role,
        content: replay.content.get(index) ?? message.text,
      })),
      { role: "user", content },
    ];
  };

  const sendTurn = async (turn: SendTurnInput) => {
    const apiKey = resolveKey(turn);
    if (!apiKey && !options.allowNoKey) throw new Error(options.missingKeyError);
    if (turn.warmOnly === true) {
      if (!turn.warmSignal?.aborted) {
        if (await pingModels(turn)) rememberWarm(turn.threadId);
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
        // ask_user, added below, keeps its place within the limit.
        const toolLimit = (options.toolLimit ?? providerToolLimit(options.driverKind)) - (questionAllowed ? 1 : 0);
        tools = await mountChatTools(options.tools === false ? undefined : turn.integrations, abort.signal, options.computerUse, scope, turn.mcpCallTimeoutMs, toolLimit);
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
              if (visible) emit({ ...base(turn.threadId, turnId), type: "content.delta", streamKind, delta: visible });
            };
            try {
              completion = await complete(messages, model, true, abort.signal, (text, streamKind) => {
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
        try { await tools?.close(); }
        catch {
          ok = false;
          stopReason = "error";
          cleanupFailed = true;
          failure = "Tool processes could not be stopped; their execution state is uncertain.";
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
  };

  return {
    instanceId: input.instanceId,
    driverKind: options.driverKind,
    displayName: input.displayName,
    enabled: input.enabled,
    get models() {
      return options.models();
    },
    ...(options.refreshModels ? { refreshModels: options.refreshModels } : {}),
    snapshot: async () => {
      const apiKey = resolveKey();
      if (!apiKey && !options.allowNoKey) return { state: "unavailable", reason: options.unavailableReason };
      if (keyRejected(options.apiUrl, apiKey)) return { state: "available", authenticated: false, reason: KEY_REJECTED_REASON, version: null };
      return { state: "available", authenticated: true, version: null, ...(options.billing ? { billing: options.billing } : {}) };
    },
    adapter: {
      provider: options.driverKind,
      capabilities: { ...(options.computerUse ? { computerMcp: options.tools !== false,
        localComputerMcp: options.tools !== false,
        browserMcp: options.tools !== false, nativeImageInput: true, images: true } : {}),
        // Its tool loop only reaches MCP servers; nothing runs on this machine.
        withholdsHostTools: true,
        sessionModelSwitch: "in-session", customMcp: options.tools !== false, agentsMcp: options.tools !== false,
        dataMcp: options.tools !== false,
        // The runtime owns the whole tool loop, so it can always take a
        // user message mid-turn: park it, deliver before the next completion.
        queueing: true,
        // No shell and no file tool on the host at all: only MCP tools, each
        // call a card in Ask unless "Always allow this session" covers it,
        // and the harness's own agents tools none, as on Claude and Codex
        // (the Boat's `exec` runs on the Boat). A guest's turn is as confined
        // as it gets.
        guestTurns: "confined",
        // GET /models on warmOnly, then ping while the call thread is warm so
        // the next spoken turn reuses the HTTP pool (no billed completion).
        ...(options.warmSession ? { warmSession: true } : {}),
        ...(options.effortLevels ? { effortLevels: options.effortLevels } : {}) },
      sendTurn,
      // #1373: this engine keeps no copy of Ask, Edits or Auto (only Full
      // is read at launch). Every other call asks Sagax, which answers at
      // the live level, so a change applies to the next tool call as is.
      applyApprovalMode: async () => true,
      interruptTurn: async (threadId, turnId) => {
        const turn = active.get(threadId);
        if (!turn || (turnId && turn.turnId !== turnId)) return;
        turn.abort.abort();
        // Free the slot before turn.done: a hanging grok stream must not
        // block the next duplex send (real20 t9/t18 paid the leftover TTFB).
        if (active.get(threadId) === turn) active.delete(threadId);
        await Promise.race([
          turn.done,
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, DUPLEX_INTERRUPT_WAIT_MS);
            timer.unref?.();
          }),
        ]);
      },
      respondToRequest: async (threadId, requestId, decision) =>
        active.get(threadId)?.approval.answer(requestId, decision.behavior, decision.message, decision.always) ?? "unavailable",
      steer: async (threadId, text, steerOptions) => {
        // This engine has no external session to respect — parking the
        // words in the live turn's entry IS delivery into the loop, so a
        // successful park is "steered"; a missing or ending turn is
        // refused, so the harness sends the words as the next turn. The
        // words ride the array at the next round boundary, and a final
        // answer that streamed meanwhile gets one more round to read them.
        const running = active.get(threadId);
        if (!running || running.ending) return "refused";
        running.asides.push({ text, ...(steerOptions?.steerId ? { steerId: steerOptions.steerId } : {}) });
        return "steered";
      },
      hasSession: (threadId) => active.has(threadId),
      releaseWarmSession: (threadId) => releaseWarm(threadId),
      stopAll: async () => {
        const turns = [...active.values()];
        for (const turn of turns) turn.abort.abort();
        await Promise.all(turns.map((turn) => turn.done));
      },
      onEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    generateText: async (prompt, { signal, onUsage, model: requested, system, onDelta, maxTokens } = {}) => {
      let model = requested ?? options.generateModel?.() ?? options.models().default;
      const tried = new Set<string>([model]);
      if (options.modelFallback && unsupportedModels.has(model)) model = nextModel(tried) ?? model;
      const messages: OpenAIChatMessage[] = [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user", content: prompt },
      ];
      const stream = typeof onDelta === "function";
      let streamed = false;
      let reply: Completion;
      for (;;) {
        tried.add(model);
        try {
          reply = await complete(
            messages, model, stream, signal,
            onDelta ? (delta, kind) => { if (kind === "assistant_text") { streamed = true; onDelta(delta); } } : undefined,
            [], onUsage, maxTokens, resolveKey(),
          );
          break;
        } catch (error) {
          // A helper on a refused model goes on with the next one, as a turn does.
          if (!(error instanceof ModelUnsupportedError) || streamed || signal?.aborted) throw error;
          refuseModel(model);
          const next = tried.size <= MAX_MODEL_SWITCHES ? nextModel(tried) : undefined;
          if (!next) throw new ChatProtocolError(noModelLeftMessage(model));
          model = next;
        }
      }
      const { text, reasoning, toolCalls } = reply;
      if (toolCalls.length) throw new ChatProtocolError("provider returned tool calls to a text-only helper");
      return text.trim() ? text : reasoning;
    },
    ...(options.permissionReview ? {
      reviewPermission: async (prompt: string, signal?: AbortSignal) => {
        const model = options.generateModel?.() ?? options.models().default;
        const { text, reasoning, toolCalls } = await complete(
          [{ role: "user", content: prompt }], model, false, signal,
          undefined, [], undefined, 400, resolveKey(),
        );
        if (toolCalls.length) throw new ChatProtocolError("permission review returned a tool call");
        const answer = (text.trim() ? text : reasoning).trim();
        if (!answer) throw new ChatProtocolError("permission review returned no text");
        return answer;
      },
    } : {}),
    dispose: async () => {
      const turns = [...active.values()];
      for (const turn of turns) turn.abort.abort();
      await Promise.all(turns.map((turn) => turn.done));
      listeners.clear();
      warmThreads.clear();
      stopWarmPing();
    },
  };
}
