// What the server did with the text added to a bot's soul (#5019): the
// soul holds identity, persona and voice only; a rule goes to RULES.md, a
// procedure or a reference to docs/, a fact to memory. The server sorts
// (server/bots/soul-sort.ts); the app and the agent API read these shapes.

/** Where a piece of added text belongs when it is not persona. */
export type SoulSortKind = "rule" | "procedure" | "reference" | "fact";

/** One piece filed out of the soul: its kind, the file it went to, the
 * start of its text, and how many entries it became (rules cut under the
 * per-rule limit, memory entries). */
export interface SoulSortMove {
  kind: SoulSortKind;
  to: string;
  text: string;
  entries: number;
}

/** Why a piece stays in the soul although it is not persona: the
 * classification failed or timed out (unsorted), its destination refused
 * it (refused: over the rules budget, a document too large), or memory is
 * off for the bot (memory-off). Nothing is ever dropped. */
export interface SoulSortKept {
  text: string;
  reason: "unsorted" | "refused" | "memory-off";
  detail?: string;
}

/** The answer of a soul write that added text: what moved where, what
 * stayed and why. Absent when nothing was added or everything is persona. */
export interface SoulSortReport {
  moved: SoulSortMove[];
  kept: SoulSortKept[];
}

/** POST /api/bots/:id/soul/preview: where each added piece will go when
 * the edit is saved, without writing anything. */
export interface SoulSortPreview {
  moves: Array<{ kind: SoulSortKind; to: string; text: string }>;
  /** Added pieces the classification could not sort: they stay in the soul. */
  unsorted: number;
}

/** At most this much of a piece's text rides in a report or a preview. */
export const SOUL_SORT_EXCERPT = 200;

export function soulSortExcerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SOUL_SORT_EXCERPT ? `${flat.slice(0, SOUL_SORT_EXCERPT - 1).trimEnd()}…` : flat;
}

/** Whether a report has anything to say. */
export function soulSortSaysSomething(report: SoulSortReport | null | undefined): report is SoulSortReport {
  return Boolean(report && (report.moved.length || report.kept.length));
}

/** What a bot or an AI client reads after a soul write that added text
 * that is not persona: where each piece went, what stayed and why. */
export function soulSortNote(report: SoulSortReport): string {
  const lines: string[] = [];
  if (report.moved.length) {
    lines.push("SOUL.md holds identity, persona and voice only; Sagax filed what this change added elsewhere:");
    for (const move of report.moved) {
      const what = move.kind === "rule" ? `${move.entries === 1 ? "a rule" : `${move.entries} rules`}` : move.kind === "fact" ? `${move.entries === 1 ? "a fact" : `${move.entries} facts`}` : `a ${move.kind}`;
      lines.push(`- ${what} to ${move.to}: "${move.text}"`);
    }
  }
  if (report.kept.length) {
    lines.push("Kept in SOUL.md:");
    for (const kept of report.kept) {
      const why = kept.reason === "unsorted" ? "it could not be sorted now" : kept.reason === "memory-off" ? "memory is off for this bot" : `its file refused it${kept.detail ? ` (${kept.detail})` : ""}`;
      lines.push(`- "${kept.text}": ${why}`);
    }
  }
  return lines.join("\n");
}
