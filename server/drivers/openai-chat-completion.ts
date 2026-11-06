const toolCallRefusal = (error: unknown) => {
  const body = object(error);
  return body?.code === "tool_use_failed" ? body : undefined;
};
import type { OpenAIChatMessage } from "./openai-chat-message.ts";
import type { TextGenerationOptions } from "../contracts.ts";
import { type ChatToolDefinition } from "./chat-mcp-tools.ts";
import { ChatProtocolError, ChatReasoningDetails, ChatToolCalls, object } from "./openai-chat-protocol.ts";
import { refusesRequestSize, RequestTooLargeError } from "./chat-size-limit.ts";
import { noteKeyAccepted, noteKeyRejected, rejectsKey } from "../key-rejections.ts";
import type { EffortLevel } from "../../shared/model-selection.ts";
import { refusedResponsesOption, refusesModel, refusesResponsesEndpoint, responsesEffort, responsesInput, ResponsesReader, responsesTools } from "./openai-responses.ts";
import type { Completion, CompletionJson, RuntimeOptions, Usage } from "./openai-chat-types.ts";
import { ChatSpecialTokenStream, stripChatSpecialTokens } from "../../shared/chat-special-tokens.ts";

/** Optional per-step TTFT markers (SAGAX_TURN_TRACE=1). No secrets. */
function httpTrace(step: string): void {
  if (process.env.SAGAX_TURN_TRACE !== "1") return;
  console.error(`[turn-trace] http-driver ${step} ${Date.now()}`);
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

const usageFrom = (usage: CompletionJson["usage"]): Usage | null =>
  usage
    ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 }
    : null;

const completionUsage = (json: CompletionJson) => json.usage ?? json.x_groq?.usage;

export class UnsupportedChatToolsError extends Error {}

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

export class UnsupportedReasoningReplayError extends Error {}

/** Reasoning text from `reasoning_content` (DeepSeek style) or `reasoning`
 * (vLLM, #2054): the first non-empty string, so an empty or null field
 * beside the other never hides it. */
function reasoningText(primary: unknown, secondary: unknown): string | undefined {
  if (typeof primary === "string" && primary) return primary;
  if (typeof secondary === "string" && secondary) return secondary;
  return typeof primary === "string" ? primary : typeof secondary === "string" ? secondary : undefined;
}

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
export class RejectedToolCallError extends ChatProtocolError {
  readonly refusal: Record<string, unknown>;
  constructor(message: string, refusal: Record<string, unknown>) {
    super(message);
    this.refusal = refusal;
  }
}

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
export function createChatCompletions<Config>(options: RuntimeOptions<Config>, auth: (apiKey: string) => Record<string, string>) {
  const responsesRefused = { include: new Set<string>(), reasoning: new Set<string>(), endpoint: new Set<string>() };
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
      httpTrace("endpoint-/responses");
      httpTrace("request-sent");
      const response = await fetch(`${options.apiUrl}/responses`, {
        method: "POST",
        ...(messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "image_url")) ? { redirect: "error" as const } : {}),
        headers: { ...auth(apiKey), "content-type": "application/json" },
        body: payload,
        signal: activeSignal,
      });
      httpTrace(`response-headers-${response.status}`);
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
        let firstSse = false;
        const consume = (line: string) => {
          if (!line.startsWith("data:")) return;
          if (!firstSse) { firstSse = true; httpTrace("first-sse-line"); }
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
  /** A reply without the chat-template tokens a local server can leak as
   * text (`<|eos|>`, `<|im_end|>`...), streamed and whole. */
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
    const streams = { assistant_text: new ChatSpecialTokenStream(), reasoning_text: new ChatSpecialTokenStream() };
    const forward = onDelta && ((delta: string, kind: "assistant_text" | "reasoning_text") => {
      const shown = streams[kind].feed(delta);
      if (shown) onDelta(shown, kind);
    });
    const completion = await completeRaw(messages, model, stream, signal, forward, tools, onUsage, maxTokens, apiKey, effort);
    if (onDelta) for (const kind of ["reasoning_text", "assistant_text"] as const) {
      const shown = streams[kind].finish();
      if (shown) onDelta(shown, kind);
    }
    return { ...completion, text: stripChatSpecialTokens(completion.text), reasoning: stripChatSpecialTokens(completion.reasoning) };
  };

  const completeRaw = async (
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
      httpTrace("try-/responses");
      for (let resend = 0; ; resend++) {
        try {
          return await completeResponses(messages, model, stream, signal, onDelta, tools, onUsage, maxTokens, apiKey, effort);
        } catch (error) {
          if (error instanceof ResponsesOptionError && resend < 2) {
            responsesRefused[error.option].add(model);
            httpTrace(`responses-option-retry-${error.option}`);
            continue;
          }
          if (error instanceof ResponsesEndpointError) {
            responsesRefused.endpoint.add(model);
            httpTrace("responses-refused-fallback");
            break;
          }
          throw error;
        }
      }
    } else if (options.responsesApi?.(model) && responsesRefused.endpoint.has(model)) {
      httpTrace("skip-/responses-cached");
    } else {
      httpTrace("endpoint-/chat/completions");
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
      httpTrace("chat-request-sent");
      const response = options.chatRequest ? await options.chatRequest(payload, apiKey, activeSignal) : await fetch(`${options.apiUrl}/chat/completions`, {
        method: "POST",
        ...(messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "image_url")) ? { redirect: "error" as const } : {}),
        headers: { ...auth(apiKey), "content-type": "application/json" },
        body: payload,
        signal: activeSignal,
      });
      httpTrace(`chat-response-headers-${response.status}`);
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
        const reasoning = reasoningText(message.reasoning_content, message.reasoning);
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
      let firstSse = false;
      let firstContent = false;
      const calls = new ChatToolCalls();
      const details = new ChatReasoningDetails();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const consumeDataLine = (line: string, atEof = false): boolean => {
        if (!line.startsWith("data:")) return false;
        if (!firstSse) { firstSse = true; httpTrace("first-sse-line"); }
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
        const reasoningPart = reasoningText(delta?.reasoning_content, delta?.reasoning);
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
          if (!firstContent) { firstContent = true; httpTrace("first-content-delta"); }
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

  return { complete };
}
