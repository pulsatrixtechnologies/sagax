import { createHash } from "node:crypto";
import { extractMcpImages } from "../../mcp/mcp-tool-images.ts";
import { foreignMailboxAccessDenied } from "../../../shared/mailbox-user.ts";
import { toolFailureText } from "../../../shared/tool-failure-text.ts";
import { toolDetailPreview } from "../../tools/tool-summary.ts";
import { readUseToolCall } from "../../../shared/mcp-gateway-call.ts";

export type AcpToolEndEvent = { type: "item.completed" } & (
  | { itemType: "tool"; itemId: string | undefined; ok: boolean; output?: string; [field: string]: unknown }
  | { itemType: "assistant_image"; data: string }
);

/**
 * A failed call's own error, as the engine reported it (2026-11-02, every
 * shape 2026-11-03: shared/tool-failure-text.ts). Grok sends an MCP failure as
 * `rawOutput: { type: "MCP", output: { Error } }`, a use_tool / gateway failure
 * as `rawOutput: { error, message }` beside the same words in `content`, its
 * own tools' failures as typed variants (`{ type: "ReadFile", FileNotFound }`,
 * `{ type: "Bash", output_for_prompt }`) and a refused call with `content`
 * only. The words win over a JSON envelope, and `content` stands in when
 * `rawOutput` says nothing, so the step and the bot always get the real reason.
 */
export function acpFailedToolText(
  rawOutput: unknown,
  content: unknown,
  call?: { tool?: string; input?: unknown },
): string | undefined {
  // #1943: a 403 on another mailbox is the retry sentence. Any other failure
  // keeps the engine's own words.
  const denied = call
    ? foreignMailboxAccessDenied(call.tool, call.input, rawOutput) ?? foreignMailboxAccessDenied(call.tool, call.input, content)
    : null;
  if (denied) return denied;
  const words = toolFailureText(rawOutput) ?? toolFailureText(content);
  return words ? toolDetailPreview(words) : undefined;
}

/**
 * The events that end a finished tool item: its completion, then any images its result carries. An item already in
 * `ended` gets none, and an item that ends here joins it: ACP v1 lets an update name a tool call that already
 * finished, and a `tool_call` may arrive already completed or failed with no update after it. `toolFields` adds the
 * driver's own fields (a structured tool result) to the completion.
 */
export function acpToolEndEvents(
  update: { status?: unknown; rawOutput?: unknown; content?: unknown },
  itemId: string | undefined,
  ended: Set<string>,
  toolFields: Record<string, unknown> = {},
  call?: { tool?: string; input?: unknown },
): AcpToolEndEvent[] {
  if (itemId !== undefined) {
    if (ended.has(itemId)) return [];
    ended.add(itemId);
  }
  const failed = update.status === "failed";
  const output = (failed ? acpFailedToolText(update.rawOutput, update.content, call) : undefined)
    ?? toolDetailPreview(update.rawOutput ?? update.content)
    ?? (update.rawOutput !== undefined && update.rawOutput !== null ? toolDetailPreview(update.content) : undefined);
  return [
    { type: "item.completed", itemType: "tool", itemId, ok: !failed,
      ...(output !== undefined ? { output } : {}), ...toolFields },
    ...extractMcpImages(update.content ?? update.rawOutput).map((img): AcpToolEndEvent =>
      ({ type: "item.completed", itemType: "assistant_image", data: img.data })),
  ];
}

/** #3126: the arguments a call ended with, when they differ from what its start
 * showed. Grok's use_tool sends them only on a later tool_call_update, so the
 * start read "{}" and distinct calls looked like one call repeated. */
export function acpLateToolInput(
  call: { title?: string; start?: string; raw?: unknown },
  updateRaw: unknown,
  meta?: unknown,
): { input: string; inputDigest: string } | undefined {
  const raw = updateRaw !== undefined ? updateRaw : call.raw;
  if (raw === undefined) return undefined;
  const useTool = readUseToolCall(raw, { title: call.title, meta });
  const args = useTool ? useTool.args : raw;
  const preview = toolDetailPreview(args);
  if (preview === undefined || preview === call.start) return undefined;
  // The preview redacts values (a settings "key" among them); the digest tells calls apart.
  const inputDigest = createHash("sha256").update(stableJson(args)).digest("hex").slice(0, 16);
  return { input: preview, inputDigest };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
