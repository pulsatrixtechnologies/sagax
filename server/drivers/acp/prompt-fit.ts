// 2026-11-02 (production): Grok 1.0.x moves a prompt of about 100 KB or
// more to a file under its own session folder on the Sagax server
// (.../.grok/sessions/<cwd>/<session>/prompts/prompt_0.txt) and sends the
// model an excerpt with "Lines of that file not in this message: user query
// line 415. Read only those lines from that file". Every offloaded prompt
// seen in production was 100,116 bytes or more; the line left out was the long
// "Historical excerpts" line of the conversation's earlier context.
//
// On an organization turn Grok has no file tools on the server, so the bot
// tried to read that file with its server environment's tools (another
// machine), and was refused. Sagax now keeps the request under the limit
// itself: what is shortened is said in line, with the tool that reaches the
// rest, and the person's latest message is never shortened. No file is
// written and no sandbox path is opened onto the server.

/** Grok's offload starts at about 100 KB (smallest offloaded: 100,116
 * bytes). The margin covers what Grok adds around the request. */
export const GROK_PROMPT_BYTE_LIMIT = 96_000;

/** The marker that starts the person's latest message in a turn's text. */
const LATEST_MESSAGE = "[Now reply to the user's latest message:]";
/** The line of the folded earlier context (server/context/compaction-summary.ts). */
const HISTORY_HEADER = "Historical excerpts in chronological order";
/** A shortened line keeps at least this much. */
const MIN_KEEP = 600;

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

export function fitNote(cut: number): string {
  return ` […${cut} bytes left out here to keep this request under the engine's size limit; find earlier messages with session_search and read one with session_read…] `;
}

/** A character index that splits neither a surrogate pair nor an escape
 * (a run of backslashes stays whole, so a JSON string stays one). */
function safeIndex(line: string, at: number, forward: boolean): number {
  let index = Math.max(0, Math.min(line.length, at));
  const step = forward ? 1 : -1;
  const bad = (i: number) => {
    if (i <= 0 || i >= line.length) return false;
    const code = line.charCodeAt(i);
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) slashes++;
    return slashes % 2 === 1;
  };
  while (bad(index)) index += step;
  return Math.max(0, Math.min(line.length, index));
}

/** `line` shortened by about `drop` bytes in its middle: its start and its
 * newest end stay, with the note between them. */
function shorten(line: string, drop: number): { line: string; cut: number } {
  const size = bytes(line);
  const keep = Math.max(MIN_KEEP, size - drop - 200);
  if (keep >= size) return { line, cut: 0 };
  // chars and bytes differ for accents: scale by the line's own ratio
  const ratio = line.length / size;
  const head = safeIndex(line, Math.floor(keep * 0.35 * ratio), false);
  const tail = safeIndex(line, line.length - Math.floor(keep * 0.65 * ratio), true);
  if (tail <= head) return { line, cut: 0 };
  const cut = bytes(line.slice(head, tail));
  return { line: line.slice(0, head) + fitNote(cut) + line.slice(tail), cut };
}

/** `text` under `limit` bytes when it can be: the earlier-context line
 * first, then the longest other lines, never the person's latest message.
 * Unchanged when it already fits or no limit is given. */
export function fitPromptBytes(text: string, limit: number | undefined): { text: string; cut: number } {
  if (!limit || bytes(text) <= limit) return { text, cut: 0 };
  const lines = text.split("\n");
  const latest = lines.findIndex((line) => line.includes(LATEST_MESSAGE));
  const protectedFrom = latest >= 0 ? latest : lines.length;
  const order = lines
    .map((line, index) => ({ index, size: bytes(line), history: line.includes(HISTORY_HEADER) }))
    .filter((entry) => entry.index < protectedFrom && entry.size > MIN_KEEP * 2)
    .sort((a, b) => Number(b.history) - Number(a.history) || b.size - a.size);
  let total = bytes(text);
  let cut = 0;
  for (const entry of order) {
    if (total <= limit) break;
    const shortened = shorten(lines[entry.index]!, total - limit);
    if (!shortened.cut) continue;
    total += bytes(shortened.line) - entry.size;
    cut += shortened.cut;
    lines[entry.index] = shortened.line;
  }
  return { text: lines.join("\n"), cut };
}
