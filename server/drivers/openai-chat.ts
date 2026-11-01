import { createHash } from "node:crypto";
import type {
  DriverCreateInput,
  ModelCatalog,
  ProviderInstance,
  RuntimeEvent,
  RuntimeEventListener,
  SendTurnInput,
  TextGenerationOptions,
} from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { ASK_USER_TOOL, ASK_USER_TOOL_DEFINITION, askQuestionSummary, parseAskQuestions, questionChoices } from "../../shared/ask-question.ts";
import { allowsTool, parseToolScope } from "../../shared/tool-scope.ts";
import { redactSecretsInText } from "../redact.ts";
import { cwToolResult, toolDetailPreview } from "../tool-summary.ts";
import { isPhoneToolCallName, PHONE_TOOL_OUTPUT_NOT_KEPT } from "../../shared/phone-tools.ts";
import { ChatToolSessionError, mountChatTools, providerToolLimit, type ChatToolDefinition, type ChatToolSession, type ChatToolResult } from "./chat-mcp-tools.ts";
import { assertImageTransport, chatImageBudget, chatToolImages, chatUserContent, type ChatContentPart } from "./chat-images.ts";
import { promptHalves, sectionDelta, sectionFingerprints, volatileContextNote, volatileSectionsUpdate, withContextNote } from "./prompt-split.ts";
import { createChatToolApproval } from "./chat-tool-approval.ts";
import { ChatProtocolError, ChatReasoningDetails, ChatToolCalls, object, type ChatToolCall } from "./openai-chat-protocol.ts";
import { appendNative } from "./native.ts";
import { classifyError, computeBackoff, interruptibleDelay, RETRY_MAX_ATTEMPTS } from "./retry.ts";
import { outOfCreditsMessage } from "./engine-errors.ts";
import { refusesRequestSize, RequestTooLargeError, sizeChange, smallerResend } from "./chat-size-limit.ts";
import { requestTooLargeMessage } from "../../shared/request-too-large.ts";
import { providerReplyCutMessage, providerReplyCutReason } from "../../shared/provider-reply-cut.ts";
import { classifyContinuable, writeTurnHandoff } from "../turn-continuation.ts";
import { DUPLEX_INTERRUPT_WAIT_MS } from "../voice-call-duplex.ts";
import { KEY_REJECTED_REASON, keyRejected, noteKeyAccepted, noteKeyRejected, rejectsKey } from "../key-rejections.ts";
import type { EffortLevel } from "../../shared/model-selection.ts";
import { refusedResponsesOption, refusesModel, refusesResponsesEndpoint, responsesEffort, responsesInput, ResponsesReader, responsesTools } from "./openai-responses.ts";

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatContentPart[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
  reasoning?: string;
  reasoning_details?: Record<string, unknown>[];
}

interface Usage {
  input: number;
  output: number;
}

interface Completion {
  text: string;
  reasoning: string;
  usage: Usage | null;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
  protocolReasoning: string;
  protocolReasoningDetails: Record<string, unknown>[];
}

interface CompletionJson {
  model?: string;
  choices?: Array<{
    index?: number;
    message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; reasoning_details?: unknown; tool_calls?: unknown; function_call?: unknown };
    delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; reasoning_details?: unknown; tool_calls?: unknown; function_call?: unknown };
    finish_reason?: string | null;
  }>;
  error?: unknown;
  base_resp?: { status_code?: unknown; status_msg?: unknown };
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; cost?: number };
  /** Groq reports streaming usage in its final x_groq envelope. */
  x_groq?: { usage?: CompletionJson["usage"] };
}

/** The message of a JSON error body a provider returned with HTTP 200.
 *  MiniMax reports auth, balance, and parameter failures as `base_resp`. */
function providerError(json: CompletionJson): string | null {
  if (typeof json.error === "string") return json.error;
  const error = object(json.error);
  if (error) return typeof error.message === "string" ? error.message : "unknown error";
  const code = json.base_resp?.status_code;
  if (typeof code === "number" && code !== 0) {
    const msg = typeof json.base_resp?.status_msg === "string" ? json.base_resp.status_msg : "";
    return `upstream error ${code}${msg ? `: ${msg}` : ""}`;
  }
  return null;
}

/** An error envelope's machine code ("invalid_api_key"), never a sentence. */
const MACHINE_CODE = /^[a-z][a-z0-9_]*$/;

/** What a failed HTTP response says, for the person: a JSON error envelope's
 *  own message ("Your team has used all available credits…") instead of the
 *  envelope, or the raw body when it carries none. The envelope's machine
 *  code follows the message, after the cut, so a caller can still read it. */
function httpErrorDetail(body: string, limit = 500): string {
  let json: CompletionJson | undefined;
  try { json = object(JSON.parse(body)); } catch { json = undefined; }
  const message = json ? providerError(json) : null;
  if (!message || message === "unknown error") return body.slice(0, limit);
  const code = object(json?.error)?.code;
  const suffix = typeof code === "string" && MACHINE_CODE.test(code) ? ` (${code})` : "";
  return message.slice(0, limit) + suffix;
}

interface NativeLog {
  source: string;
  outgoing(turn: SendTurnInput, messages: OpenAIChatMessage[], model: string, tools: ChatToolDefinition[]): unknown;
  incoming(completion: Completion): unknown;
}

interface RuntimeOptions<Config> {
  input: DriverCreateInput<Config>;
  driverKind: string;
  /** A string is the key captured for this instance. A function is read at
   * the start of each turn, so a key saved after launch is the one that
   * pays for that turn. */
  apiKey: string | ((turn?: SendTurnInput) => string);
  apiUrl: string;
  allowNoKey?: boolean;
  /** Another wire protocol can reuse the same tool loop and transcript. */
  chatRequest?(payload: string, key: string, signal: AbortSignal): Promise<Response>;
  /** How the key is sent; default `Authorization: Bearer`. Azure takes
   * `api-key` on every route (shared/azure-openai.ts). */
  authHeaders?: (apiKey: string) => Record<string, string>;
  models: () => ModelCatalog;
  requestBody(model: string, messages: OpenAIChatMessage[], stream: boolean): Record<string, unknown>;
  httpErrorLabel: string;
  missingKeyError: string;
  unavailableReason: string;
  timeoutMs: number;
  nativeLog: NativeLog;
  refreshModels?: () => Promise<void>;
  generateModel?: () => string;
  reasoning?: boolean;
  /** Field the provider reads replayed reasoning from; Cerebras rejects
   * `reasoning_content` and takes `reasoning`. */
  reasoningReplayField?: "reasoning_content" | "reasoning";
  contentText?: (content: unknown) => string;
  billing?: "metered";
  includeUsageInCompleted?: boolean;
  noBodyError?: string;
  retryScale?: number;
  /** Explicit text-only mode for endpoints/models that cannot accept tools. */
  tools?: boolean;
  /** Most tools the provider takes in one request, when it differs from
   * PROVIDER_TOOL_LIMITS (chat-mcp-tools.ts). */
  toolLimit?: number;
  /** Isolated permission review (lot A1b). Same completion as generateText,
   * with no tools, and never inferred from generateText itself. */
  permissionReview?: boolean;
  /** Opt-in structured images and harness-authorized computer/browser MCP. */
  computerUse?: boolean;
  /** Whether a model accepts image parts (default: every model does). A
   * text-only model keeps the computer and browser tools, whose snapshots
   * and page reads are text, but never receives a screenshot or attachment. */
  imageInput?: (model: string) => boolean;
  /** Smaller models sometimes announce a step ("Checking the page first —")
   * and end the turn without calling a tool. When set, such a reply gets one
   * nudge per turn to act; a question, or anything longer, ends the turn. */
  nudgeAnnouncedAction?: boolean;
  /** GET /models keep-alive for HTTP grok voice calls. Off for other
   * OpenAI-compatible hosts: they did not opt into that ping. */
  warmSession?: boolean;
  /** Models this endpoint serves on /responses (openai-responses.ts):
   * OpenAI's own API, whose newer models take tools with reasoning only
   * there. A model /responses refuses goes back to /chat/completions. */
  responsesApi?: (model: string) => boolean;
  /** Whether a model reasons (OpenAI's o-series and gpt-5 on): only such a
   * model is sent `reasoning.effort` and asked for its encrypted reasoning. */
  reasoningModel?: (model: string) => boolean;
  /** Effort levels the engine passes as `reasoning.effort`. */
  effortLevels?: readonly EffortLevel[];
  /** A model the provider refuses for this kind of request (not a chat
   * model, no tools with reasoning) leaves the catalog, and the same turn
   * goes on at once on another model of the catalog, without a word in the
   * chat (#1668's rule). Off: the turn fails in plain words. */
  modelFallback?: boolean;
  /** Told when a model is refused that way, so the catalog drops it. */
  onModelUnsupported?: (model: string) => void;
}

const usageFrom = (usage: CompletionJson["usage"]): Usage | null =>
  usage
    ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 }
    : null;

const completionUsage = (json: CompletionJson) => json.usage ?? json.x_groq?.usage;

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

class UnsupportedChatToolsError extends Error {}
/** The provider refused the request because of the model (openai-responses.ts
 * refusesModel). Nothing ran upstream. */
export class ModelUnsupportedError extends Error {}
/** /responses does not serve this model: the chat path may. */
class ResponsesEndpointError extends Error {}
/** A /responses request refused one optional part (refusedResponsesOption). */
class ResponsesOptionError extends Error {
  readonly option: "include" | "reasoning";
  constructor(message: string, option: "include" | "reasoning") {
    super(message);
    this.option = option;
  }
}

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

function rejectsToolsParameter(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  let envelope: Record<string, unknown> | undefined;
  try { envelope = object(JSON.parse(body)); } catch { return false; }
  const error = object(envelope?.error);
  if (error?.param === "tools" && error.code === "unsupported_parameter") return true;
  const message = error?.message ?? envelope?.error;
  return typeof message === "string" && (
    /\bdoes not support (?:tools|tool calling|function calling)(?:[.!]?$|[.!]?\s)/i.test(message) ||
    /\b(?:tools|tool calling|function calling) (?:is|are) not supported\b/i.test(message) ||
    /^(?:unsupported|unknown|unrecognized) (?:parameter|field):?\s*['"]?tools['"]?[.!]?$/i.test(message.trim())
  );
}

class UnsupportedReasoningReplayError extends Error {}

/** DeepSeek-style providers need `reasoning_content` echoed on a tool-call
 *  assistant message; strict endpoints such as Groq reject the property. */
function rejectsReasoningReplay(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  let envelope: Record<string, unknown> | undefined;
  try { envelope = object(JSON.parse(body)); } catch { return false; }
  const message = object(envelope?.error)?.message ?? envelope?.error;
  return typeof message === "string" && /\breasoning_content\b/.test(message) &&
    /\b(?:unsupported|not supported|unknown|unrecognized|unexpected|not permitted|not allowed)\b/i.test(message);
}

/** Groq checks each generated tool call against the request and fails the
 *  completion with `tool_use_failed` when the call is invalid: most often a
 *  tool it was not offered (gpt-oss inventing a "json" tool to answer in
 *  JSON), sometimes arguments that miss the schema. `refusal` is the
 *  provider's whole error object, `failed_generation` included. */
class RejectedToolCallError extends ChatProtocolError {
  readonly refusal: Record<string, unknown>;
  constructor(message: string, refusal: Record<string, unknown>) {
    super(message);
    this.refusal = refusal;
  }
}

const toolCallRefusal = (error: unknown) => {
  const body = object(error);
  return body?.code === "tool_use_failed" ? body : undefined;
};

function refusedToolCall(status: number, body: string) {
  if (status !== 400) return undefined;
  try { return toolCallRefusal(object(JSON.parse(body))?.error); } catch { return undefined; }
}

function completionError(json: CompletionJson, label: string): ChatProtocolError | null {
  const message = providerError(json);
  if (!message) return null;
  const text = `provider returned a ${label}: ${message.slice(0, 200)}`;
  const refusal = toolCallRefusal(json.error);
  return refusal ? new RejectedToolCallError(text, refusal) : new ChatProtocolError(text);
}

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
  const responsesRefused = { include: new Set<string>(), reasoning: new Set<string>(), endpoint: new Set<string>() };
  /** Models the provider refused for a conversation (ModelUnsupportedError). */
  const unsupportedModels = new Set<string>();

  const idleTimer = () => {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | null = null;
    return {
      signal: controller.signal,
      reset() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => controller.abort(new DOMException("Streaming idle timeout elapsed", "AbortError")), options.timeoutMs);
      },
      clear() { if (timer) clearTimeout(timer); },
    };
  };

  /** One reply through /responses, read into the chat runtime's shape. */
  const completeResponses = async (
    messages: OpenAIChatMessage[],
    model: string,
    stream: boolean,
    signal: AbortSignal | undefined,
    onDelta: ((delta: string, kind: "assistant_text" | "reasoning_text") => void) | undefined,
    tools: ChatToolDefinition[],
    onUsage: TextGenerationOptions["onUsage"] | undefined,
    maxTokens: number | undefined,
    apiKey: string,
    effort: EffortLevel | undefined,
  ): Promise<Completion> => {
    const idle = idleTimer();
    idle.reset();
    try {
      const activeSignal = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
      const reasons = options.reasoningModel?.(model) === true;
      const level = reasons && !responsesRefused.reasoning.has(model) ? responsesEffort(effort) : undefined;
      const payload = JSON.stringify({
        model,
        input: responsesInput(messages),
        ...(tools.length ? { tools: responsesTools(tools) } : {}),
        stream,
        store: false,
        ...(reasons && !responsesRefused.include.has(model) ? { include: ["reasoning.encrypted_content"] } : {}),
        ...(level ? { reasoning: { effort: level } } : {}),
        ...(typeof maxTokens === "number" ? { max_output_tokens: maxTokens } : {}),
      });
      const response = await fetch(`${options.apiUrl}/responses`, {
        method: "POST",
        ...(messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "image_url")) ? { redirect: "error" as const } : {}),
        headers: { ...auth(apiKey), "content-type": "application/json" },
        body: payload,
        signal: activeSignal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (rejectsKey(response.status, body)) noteKeyRejected(options.apiUrl, apiKey);
        const message = `${options.httpErrorLabel} HTTP ${response.status}${body ? `: ${httpErrorDetail(body)}` : ""}`;
        if (refusesRequestSize(response.status, body)) throw new RequestTooLargeError(message, Buffer.byteLength(payload));
        const option = refusedResponsesOption(response.status, body);
        if (option && ((option === "include" && reasons && !responsesRefused.include.has(model)) || (option === "reasoning" && level))) {
          throw new ResponsesOptionError(message, option);
        }
        if (refusesResponsesEndpoint(response.status, body)) throw new ResponsesEndpointError(message);
        if (rejectsToolsParameter(response.status, body)) throw new UnsupportedChatToolsError(message);
        if (refusesModel(response.status, body)) throw new ModelUnsupportedError(message);
        throw new Error(message);
      }
      noteKeyAccepted(options.apiUrl, apiKey);
      const reader = new ResponsesReader(onDelta);
      if (!stream || response.headers.get("content-type")?.includes("application/json")) {
        reader.json(await response.json());
      } else {
        if (!response.body) throw new Error(options.noBodyError ?? `${options.httpErrorLabel} returned no response body`);
        const stream = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const consume = (line: string) => {
          if (!line.startsWith("data:")) return;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") return;
          let event: unknown;
          try { event = JSON.parse(data); } catch { throw new ChatProtocolError("provider stream contained a malformed response event"); }
          reader.event(event);
        };
        try {
          for (;;) {
            const { done, value } = await stream.read();
            if (done) {
              buffer += decoder.decode();
              const tail = buffer.trim();
              if (tail) { try { consume(tail); } catch (error) { if (!reader.done) throw error; } }
              break;
            }
            idle.reset();
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 2_000_000) throw new ChatProtocolError("provider stream frame exceeded the size limit");
            let newline: number;
            while ((newline = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              consume(line);
            }
            if (reader.done) break;
          }
        } finally {
          await stream.cancel().catch(() => {});
        }
        activeSignal.throwIfAborted();
        if (!reader.done) throw new ChatProtocolError("Stream ended before completion");
      }
      activeSignal.throwIfAborted();
      const reply = reader.reply();
      if (onUsage) {
        onUsage({
          model: reply.model?.trim() ? reply.model : model,
          input: reply.usage?.input,
          output: reply.usage?.output,
          cachedInput: reply.usage?.cachedInput,
          costUsd: undefined,
        });
      }
      return {
        text: reply.text,
        reasoning: options.reasoning ? reply.reasoning : "",
        usage: reply.usage ? { input: reply.usage.input, output: reply.usage.output } : null,
        toolCalls: reply.toolCalls,
        finishReason: reply.finishReason,
        protocolReasoning: "",
        protocolReasoningDetails: reply.reasoningItems,
      };
    } finally {
      idle.clear();
    }
  };

  /** One reply: /responses for the models this endpoint serves there, with
   * one resend without a refused optional part, else /chat/completions. */
  const complete = async (
    messages: OpenAIChatMessage[],
    model: string,
    stream: boolean,
    signal?: AbortSignal,
    onDelta?: (delta: string, kind: "assistant_text" | "reasoning_text") => void,
    tools: ChatToolDefinition[] = [],
    onUsage?: TextGenerationOptions["onUsage"],
    maxTokens?: number,
    apiKey = "",
    effort?: EffortLevel,
  ): Promise<Completion> => {
    if (options.responsesApi?.(model) && !responsesRefused.endpoint.has(model)) {
      for (let resend = 0; ; resend++) {
        try {
          return await completeResponses(messages, model, stream, signal, onDelta, tools, onUsage, maxTokens, apiKey, effort);
        } catch (error) {
          if (error instanceof ResponsesOptionError && resend < 2) {
            responsesRefused[error.option].add(model);
            continue;
          }
          if (error instanceof ResponsesEndpointError) {
            responsesRefused.endpoint.add(model);
            break;
          }
          throw error;
        }
      }
    }
    return completeChat(messages, model, stream, signal, onDelta, tools, onUsage, maxTokens, apiKey);
  };

  const completeChat = async (
    messages: OpenAIChatMessage[],
    model: string,
    stream: boolean,
    signal?: AbortSignal,
    onDelta?: (delta: string, kind: "assistant_text" | "reasoning_text") => void,
    tools: ChatToolDefinition[] = [],
    onUsage?: TextGenerationOptions["onUsage"],
    maxTokens?: number,
    apiKey = "",
  ): Promise<Completion> => {
    // Idle timer that is renewed on every received chunk during streaming
    const timeoutController = new AbortController();
    let idleTimer: NodeJS.Timeout | null = null;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timeoutController.abort(new DOMException("Streaming idle timeout elapsed", "AbortError"));
      }, options.timeoutMs);
    };

    resetIdleTimer();

    try {
      const activeSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal;

      const payload = JSON.stringify({
        ...options.requestBody(model, messages, stream),
        ...(tools.length ? { tools } : {}),
        ...(typeof maxTokens === "number" ? { max_tokens: maxTokens } : {}),
      });
      const response = options.chatRequest ? await options.chatRequest(payload, apiKey, activeSignal) : await fetch(`${options.apiUrl}/chat/completions`, {
        method: "POST",
        ...(messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "image_url")) ? { redirect: "error" as const } : {}),
        headers: { ...auth(apiKey), "content-type": "application/json" },
        body: payload,
        signal: activeSignal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (rejectsKey(response.status, body)) noteKeyRejected(options.apiUrl, apiKey);
        const message = `${options.httpErrorLabel} HTTP ${response.status}${body ? `: ${httpErrorDetail(body)}` : ""}`;
        // The provider refused the request's size before running anything (chat-size-limit.ts).
        if (refusesRequestSize(response.status, body)) throw new RequestTooLargeError(message, Buffer.byteLength(payload));
        if (rejectsToolsParameter(response.status, body)) throw new UnsupportedChatToolsError(message);
        const refusal = refusedToolCall(response.status, body);
        if (refusal) throw new RejectedToolCallError(message, refusal);
        if (messages.some((entry) => entry.reasoning_content !== undefined) && rejectsReasoningReplay(response.status, body)) {
          throw new UnsupportedReasoningReplayError(message);
        }
        if (refusesModel(response.status, body)) throw new ModelUnsupportedError(message);
        throw new Error(message);
      }
      noteKeyAccepted(options.apiUrl, apiKey);

      if (!stream || response.headers.get("content-type")?.includes("application/json")) {
        const json = await response.json() as CompletionJson;
        const tokenUsage = completionUsage(json);
        if (onUsage) {
          activeSignal.throwIfAborted();
          const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
          onUsage({
            model: typeof json.model === "string" && json.model.trim() ? json.model : model,
            input: count(tokenUsage?.prompt_tokens),
            output: count(tokenUsage?.completion_tokens),
            cachedInput: count(tokenUsage?.prompt_tokens_details?.cached_tokens),
            costUsd: count(tokenUsage?.cost),
          });
        }
        const bodyError = completionError(json, "completion error");
        if (bodyError) throw bodyError;
        const message = json.choices?.[0]?.message;
        if (!message || !object(message) || !["content", "reasoning_content", "reasoning", "reasoning_details", "tool_calls", "function_call"].some((key) => key in message)) {
          throw new ChatProtocolError("provider returned no completion message");
        }
        if (message?.function_call) throw new ChatProtocolError("legacy function_call is unsupported; use structured tool_calls");
        const calls = new ChatToolCalls();
        calls.add(message?.tool_calls, false);
        const details = new ChatReasoningDetails();
        details.add(message.reasoning_details);
        const reasoning = message.reasoning_content ?? message.reasoning;
        const finishReason = json.choices?.[0]?.finish_reason ?? null;
        activeSignal.throwIfAborted();
        return {
          text: options.contentText ? options.contentText(message?.content) : typeof message?.content === "string" ? message.content : "",
          reasoning: options.reasoning && typeof reasoning === "string"
            ? reasoning
            : "",
          usage: usageFrom(tokenUsage),
          toolCalls: calls.finish(finishReason, false),
          finishReason,
          protocolReasoning: typeof reasoning === "string" ? reasoning : "",
          protocolReasoningDetails: details.blocks,
        };
      }

      if (!response.body) {
        throw new Error(options.noBodyError ?? `${options.httpErrorLabel} returned no response body`);
      }
      let text = "";
      let reasoning = "";
      let protocolReasoning = "";
      let usage: Usage | null = null;
      let finishReason: string | null = null;
      let malformedFrame = false;
      let sawChoice = false;
      const calls = new ChatToolCalls();
      const details = new ChatReasoningDetails();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const consumeDataLine = (line: string, atEof = false): boolean => {
        if (!line.startsWith("data:")) return false;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return true;
        let chunk: CompletionJson;
        try {
          chunk = JSON.parse(data) as CompletionJson;
        } catch {
          // A tail left in the buffer when the socket closed is an INCOMPLETE
          // frame, not a bad one: a stop, an abort or a dropped connection all
          // end mid-frame. Only a properly newline-terminated frame that will
          // not parse means the provider actually sent something malformed.
          // Counting the tail here turned a stopped turn into a hard,
          // non-retryable failure (`calls.finish(finishReason, malformedFrame)`).
          if (!atEof) malformedFrame = true;
          return false;
        }
        const chunkError = completionError(chunk, "streaming completion error");
        if (chunkError) throw chunkError;
        const choice = chunk.choices?.find((row) => row.index === undefined || row.index === 0);
        const delta = choice?.delta;
        if (object(delta)) sawChoice = true;
        if (delta?.function_call) throw new ChatProtocolError("legacy function_call is unsupported; use structured tool_calls");
        calls.add(delta?.tool_calls, true);
        details.add(delta?.reasoning_details);
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const reasoningPart = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof reasoningPart === "string") protocolReasoning += reasoningPart;
        const reasoningDelta = options.reasoning && typeof reasoningPart === "string"
          ? reasoningPart
          : "";
        const contentDelta = options.contentText ? options.contentText(delta?.content) : typeof delta?.content === "string" ? delta.content : "";
        if (reasoningDelta) {
          reasoning += reasoningDelta;
          onDelta?.(reasoningDelta, "reasoning_text");
        }
        if (contentDelta) {
          text += contentDelta;
          onDelta?.(contentDelta, "assistant_text");
        }
        const tokenUsage = completionUsage(chunk);
        if (tokenUsage) usage = usageFrom(tokenUsage);
        return false;
      };
      try {
        readLoop: for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            const line = buffer.trim();
            if (line && line !== "data: [DONE]") consumeDataLine(line, true);
            // MiniMax's api.minimax.io/v1 closes the connection after the
            // finish_reason chunk and never sends `[DONE]`.
            if (buffer.trim() === "data: [DONE]" || finishReason) break;
            if (!sawChoice) {
              let body: CompletionJson | undefined;
              try { body = JSON.parse(buffer) as CompletionJson; } catch { body = undefined; }
              const bodyError = body ? completionError(body, "completion error") : null;
              if (bodyError) throw bodyError;
            }
            throw new ChatProtocolError("Stream ended before completion");
          }
          resetIdleTimer();
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 2_000_000) throw new ChatProtocolError("provider stream frame exceeded the size limit");
          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (consumeDataLine(line)) break readLoop;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      activeSignal.throwIfAborted();
      if (!sawChoice) throw new ChatProtocolError("provider returned no streaming completion choice");
      return { text, reasoning, usage, toolCalls: calls.finish(finishReason, malformedFrame), finishReason, protocolReasoning, protocolReasoningDetails: details.blocks };
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  };

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
              // A failed or denied tool op ends the turn: the final answer is
              // not an execution receipt, and a person's "no" must never be
              // answered with a prompt to run the same thing again.
              // The stop is recorded on the turn (stopReason) and the tool rows
              // carry the detail; no banner is added to the chat for it.
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
                // delegated Full access cannot help either.
                const allowed = turn.approvalMode === "full" || !shown.ask
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
            const output = isPhoneToolCallName(call.function.name) ? PHONE_TOOL_OUTPUT_NOT_KEPT : preview({ ok: result.ok, result: text });
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
