// How much of one MCP tool result is allowed into a model's context.
//
// An MCP server answers for a machine, not for a context window: a single
// Swiggy product search returns 60-140 KB of JSON, a restaurant menu 70-105 KB.
// Whatever comes back is appended to the conversation the CLI keeps, and every
// later model call in that session re-reads it. Four searches in one turn added
// 67,000 tokens to a food-ordering thread that never needed them again.
//
// So the gate keeps a readable prefix and says, at both ends of the result
// itself, that it is incomplete, exactly what it cut, and how to get the rest.
// Nothing is lost — the untrimmed
// text is written to a file the bot can read or grep with its ordinary tools.
//
// This module is pure. The process that uses it is mcp-gate.ts.

/** Characters of a single tool result that may enter the model's context.
 * ~4 chars per token, so ~2k tokens: enough for a page of results, far below
 * the 35k-token searches this exists to stop. */
export const DEFAULT_RESULT_BUDGET = 8_000;

/** Never cut below this, whatever the budget says: a result so short that it
 * cannot carry a single record is worse than no trimming at all. */
const MIN_BUDGET = 512;

export interface TrimOutcome {
  /** the text to hand the model */
  text: string;
  /** false when the original was already within budget and is untouched */
  trimmed: boolean;
  originalChars: number;
  /** the parsed payload as kept, when the cut was structural (whole records):
   * the gate hands it to a `structuredContent` that carried the same data,
   * so both copies show the same records */
  value?: unknown;
}

export interface TrimInput {
  text: string;
  budget?: number;
  /** absolute path where the untrimmed text was saved, if it was */
  spillPath?: string;
  /** Put that path in front of the model. Off by default, and measured:
   * with the path offered, a model reading a 136 KB search result answered
   * the same question for MORE context than no trimming at all (210,913 vs
   * 196,183 tokens) — it read the file straight back in. An invitation to
   * undo the trim is not a safety net, it is a slower way to pay. The file
   * is still written; it is for the person and the harness, and this flag
   * exists for debugging. */
  spillHint?: boolean;
  /** for the marker's wording only */
  toolName?: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** JSON.stringify, or null for a value that cannot be serialized (a cycle). */
function serialize(value: unknown): string | null {
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : null;
  } catch {
    return null;
  }
}

/** The longest prefix of `items` whose serialized length fits `budget`.
 * Always returns at least one element when one exists, so a caller can tell
 * "one huge record" apart from "nothing fit" and fall back accordingly. */
function fitArray(items: readonly unknown[], budget: number): unknown[] {
  const kept: unknown[] = [];
  let used = 2; // the brackets
  for (const item of items) {
    const json = serialize(item);
    if (json === null) break;
    const cost = json.length + (kept.length ? 1 : 0); // the comma
    if (kept.length && used + cost > budget) break;
    kept.push(item);
    used += cost;
  }
  return kept;
}

/** Top-level array fields, in declaration order — where an MCP server puts
 * its bulk. A bare array root is reported as the single field "". */
function arrayFields(value: unknown): Array<{ key: string; items: readonly unknown[] }> {
  if (Array.isArray(value)) return [{ key: "", items: value }];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .map(([key, items]) => ({ key, items }));
}

/** Cut on a character boundary, never mid-surrogate-pair — half an emoji is
 * an invalid string that some providers reject outright. */
function cutAt(text: string, chars: number): string {
  const cut = text.slice(0, Math.max(0, chars));
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** The warning a trimmed result carries, at the START and again at the END.
 *
 * Measured upstream: a quiet trailing note ("layers 5 of 110") let two bots
 * read a 110-layer composition as five layers, decide the tool was hard-capped,
 * and report they had checked every layer. So it says, first thing, that the
 * result is incomplete, how much of it was kept, and what to do about it. */
export function truncationBanner(input: {
  originalChars: number;
  keptChars: number;
  dropped: Array<{ key: string; kept: number; total: number }>;
  spillPath?: string;
  spillHint?: boolean;
  structural: boolean;
  /** the short form, for a budget too small to carry the full one twice */
  short?: boolean;
}): string {
  const size = `${fmt(input.keptChars)} of ${fmt(input.originalChars)} chars`;
  if (input.short) return `⚠️ TRUNCATED by Sagax: kept ${size}; the rest was NOT shown. Narrow the call or page.`;
  const counts = input.dropped
    .filter((d) => d.kept < d.total)
    .map((d) => `${d.key || "items"} ${fmt(d.kept)} of ${fmt(d.total)}`)
    .join(", ");
  const what = input.structural && counts
    ? `kept ${counts} (${size}).`
    : input.structural
      ? `kept ${size}.`
      : `kept the first ${size}; the text is cut mid-way, so it may be incomplete JSON.`;
  // What a model should do about it: ask the tool a better question. Never
  // "go and read the whole thing", which costs more than not trimming.
  const next = "If the tool supports paging (offset/limit/page) or a narrower query or filter, call it again for the remaining items; never assume you saw everything.";
  const where = input.spillHint && input.spillPath
    ? ` The whole result is at ${JSON.stringify(input.spillPath)}; reading it costs as much as not trimming, so narrow the call first.`
    : "";
  return `⚠️ TRUNCATED by Sagax: ${what} The rest was NOT shown. ${next}${where}`;
}

/** The trimmed body with the banner in front and behind it. */
function wrap(body: string, banner: string): string {
  return `${banner}\n\n${body}\n\n${banner}`;
}

/** The structural cut on its own, for a payload that is already parsed and
 * must stay valid JSON of the same shape (a tool's `structuredContent`).
 * Returns null when the bulk arrays cannot be made to fit — a caller holding
 * a schema-bound value must then leave it alone rather than mangle it. */
export function trimStructured(parsed: unknown, budget: number): { value: unknown; dropped: Array<{ key: string; kept: number; total: number }> } | null {
  const room = Math.max(MIN_BUDGET, budget);
  const current = serialize(parsed);
  if (current !== null && current.length <= room) return null;
  const fields = arrayFields(parsed);
  if (!fields.length) return null;
  const skeleton = Array.isArray(parsed)
    ? 2
    : (serialize({ ...(parsed as Record<string, unknown>), ...Object.fromEntries(fields.map((f) => [f.key, []])) })?.length ?? Infinity);
  const share = Math.floor((room - skeleton) / fields.length);
  if (!Number.isFinite(skeleton) || share <= 0) return null;
  const dropped: Array<{ key: string; kept: number; total: number }> = [];
  let value: unknown;
  if (Array.isArray(parsed)) {
    const kept = fitArray(parsed, share);
    dropped.push({ key: "", kept: kept.length, total: parsed.length });
    value = kept;
  } else {
    const next: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    for (const field of fields) {
      const kept = fitArray(field.items, share);
      dropped.push({ key: field.key, kept: kept.length, total: field.items.length });
      next[field.key] = kept;
    }
    value = next;
  }
  if (!dropped.some((d) => d.kept < d.total)) return null;
  const json = serialize(value);
  return json !== null && json.length <= room ? { value, dropped } : null;
}

/** Trim one tool result's text down to the budget, keeping whole records
 * wherever the payload is JSON so the model is never handed a half-object. */
export function trimResultText(input: TrimInput): TrimOutcome {
  const { text } = input;
  const budget = Math.max(MIN_BUDGET, input.budget ?? DEFAULT_RESULT_BUDGET);
  if (text.length <= budget) return { text, trimmed: false, originalChars: text.length };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  const fields = parsed === undefined ? [] : arrayFields(parsed);
  // Room for the banner at both ends, sized for the longest it can be here
  // (every count at its widest), so the whole result lands under the budget.
  // A small budget that the full banners would eat more than half of gets
  // the short form instead; either way the body has only what is left.
  const widestOf = (short: boolean) => Math.max(
    truncationBanner({ originalChars: text.length, keptChars: text.length, dropped: fields.map((f) => ({ key: f.key, kept: Math.max(0, f.items.length - 1), total: f.items.length })), spillPath: input.spillPath, spillHint: input.spillHint, structural: true, short }).length,
    truncationBanner({ originalChars: text.length, keptChars: text.length, dropped: [], spillPath: input.spillPath, spillHint: input.spillHint, structural: false, short }).length,
  );
  const fullRoom = budget - 2 * (widestOf(false) + 2);
  const short = fullRoom < budget / 2;
  const room = Math.max(0, short ? budget - 2 * (widestOf(true) + 2) : fullRoom);
  if (fields.length) {
    // What the payload costs with every bulk array emptied. Anything left is
    // shared out between those arrays, in order, equally.
    const skeleton = Array.isArray(parsed)
      ? 2
      : (serialize({ ...(parsed as Record<string, unknown>), ...Object.fromEntries(fields.map((f) => [f.key, []])) })?.length ?? Infinity);
    const share = Math.floor((room - skeleton) / fields.length);
    if (Number.isFinite(skeleton) && share > 0) {
      const dropped: Array<{ key: string; kept: number; total: number }> = [];
      let value: unknown;
      if (Array.isArray(parsed)) {
        const kept = fitArray(parsed, share);
        dropped.push({ key: "", kept: kept.length, total: parsed.length });
        value = kept;
      } else {
        const next: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
        for (const field of fields) {
          const kept = fitArray(field.items, share);
          dropped.push({ key: field.key, kept: kept.length, total: field.items.length });
          next[field.key] = kept;
        }
        value = next;
      }
      const json = serialize(value);
      // One record can be larger than the whole share; if the structural cut
      // still overflows, the text cut below is the honest answer.
      if (json !== null && json.length <= room) {
        return {
          text: wrap(json, truncationBanner({ originalChars: text.length, keptChars: json.length, dropped, spillPath: input.spillPath, spillHint: input.spillHint, structural: true, short })),
          trimmed: true,
          originalChars: text.length,
          value,
        };
      }
    }
  }

  const cut = cutAt(text, room);
  return {
    text: wrap(cut, truncationBanner({ originalChars: text.length, keptChars: cut.length, dropped: [], spillPath: input.spillPath, spillHint: input.spillHint, structural: false, short })),
    trimmed: true,
    originalChars: text.length,
  };
}
