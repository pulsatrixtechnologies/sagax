import type { OpenAIChatMessage } from "./openai-chat-message.ts";
import type { DriverCreateInput, ModelCatalog, SendTurnInput } from "../contracts.ts";
import { type ChatToolDefinition } from "./chat-mcp-tools.ts";
import { type ChatToolCall } from "./openai-chat-protocol.ts";
import type { EffortLevel } from "../../shared/model-selection.ts";

export interface Usage {
  input: number;
  output: number;
}

export interface Completion {
  text: string;
  reasoning: string;
  usage: Usage | null;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
  protocolReasoning: string;
  protocolReasoningDetails: Record<string, unknown>[];
}

export interface CompletionJson {
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

export interface NativeLog {
  source: string;
  outgoing(turn: SendTurnInput, messages: OpenAIChatMessage[], model: string, tools: ChatToolDefinition[]): unknown;
  incoming(completion: Completion): unknown;
}

export interface RuntimeOptions<Config> {
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
