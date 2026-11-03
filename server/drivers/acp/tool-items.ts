import { extractMcpImages } from "../../mcp/mcp-tool-images.ts";
import { toolDetailPreview } from "../../tool-summary.ts";

export type AcpToolEndEvent = { type: "item.completed" } & (
  | { itemType: "tool"; itemId: string | undefined; ok: boolean; output?: string; [field: string]: unknown }
  | { itemType: "assistant_image"; data: string }
);

/** The text of ACP `content` blocks (`[{ type: "content", content: { type: "text", text } }]`). */
function contentText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((block) => {
    const inner = (block as { content?: { type?: unknown; text?: unknown } } | null)?.content;
    return inner?.type === "text" && typeof inner.text === "string" && inner.text.trim() ? [inner.text.trim()] : [];
  });
  return parts.length ? parts.join("\n") : undefined;
}

/**
 * A failed call's own error, as the engine reported it (2026-11-02). Grok
 * sends an MCP failure as `rawOutput: { output: { Error } , is_error }`, a
 * use_tool / gateway failure as `rawOutput: { error, message }` beside the same
 * words in `content`, and a refused call with `content` only. The words win over
 * a JSON envelope, and `content` stands in when `rawOutput` says nothing, so
 * the step and the bot always get the real reason.
 */
export function acpFailedToolText(rawOutput: unknown, content: unknown): string | undefined {
  const raw = rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput) ? rawOutput as Record<string, unknown> : undefined;
  const nested = raw?.output && typeof raw.output === "object" ? raw.output as Record<string, unknown> : undefined;
  const candidates = [
    nested?.Error, nested?.error, nested?.message,
    typeof raw?.message === "string" ? raw.message : undefined,
    typeof raw?.error === "string" && /\s/.test(raw.error) ? raw.error : undefined,
    typeof rawOutput === "string" ? rawOutput : undefined,
    contentText(content),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return toolDetailPreview(candidate.trim());
  }
  return undefined;
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
): AcpToolEndEvent[] {
  if (itemId !== undefined) {
    if (ended.has(itemId)) return [];
    ended.add(itemId);
  }
  const failed = update.status === "failed";
  const output = (failed ? acpFailedToolText(update.rawOutput, update.content) : undefined)
    ?? toolDetailPreview(update.rawOutput ?? update.content)
    ?? (update.rawOutput !== undefined && update.rawOutput !== null ? toolDetailPreview(update.content) : undefined);
  return [
    { type: "item.completed", itemType: "tool", itemId, ok: !failed,
      ...(output !== undefined ? { output } : {}), ...toolFields },
    ...extractMcpImages(update.content ?? update.rawOutput).map((img): AcpToolEndEvent =>
      ({ type: "item.completed", itemType: "assistant_image", data: img.data })),
  ];
}
