// Company memory is one file, memory/company.md, per bot. Every bot of the
// same person reads those files. A bot of another member does not: the
// read is filtered on the owner before the file is opened. A line marked
// readers person is dropped even if it was copied by mistake.
//
// #1375: a turn never reads those files. They are read in the background
// into a cache (CompanyMemoryCache), refreshed when Sagax writes one and,
// for a write by the bot's own file tools, at most COMPANY_REFRESH_MS
// later. What the prompt gets is bounded like MEMORY.md.
import { factIdentity } from "./memory-entries.ts";
import { COMPANY_TOPIC, memoryAudience } from "./memory-dream.ts";
import { MEMORY_MAX_BYTES, MEMORY_MAX_LINES } from "../workspace.ts";

/** The company block's own budget, the same as MEMORY.md's. */
export const COMPANY_MAX_LINES = MEMORY_MAX_LINES;
export const COMPANY_MAX_BYTES = MEMORY_MAX_BYTES;

export const COMPANY_TRUNCATED_NOTE =
  `[Only the first ${COMPANY_MAX_LINES} lines / ${COMPANY_MAX_BYTES} bytes of company memory are shown; the rest is not visible.]`;

export function companyTextForBots(input: {
  ownerKey: string;
  bots: readonly { id: string; ownerKey: string }[];
  read: (botId: string) => string | null | undefined;
}): string {
  const owner = input.ownerKey.trim().toLowerCase();
  const seen = new Set<string>();
  const lines: string[] = [];
  let bytes = 0;
  let truncated = false;
  for (const bot of input.bots) {
    if (truncated) break;
    if (bot.ownerKey.trim().toLowerCase() !== owner) continue;
    const text = input.read(bot.id);
    if (!text) continue;
    for (const line of text.split("\n")) {
      if (!line.trim() || memoryAudience(line) === "person") continue;
      const key = factIdentity(line);
      if (!key || seen.has(key)) continue;
      // whole lines only: a fact is never cut in half
      const size = Buffer.byteLength(line, "utf8") + (lines.length ? 1 : 0);
      if (lines.length >= COMPANY_MAX_LINES || bytes + size > COMPANY_MAX_BYTES) {
        truncated = true;
        break;
      }
      seen.add(key);
      lines.push(line);
      bytes += size;
    }
  }
  if (truncated) lines.push(COMPANY_TRUNCATED_NOTE);
  return lines.join("\n");
}

/** How long a cached company.md is trusted before it is read again in the
 * background (a write by the bot's own file tools, which Sagax does not see). */
export const COMPANY_REFRESH_MS = 60_000;

type Entry = { text: string | null; at: number; seq: number; loading?: Promise<void> };

/** company.md of each bot, read off the turn's path. `get` never touches the
 * disk: it answers from memory and starts a background read when the entry
 * is missing or older than `refreshMs`. A bot not read yet counts as having
 * no company memory for that one turn. */
export class CompanyMemoryCache {
  private readonly entries = new Map<string, Entry>();
  private readonly read: (botId: string) => Promise<string | null>;
  private readonly refreshMs: number;
  private readonly now: () => number;

  constructor(options: { read: (botId: string) => Promise<string | null>; refreshMs?: number; now?: () => number }) {
    this.read = options.read;
    this.refreshMs = options.refreshMs ?? COMPANY_REFRESH_MS;
    this.now = options.now ?? Date.now;
  }

  get(botId: string): string | null {
    const entry = this.entries.get(botId);
    if (!entry || this.now() - entry.at >= this.refreshMs) void this.load(botId);
    return entry?.text ?? null;
  }

  /** A server-side write of `name` for this bot: company.md is read again,
   * and that read wins over one already running. */
  written(botId: string, name: string): void {
    if (name === COMPANY_TOPIC) void this.load(botId, true);
  }

  forget(botId: string): void {
    this.entries.delete(botId);
  }

  /** Read every bot ahead of its first turn (server start). */
  warm(botIds: readonly string[]): Promise<void> {
    return Promise.all(botIds.map((id) => this.load(id))).then(() => undefined);
  }

  private load(botId: string, fresh = false): Promise<void> {
    let entry = this.entries.get(botId);
    if (!entry) {
      entry = { text: null, at: Number.NEGATIVE_INFINITY, seq: 0 };
      this.entries.set(botId, entry);
    }
    if (entry.loading && !fresh) return entry.loading;
    const own = entry;
    const seq = ++own.seq;
    const settle = (text: string | null) => {
      // only the latest read started for this bot is kept
      if (seq !== own.seq) return;
      own.text = text;
      own.at = this.now();
    };
    // a locked or unreadable file shows nothing, and is read again later
    const loading: Promise<void> = this.read(botId).then(settle, () => settle(null)).finally(() => {
      if (own.loading === loading) own.loading = undefined;
    });
    own.loading = loading;
    return loading;
  }
}
