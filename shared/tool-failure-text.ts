// The words of a failed tool call, whatever shape its engine or server gave
// them (2026-11-03, the maintainer: "The tool failed and returned no error message" on
// cards whose error the routine summary quoted). One reader for the server
// drivers (before redaction and the preview cut, server/tools/tool-summary.ts)
// and for the step detail (stored rows, already redacted, src/components/ToolActivity.tsx).
//
// Shapes read, measured on the engines Sagax drives:
// - a plain string, a JSON string of any shape below, `<tool_use_error>` tags;
// - MCP `CallToolResult` (`{ content: [{ type: "text", text }], isError }`),
//   its `structuredContent`, and bare content blocks;
// - ACP content blocks (`[{ type: "content", content: { type: "text", text } }]`);
// - a JSON-RPC error (`{ error: { code, message, data } }`), `{ error: "words" }`,
//   `{ error: "tool_execution_failed", message }` (Grok's managed gateway);
// - Grok's own results: MCP `{ type: "MCP", output: { Error } }`, typed
//   variants (`{ type: "ReadFile", FileNotFound: "..." }`,
//   `{ type: "SearchReplace", NoMatchesFound: { message } }`), a shell's
//   `output_for_prompt` / byte arrays, a search's `failure`;
// - an envelope (`{ ok: false, result }`, `{ output }`, Codex's `{ error: { message } }`);
// - an API error body (`{ message, code, hint }`, `{ detail }`, `{ error_description }`).
// Undefined when there are no words: only then does a card say it has none.

const MAX_DEPTH = 8;
/** Keys that hold an error's own sentence, in the order they win. */
const WORD_KEYS = ["failure", "output_for_prompt", "detail", "reason", "error_description", "errorMessage", "error_message", "stderr", "description"] as const;
/** Keys that wrap the result of a call. */
const WRAPPER_KEYS = ["output", "result", "results", "errors", "content", "structuredContent", "data", "body", "response"] as const;
const CODE_KEYS = ["code", "error_class", "error_code", "errorCode"] as const;
/** A Grok result variant (`FileNotFound`, `NotFound`, `InvalidInput`). */
const VARIANT_KEY = /^[A-Z][A-Za-z0-9]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isByteArray(value: unknown[]): value is number[] {
  return value.length > 0 && value.every((item) => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 255);
}

function fromBytes(bytes: number[]): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return "";
  }
}

function fromString(raw: string, depth: number): string | undefined {
  const text = raw.replace(/<\/?tool_use_error>/g, "").trim();
  if (!text) return undefined;
  if (/^[[{]/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      // a JSON body with words reads as them; one without stays as written
      return read(parsed, depth + 1) ?? text;
    } catch {
      // ordinary text that starts with a bracket
    }
  }
  return text;
}

function words(value: unknown, depth: number): string | undefined {
  if (typeof value === "string") return fromString(value, depth);
  return read(value, depth + 1);
}

/** `message`, with the code and the hint an API body gives beside it. */
function messageOf(record: Record<string, unknown>, depth: number): string | undefined {
  const message = typeof record.message === "string" ? fromString(record.message, depth) : undefined;
  if (!message) return undefined;
  const code = CODE_KEYS.map((key) => record[key]).find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
  const hint = typeof record.hint === "string" && record.hint.trim() ? record.hint.trim() : undefined;
  const coded = code && !message.includes(code) ? `${message} (${code})` : message;
  return hint && !coded.includes(hint) ? `${coded}\n${hint}` : coded;
}

function readRecord(record: Record<string, unknown>, depth: number): string | undefined {
  // an MCP text block
  if (record.type === "text" && typeof record.text === "string") return fromString(record.text, depth);
  // an image or audio block has no words, only bytes
  if (record.type === "image" || record.type === "audio") return undefined;
  // an MCP result flagged as an error: its content is the error
  if ((record.isError === true || record.is_error === true) && record.content !== undefined) {
    const found = words(record.content, depth);
    if (found) return found;
  }
  // a JSON-RPC or API error object
  if (isRecord(record.error) || Array.isArray(record.error)) {
    const found = read(record.error, depth + 1);
    if (found) return found;
  }
  const message = messageOf(record, depth);
  if (message) return message;
  // Grok's MCP failure, and `{ error: "words" }`; a bare code
  // (`tool_execution_failed`) only when nothing better follows
  const bareCodes: string[] = [];
  for (const key of ["Error", "error"] as const) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) continue;
    if (/\s/.test(value.trim()) || key === "Error") return fromString(value, depth);
    bareCodes.push(value.trim());
  }
  for (const key of WORD_KEYS) {
    const value = record[key];
    if (Array.isArray(value) && isByteArray(value)) {
      const found = fromString(fromBytes(value), depth);
      if (found) return found;
    } else if (typeof value === "string") {
      const found = fromString(value, depth);
      if (found) return found;
    }
  }
  if (Array.isArray(record.details) || typeof record.details === "string") {
    const found = words(record.details, depth);
    if (found) return found;
  }
  // a Grok result variant beside its `type`
  if (typeof record.type === "string") {
    for (const [key, value] of Object.entries(record)) {
      if (key === "type" || !VARIANT_KEY.test(key)) continue;
      const found = words(value, depth);
      if (found) return found;
    }
  }
  for (const key of WRAPPER_KEYS) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && isByteArray(value)) {
      const found = fromString(fromBytes(value), depth);
      if (found) return found;
      continue;
    }
    const found = words(value, depth);
    if (found) return found;
  }
  return bareCodes[0];
}

function read(value: unknown, depth: number): string | undefined {
  if (depth > MAX_DEPTH || value === undefined || value === null) return undefined;
  if (typeof value === "string") return fromString(value, depth);
  if (Array.isArray(value)) {
    if (isByteArray(value)) return fromString(fromBytes(value), depth);
    const parts = value.slice(0, 40).map((item) => words(item, depth)).filter((part): part is string => Boolean(part));
    return parts.length ? parts.join("\n") : undefined;
  }
  if (isRecord(value)) return readRecord(value, depth);
  return undefined;
}

/** The error's own words, or undefined when the failure carried none. */
export function toolFailureText(value: unknown): string | undefined {
  const found = read(value, 0);
  return found?.trim() ? found.trim() : undefined;
}
