import { decodeInjectId } from "../local-inject.ts";
import { readAtRest } from "../../content-at-rest.ts";
import type { ModelVariantOption, TurnImageInput } from "../../contracts.ts";

/** A tool call without a status is pending (ACP's default); a `tool_call_update` without
 * one leaves the call as it was. */
export function trackRunningTool(
  current: { runningTools: Set<string> },
  update: { toolCallId?: unknown; status?: unknown },
  defaultStatus?: "pending",
): void {
  if (typeof update.toolCallId !== "string" || !update.toolCallId) return;
  const status = update.status ?? defaultStatus;
  if (status === "completed" || status === "failed") current.runningTools.delete(update.toolCallId);
  else if (status === "pending" || status === "in_progress") current.runningTools.add(update.toolCallId);
}

let unkeyedToolSeq = 0;

/** Stamp an unkeyed `tool_call` with a synthetic id and queue it for the
 * call's first terminal update, which carries no id of its own to match.
 * FIFO is the best available pairing when the agent omits `toolCallId`:
 * the ids exist to pair start with completion, not to order concurrent
 * unkeyed calls, and the synthetic id deliberately stays out of
 * `runningTools` so turn-settle semantics are unchanged. */
export function nextUnkeyedToolId(current: { unkeyedToolIds: string[] }): string {
  const id = `acp-tool-unkeyed-${++unkeyedToolSeq}`;
  current.unkeyedToolIds.push(id);
  return id;
}

/** Test-only: reset the synthetic unkeyed tool id counter. */
export function resetUnkeyedToolSeqForTests(): void {
  unkeyedToolSeq = 0;
}

/** Advance the module-level unkeyed tool sequence (session stream path). */
export function allocUnkeyedToolSeq(): number {
  return ++unkeyedToolSeq;
}

export function acpVariantOption(result: any): { configId: string; options: ModelVariantOption[]; currentValue?: string } | undefined {
  const option = (Array.isArray(result?.configOptions) ? result.configOptions : []).find(
    (entry: any) => entry?.type === "select" && typeof entry.id === "string"
      && (entry.id === "effort" || entry.category === "thought_level"),
  );
  if (!option) return;
  const options: ModelVariantOption[] = [];
  const seen = new Set<string>();
  const collect = (entries: unknown) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (typeof entry?.value === "string" && !seen.has(entry.value)) {
        seen.add(entry.value);
        options.push({ id: entry.value, label: typeof entry.name === "string" ? entry.name : entry.value });
      } else if (Array.isArray(entry?.options)) collect(entry.options);
    }
  };
  collect(option.options);
  return {
    configId: option.id,
    options,
    ...(typeof option.currentValue === "string" ? { currentValue: option.currentValue } : {}),
  };
}

const TOOL_LOG_TEXT_LIMIT = 64_000;

/** Every model id a session config snapshot offers under `configId`,
 * flattening grouped options. Empty when the agent listed none. */
export function offeredModels(result: any, configId: string): string[] {
  const option = (Array.isArray(result?.configOptions) ? result.configOptions : []).find(
    (entry: any) => entry?.id === configId,
  );
  const ids: string[] = [];
  const visit = (entries: unknown) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (typeof entry?.value === "string") ids.push(entry.value);
      else if (Array.isArray(entry?.options)) visit(entry.options);
    }
  };
  visit(option?.options);
  return ids;
}

export async function readAcpImageBlocks(images: readonly TurnImageInput[]) {
  return Promise.all(images.map(async (image) => ({
    type: "image" as const,
    data: (await readAtRest(image.path)).toString("base64"),
    mimeType: image.mime,
  })));
}

function sanitizeToolLogValue(value: unknown, budget: { nodes: number; text: number }, depth = 0): unknown {
  if (depth > 12 || budget.nodes-- <= 0) return undefined;
  if (typeof value === "string") {
    if (/^data:image\//iu.test(value) || budget.text <= 0) return undefined;
    const limit = Math.min(TOOL_LOG_TEXT_LIMIT, budget.text);
    const text = value.length <= limit ? value : `[Earlier output truncated]\n\n${value.slice(-limit)}`;
    budget.text -= text.length;
    return text;
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const sanitized = sanitizeToolLogValue(entry, budget, depth + 1);
      return sanitized === undefined ? [] : [sanitized];
    });
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).flatMap(([key, entry]) => {
    if ((record.type === "image" && (key === "data" || key === "blob")) ||
      (key === "blob" && typeof record.mimeType === "string" && record.mimeType.startsWith("image/"))) return [];
    const sanitized = sanitizeToolLogValue(entry, budget, depth + 1);
    return sanitized === undefined ? [] : [[key, sanitized]];
  }));
}

export function sanitizeAcpToolMessage(message: any): unknown {
  const isToolUpdate = message?.method === "session/update"
    && ["tool_call", "tool_call_update"].includes(message?.params?.update?.sessionUpdate);
  const isPermission = message?.method === "session/request_permission";
  if (!isToolUpdate && !isPermission) return message;
  return sanitizeToolLogValue(message, { nodes: 512, text: TOOL_LOG_TEXT_LIMIT });
}

/** What "the same operation" means for a remembered session allow: the
 * tool call's shape with keys sorted, so two identical requests key alike
 * however the agent ordered its JSON. null when nothing identifies it. */
export function sessionOperationKey(toolCall: any): string | null {
  const rawInput = toolCall?.rawInput;
  const command = typeof rawInput?.command === "string" ? rawInput.command : undefined;
  const hasInput = rawInput && typeof rawInput === "object" && Object.keys(rawInput).length > 0;
  if (!command && !hasInput) return null;
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]))
        : value;
  return JSON.stringify(stable({
    kind: toolCall?.kind,
    title: toolCall?.title,
    command,
    input: rawInput,
    locations: toolCall?.locations,
  }));
}

/** Grok/xAI (and any ACP engine that mirrors it) reporting that the model
 * spent the turn on reasoning and committed no content or tool call: a
 * JSON-RPC -32603 whose text carries the `reasoning_only` finish reason
 * ("empty response from model (reasoning_only)"). Specific on purpose, so a
 * genuine internal error still surfaces untouched. */
export function isReasoningOnlyEmpty(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; data?: any };
  if (value.code !== -32603) return false;
  const text = [value.message, value.data?.details, value.data?.message, value.data?.error?.message]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  return /\breasoning_only\b/i.test(text);
}

/** How many times a reasoning-only empty response is nudged before the turn
 * ends gracefully. One by default; SAGAX_ACP_REASONING_CONTINUE_MAX overrides
 * it (0 turns the continuation nudge off). A reasoning_only failure still
 * settles soft with stopReason reasoning_only either way: never the raw
 * Internal error (session/prompt). */
export function reasoningContinueMax(): number {
  const raw = Number(process.env.SAGAX_ACP_REASONING_CONTINUE_MAX);
  return Number.isInteger(raw) && raw >= 0 ? raw : 1;
}

import type { ProviderErrorCode } from "../../contracts.ts";
import type { AccountErrorCode } from "./types.ts";
import { redactSecretsInText } from "../../redact.ts";

const ACCOUNT_ERROR_CODES: ReadonlySet<ProviderErrorCode> = new Set<AccountErrorCode>([
  "invalid_credentials", "inactive_subscription", "insufficient_funds", "quota_or_region_restriction", "model_access_disabled",
]);
export const isAccountError = (code: ProviderErrorCode | undefined): code is AccountErrorCode =>
  code !== undefined && ACCOUNT_ERROR_CODES.has(code);

/** ACP vendors put the actionable cause in error.data while keeping the
 * JSON-RPC message generic. Only surface known text fields, never a response
 * body/config dump, and redact before bounding the displayed diagnostic. */
export function acpRpcError(value: any, method: string): Error {
  const message = typeof value?.message === "string" ? value.message : "ACP request failed";
  const data = value?.data;
  const detail = typeof data === "string" ? data
    : typeof data?.details === "string" ? data.details
    : typeof data?.message === "string" ? data.message
    : typeof data?.error?.message === "string" ? data.error.message
    : "";
  const context = [
    method,
    typeof data?.service === "string" ? `service: ${data.service}` : "",
    typeof data?.errorName === "string" ? data.errorName : "",
  ].filter(Boolean).join(", ");
  const diagnostic = `${detail && detail !== message ? `${message}: ${detail}` : message} (${context})`;
  const error = new Error(redactSecretsInText(diagnostic).slice(0, 1500));
  return Object.assign(error, { code: value?.code, data,
    // -32603 is JSON-RPC's internal error. Invalid params, unsupported
    // methods and auth refusals are user/configuration issues, not evidence
    // of a broken process. Preserve their session instead of retrying them.
    acpSessionFailure: value?.code === -32603,
  });
}

/** A continuation nudge sent after a reasoning-only empty response: the live
 * session kept its reasoning but committed no content, so ask it to finish. */
export const REASONING_CONTINUE_NUDGE =
  "You returned your reasoning but no answer. Give your final answer now, or make your next tool call.";

export const REASONING_ONLY_SOFT_MESSAGE =
  "kept returning its reasoning without a final answer. Nothing was changed. Send the message again, or lower this bot's reasoning effort.";



/** A `host::model` pick talks to a loopback server with its own key.
 * Subscription ACP login (grok.com cached_token) must not fail that turn. */
export function skipSubscriptionAuthForLocalInject(model: string | undefined): boolean {
  return Boolean(decodeInjectId(model));
}

/** A catalog can contain credential-bearing native configuration, including late replies. */
export function acpNativeIncomingLogMessage(message: any, privateResponses: ReadonlySet<number>): unknown {
  if (!privateResponses.has(message?.id)) return message;
  return { jsonrpc: message.jsonrpc, id: message.id, ...(message.error !== undefined ? { error: "[MCP catalog error omitted]" } : { result: "[MCP catalog omitted]" }) };
}

/** The banner an ACP CLI prints for `--version`. Hermes writes its whole banner
 *  to stderr with an empty stdout, so an stdout-only read reports a perfectly
 *  good install as "CLI not found". Prefer stdout; fall back to the first
 *  stderr line; null when both are empty. */
export function versionFromProbe(stdout: string | undefined, stderr: string | undefined): string | null {
  const out = (stdout ?? "").trim();
  if (out) return out;
  const err = (stderr ?? "").trim().split(/\r\n|\n|\r/, 1)[0]?.trim() ?? "";
  return err || null;
}

/** A parsed dotted version triple — the shape every harness's version gate
 * compares, whatever its banner looks like. */
export type VersionTriple = readonly [number, number, number];

/** The first dotted numeric triple in a version banner, or null when there is
 * none. A wrapper that prints its own banner first still parses: the triple
 * is the version wherever it appears. */
export function parseVersionTriple(value: string): VersionTriple | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether `installed` compares at or above `floor`, componentwise. Every
 * version floor in the tree is a dotted triple. */
export function versionAtLeast(installed: VersionTriple, floor: VersionTriple): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (installed[i] !== floor[i]) return installed[i] > floor[i];
  }
  return true;
}

