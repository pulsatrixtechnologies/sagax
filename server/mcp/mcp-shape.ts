// Shaping an oversized tool result instead of cutting it blind.
//
// The gate keeps the whole parsed result on its side and shows the model a
// summary plus the first records (mcp-trim.ts). The model then asks for
// exactly the fields and rows it needs through one read-only tool that runs
// a JMESPath query over the held value. JMESPath cannot run code, so nothing
// here needs a sandbox, and every answer goes through the same budget as any
// other result: there is no path that returns the whole payload.
import jmespath from "jmespath";

import { QUERY_TOOL_NAME, trimResultText } from "./mcp-trim.ts";

export { QUERY_TOOL_NAME };

const MAX_KEYS = 12;
/** The least a string window shows, however small the budget. */
const MIN_WINDOW = 256;
/** Results held per gate process; the oldest go first. A session's gate lives as long as its MCP connection. */
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export interface QueryToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

export const QUERY_TOOL = {
  name: QUERY_TOOL_NAME,
  description:
    "Fetch exactly the part you need of a tool result that was too big to show in full. "
    + "The shaped result names its handle (\"r3\") and its shape; pass that handle and a JMESPath query that selects only "
    + "the fields and rows you need, e.g. items[?price < `200`].{name: name, price: price} | [0:30], length(items), "
    + "sort_by(items, &price)[0:5].name, or items[?contains(name, `pizza`)].id. Big answers are cut too, so narrow "
    + "the query rather than asking for everything. A query that selects one long string (a document's text) comes back "
    + "as a window; pass from (the offset the window names) to read the next part. Read-only: it never calls the original tool again.",
  inputSchema: {
    type: "object",
    properties: {
      result: { type: "string", description: "The handle named in the shaped result, such as \"r3\"." },
      query: { type: "string", description: "A JMESPath expression over the whole held result." },
      from: { type: "integer", minimum: 0, description: "When the query selects one string: the character offset to start the window at (the previous window names it). Default 0." },
    },
    required: ["result", "query"],
    additionalProperties: false,
  },
  annotations: { title: "Query a held result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function keyList(keys: string[]): string {
  if (!keys.length) return "{}";
  const shown = keys.slice(0, MAX_KEYS);
  return `{${shown.join(", ")}${keys.length > MAX_KEYS ? ", …" : ""}}`;
}

function itemKeys(items: readonly unknown[]): string {
  const first = items.find((item) => item !== null && item !== undefined);
  return isRecord(first) ? keyList(Object.keys(first)) : "";
}

/** One line a model can query against: the top-level keys, then each array's size and item keys. */
export function describeShape(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} items${itemKeys(value)}`;
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const arrays = keys.filter((key) => Array.isArray(value[key]));
    const head = `object${keyList(keys)}`;
    const parts = arrays.map((key) => {
      const items = value[key] as unknown[];
      return `${key}: ${items.length} items${itemKeys(items)}`;
    });
    return parts.length ? `${head}; ${parts.join("; ")}` : head;
  }
  return value === null ? "null" : typeof value;
}

/** A query that is valid against this exact value, so the model's first attempt is never a syntax lesson. */
export function exampleQuery(value: unknown): string {
  const pick = (items: readonly unknown[], prefix: string): string => {
    const first = items.find((item) => item !== null && item !== undefined);
    if (!isRecord(first)) return `${prefix}[0:20]`;
    const fields = Object.keys(first).slice(0, 2).map((key) => `${key}: ${key}`);
    return `${prefix}[0:20].{${fields.join(", ")}}`;
  };
  if (Array.isArray(value)) return pick(value, "");
  if (isRecord(value)) {
    const array = Object.keys(value).find((key) => Array.isArray(value[key]));
    if (array) return pick(value[array] as unknown[], array);
    return "keys(@)";
  }
  return "@";
}

interface Held { tool: string; value: unknown; bytes: number }

export class ResultStore {
  readonly #entries = new Map<string, Held>();
  readonly #maxBytes: number;
  #next = 1;
  #bytes = 0;

  constructor(options: { maxBytes?: number } = {}) {
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  put(tool: string, value: unknown, bytes?: number): string {
    const handle = `r${this.#next++}`;
    const size = bytes ?? (JSON.stringify(value)?.length ?? 0);
    this.#entries.set(handle, { tool, value, bytes: size });
    this.#bytes += size;
    for (const [oldest, held] of this.#entries) {
      if (this.#bytes <= this.#maxBytes || oldest === handle) break;
      this.#entries.delete(oldest);
      this.#bytes -= held.bytes;
    }
    return handle;
  }

  get(handle: string): { tool: string; value: unknown } | undefined {
    const held = this.#entries.get(handle);
    return held ? { tool: held.tool, value: held.value } : undefined;
  }
}

const text = (body: string, isError?: true): QueryToolResult => ({ content: [{ type: "text", text: body }], ...(isError ? { isError } : {}) });

/** Answer one query_result call locally; the upstream server never sees it. */
export function answerQuery(store: ResultStore, args: unknown, budget: number): QueryToolResult {
  if (!isRecord(args) || typeof args.result !== "string" || typeof args.query !== "string" || !args.query.trim()) {
    return text(`${QUERY_TOOL_NAME} needs {"result": "<handle from the shaped result>", "query": "<JMESPath>"}.`, true);
  }
  const held = store.get(args.result);
  if (!held) {
    return text(`Result "${args.result}" is no longer held; call the original tool again and query the new handle it gives you.`, true);
  }
  const shape = describeShape(held.value);
  const example = exampleQuery(held.value);
  let selected: unknown;
  try {
    selected = jmespath.search(held.value, args.query);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return text(`Invalid JMESPath query (${reason}). The held result "${args.result}" is ${shape}. Examples: ${example}; length(@).`, true);
  }
  if (typeof selected === "string") return windowString(selected, args.result, args.query, args.from, budget);
  const body = JSON.stringify(selected) ?? "null";
  if (body.length <= budget) return text(body);
  const out = trimResultText({ text: body, budget, toolName: QUERY_TOOL_NAME, held: { handle: args.result, shape, example, queried: true } });
  return text(out.text);
}

/** A query that selects one long string is a document the model wants to
 * read, not a record set it can narrow: it is shown raw, one budget-sized window
 * at a time, each window naming the offset the next call passes as `from`.
 * Cutting it the way a JSON record is cut would stop at the first window
 * for good; the model then re-ran the tool and the whole document came back. */
function windowString(value: string, handle: string, query: string, from: unknown, budget: number): QueryToolResult {
  const start = typeof from === "number" && Number.isInteger(from) && from >= 0 ? from : 0;
  // A string that fits is answered as any other selection, JSON-encoded.
  if (start === 0 && value.length + 2 <= budget) return text(JSON.stringify(value));
  if (start >= value.length) {
    return text(`"${handle}" ${query} is ${value.length} chars long; from ${start} is past its end. The last window starts before ${value.length}.`, true);
  }
  const next = (end: number) => `${QUERY_TOOL_NAME} {"result":"${handle}","query":${JSON.stringify(query)},"from":${end}}`;
  const headOf = (end: number) => `⚠️ WINDOW by Sagax: chars ${start} to ${end} of ${value.length} of your query on "${handle}"; the rest was NOT shown.${end < value.length ? ` Next part: ${next(end)}.` : " This is the last part."}`;
  const footOf = (end: number) => end < value.length ? `⚠️ WINDOW by Sagax: ends at char ${end} of ${value.length}; next part: ${next(end)}.` : `⚠️ WINDOW by Sagax: last part, ends at char ${end} of ${value.length}.`;
  // The widest the two banners get: the last window, or the one just before
  // it, which still names the next call with the longest offset.
  const widest = Math.max(...[value.length, value.length - 1].map((end) => headOf(end).length + footOf(end).length));
  const room = Math.max(MIN_WINDOW, budget - (widest + 4));
  let end = Math.min(value.length, start + room);
  const last = value.charCodeAt(end - 1);
  if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text(`${headOf(end)}\n\n${value.slice(start, end)}\n\n${footOf(end)}`);
}
