// Direct triggers (#2691, 2026-11-08): each bot can be woken directly by an
// email, a calendar invitation or a text, with declarative filters.
//
// Before, every event of these channels went through the bot's proactive
// switch alone (shared/proactive-mode.ts), so a person could not say "wake
// Melonie on mail from the client, not on newsletters", and a text from
// someone else than the owner woke nothing when the bot had no Bot phone
// trigger. A channel setting:
// - absent: the channel follows the bot's proactive switch (as before);
// - on: the channel wakes the bot even when the switch is off;
// - off: the channel never wakes the bot.
// Filters apply whenever the channel wakes. The wake itself stays the
// proactive one (server/proactive/proactive-wake.ts): the bot's one
// conversation, its approval level, a relayed source confined (S2).
//
// Filter syntax, one line, comma separated, case-insensitive:
//   from:*@client.com      the sender (address or number) matches the glob
//   -from:noreply@*        never this sender
//   facture                the subject or text contains the word
//   -infolettre            never when it contains the word
// `de:` is accepted for `from:`. Exclusions always win. With `from:` terms
// the sender must match one; with words, one word must appear.

export const DIRECT_CHANNELS = ["mail", "calendar", "sms"] as const;
export type DirectChannel = (typeof DIRECT_CHANNELS)[number];

export interface DirectChannelSetting {
  on: boolean;
  /** The declarative filter line, "" for none. */
  filters?: string;
}

export type DirectTriggers = Partial<Record<DirectChannel, DirectChannelSetting>>;

export const DIRECT_FILTERS_MAX = 500;

export function isDirectChannel(value: unknown): value is DirectChannel {
  return typeof value === "string" && (DIRECT_CHANNELS as readonly string[]).includes(value);
}

/** A client value as stored, or a reason it is refused. `null` clears. */
export function normalizeDirectTriggers(value: unknown): { ok: true; value: DirectTriggers | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "directTriggers must be an object" };
  const out: DirectTriggers = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isDirectChannel(key)) return { ok: false, error: `unknown direct trigger channel: ${key.slice(0, 32)}` };
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `directTriggers.${key} must be an object` };
    const { on, filters } = raw as { on?: unknown; filters?: unknown };
    if (typeof on !== "boolean") return { ok: false, error: `directTriggers.${key}.on must be true or false` };
    if (filters !== undefined && typeof filters !== "string") return { ok: false, error: `directTriggers.${key}.filters must be text` };
    const line = (filters ?? "").replace(/\s+/g, " ").trim();
    if (line.length > DIRECT_FILTERS_MAX) return { ok: false, error: `directTriggers.${key}.filters is too long` };
    out[key] = line ? { on, filters: line } : { on };
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

export interface DirectFilters {
  from: string[];
  notFrom: string[];
  words: string[];
  notWords: string[];
}

export function parseDirectFilters(line: string | undefined): DirectFilters {
  const filters: DirectFilters = { from: [], notFrom: [], words: [], notWords: [] };
  for (const raw of (line ?? "").split(",")) {
    let term = raw.trim().toLowerCase();
    if (!term) continue;
    const negative = term.startsWith("-");
    if (negative) term = term.slice(1).trim();
    const sender = /^(?:from|de)\s*:\s*(.+)$/.exec(term);
    if (sender) {
      (negative ? filters.notFrom : filters.from).push(sender[1]!.trim());
    } else if (term) {
      (negative ? filters.notWords : filters.words).push(term);
    }
  }
  return filters;
}

function globMatch(pattern: string, value: string): boolean {
  const source = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`, "i").test(value);
}

/** Digits only for phone numbers, so "+1 819 555 0101" matches "*5550101". */
function senderForms(sender: string): string[] {
  const lower = sender.trim().toLowerCase();
  const digits = lower.replace(/[^\d+]/g, "");
  return digits && digits !== lower && /^\+?\d{4,}$/.test(digits) ? [lower, digits] : [lower];
}

/** Whether an event passes the filter line. An empty line passes. */
export function directFiltersPass(line: string | undefined, event: { from?: string; text: string }): boolean {
  const filters = parseDirectFilters(line);
  const forms = event.from ? senderForms(event.from) : [];
  const text = event.text.toLowerCase();
  const senderIs = (pattern: string) => {
    // a phone pattern ("+1 819 555 0101", "*5550101") also compares by digits
    const digits = pattern.replace(/[^\d+*]/g, "");
    const phone = /\d{4,}/.test(digits) && !/[a-z@]/i.test(pattern);
    return forms.some((form) => globMatch(pattern, form) || (phone && globMatch(digits, form)));
  };
  if (filters.notFrom.some(senderIs)) return false;
  if (filters.notWords.some((word) => text.includes(word))) return false;
  if (filters.from.length && !filters.from.some(senderIs)) return false;
  if (filters.words.length && !filters.words.some((word) => text.includes(word))) return false;
  return true;
}

/** The direct channel of a proactive event source, or null for the others. */
export function directChannelOf(source: string): DirectChannel | null {
  return source === "mail" || source === "calendar" || source === "sms" ? source : null;
}

export type DirectWakeVerdict = "wake" | "off" | "filtered";

/** Whether this event wakes the bot: the channel's own setting first, else
 * the proactive switch. Events of other sources follow the switch alone. */
export function directWakeVerdict(
  bot: { directTriggers?: DirectTriggers | null },
  proactiveOn: boolean,
  source: string,
  event: { from?: string; text: string },
): DirectWakeVerdict {
  const channel = directChannelOf(source);
  const setting = channel ? bot.directTriggers?.[channel] : undefined;
  if (!setting) return proactiveOn ? "wake" : "off";
  if (!setting.on) return "off";
  return directFiltersPass(setting.filters, event) ? "wake" : "filtered";
}

/** A mail that carries a calendar invitation, update or cancellation. */
export function mailIsCalendarInvite(attachments: readonly { name: string; type: string }[]): boolean {
  return attachments.some((item) => /text\/calendar|application\/ics/i.test(item.type) || /\.ics$/i.test(item.name));
}
