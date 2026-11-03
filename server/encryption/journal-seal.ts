// The journal's SHA-256 link, sealed when the decision line is written.
// Export reads this chain. It does not hash the sources again: rewriting
// them must not mint a new valid chain.
import { createHash } from "node:crypto";

/** The link before the first row. A chain that does not start here is not this journal. */
export const JOURNAL_GENESIS = "0".repeat(64);

export interface JournalSealFields {
  at: string;
  botId: string;
  tool: string;
  outcome: string;
  decider: string;
  source: string;
  ran: string;
}

export interface JournalSealLink extends JournalSealFields {
  prev: string;
  hash: string;
}

function sealBody(entry: JournalSealFields, prev: string): string {
  return JSON.stringify({
    prev,
    at: entry.at,
    botId: entry.botId,
    tool: entry.tool,
    outcome: entry.outcome,
    decider: entry.decider,
    source: entry.source,
    ran: entry.ran,
  });
}

export function hashJournalLink(entry: JournalSealFields, prev: string): string {
  return createHash("sha256").update(sealBody(entry, prev)).digest("hex");
}

/** One link, hashed from the previous link and these fields. */
export function sealLink(prev: string, fields: JournalSealFields): JournalSealLink {
  return { ...fields, prev, hash: hashJournalLink(fields, prev) };
}
