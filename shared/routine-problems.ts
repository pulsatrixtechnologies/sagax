// The "Completed with problems" text of a routine run, as a person reads it.
//
// A teammate's failed work is told by its account (server/turn-outcome.ts):
// the cause, what it did, then `Its last message, quoted: "<JSON string>"`.
// That quote is data for prompts; shown as is, a person read literal `\n`,
// `**` and an unclosed quote where the run's 1,000-character cut fell
// (production 2026-11-03 00:10 UTC, a catch-up routine: a teammate's last
// message `"FAIL\n\nThe two-message archive plan is **not`). Here the quote
// becomes plain text: escapes turned into real line breaks, markdown marks
// dropped, and a cut quote ends with an ellipsis. Read at render too, so
// rows stored before this read right without touching them.

const QUOTED = /Its last message, quoted: "((?:[^"\\]|\\.)*)("|\\?$)/g;

/** A JSON string body (without its quotes) as text, even when it was cut
 * mid-escape: what decodes, decoded, the rest dropped. */
function unescapeJson(body: string): string {
  try { return JSON.parse(`"${body}"`) as string; } catch { /* cut short */ }
  return body.replace(/\\(u[0-9a-fA-F]{4}|.)?/g, (_, esc: string | undefined) => {
    if (!esc) return "";
    if (esc[0] === "u" && esc.length === 5) return String.fromCharCode(parseInt(esc.slice(1), 16));
    return ({ n: "\n", r: "", t: " ", b: "", f: "" } as Record<string, string>)[esc] ?? esc;
  });
}

/** Markdown marks out of a teammate's words: emphasis, code ticks, heading
 * and quote marks, links kept as their text. Bullets and numbers stay. */
export function plainFromMarkdown(text: string): string {
  return text
    .replace(/```[^\n]*\n?/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/gm, "$1$2")
    .replace(/`/g, "")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The problems text with every quoted last message as plain text. */
export function readableRoutineProblems(text: string): string {
  return text.replace(QUOTED, (_, body: string, close: string) => {
    const cut = close !== "\"";
    const words = plainFromMarkdown(unescapeJson(body));
    return words ? `Its last message:\n${words}${cut ? "…" : ""}` : "";
  }).replace(/\n{3,}/g, "\n\n").trim();
}
