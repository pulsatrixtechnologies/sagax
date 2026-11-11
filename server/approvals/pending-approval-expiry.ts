// Pending approvals older than N days leave the inbox (#1940).
//
// A card waiting on the person (permission, question, inter-bot / request)
// used to sit forever when expiresAt was null. This policy gives every open
// card an age: after N days it expires on its own (status "expired", never a
// person's deny), the waiting turn hears a plain note, and the inbox drops it.
//
// Resolution order for N: per-person override, then organization setting,
// then SAGAX_PENDING_APPROVAL_EXPIRE_DAYS, then 7. 0 means never expire.
import en from "../../src/locales/en.json" with { type: "json" };
import fr from "../../src/locales/fr.json" with { type: "json" };
import type { Message } from "../store.ts";

export const DEFAULT_PENDING_APPROVAL_EXPIRE_DAYS = 7;
export const PENDING_APPROVAL_EXPIRE_DAYS_MAX = 365;
export const PENDING_APPROVAL_EXPIRE_ENV = "SAGAX_PENDING_APPROVAL_EXPIRE_DAYS";
export const DAY_MS = 86_400_000;

/** Whole days from 0 (never) to 365, or null when the value is not usable. */
export function parsePendingApprovalExpireDays(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0 || raw > PENDING_APPROVAL_EXPIRE_DAYS_MAX) return null;
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0 || n > PENDING_APPROVAL_EXPIRE_DAYS_MAX) return null;
    return n;
  }
  return null;
}

/** Effective days: person > org > env > default 7. 0 = never. */
export function pendingApprovalExpireDays(input: {
  personDays?: number | null;
  orgDays?: number | null;
  env?: NodeJS.ProcessEnv;
} = {}): number {
  const person = parsePendingApprovalExpireDays(input.personDays ?? undefined);
  if (person !== null) return person;
  const org = parsePendingApprovalExpireDays(input.orgDays ?? undefined);
  if (org !== null) return org;
  const fromEnv = parsePendingApprovalExpireDays(input.env?.[PENDING_APPROVAL_EXPIRE_ENV] ?? process.env[PENDING_APPROVAL_EXPIRE_ENV]);
  if (fromEnv !== null) return fromEnv;
  return DEFAULT_PENDING_APPROVAL_EXPIRE_DAYS;
}

/** Absolute expiry instant, or null when the policy is "never" (0 days). */
export function pendingApprovalExpiresAt(createdAt: number, days: number): number | null {
  if (!Number.isFinite(createdAt) || days <= 0) return null;
  return createdAt + days * DAY_MS;
}

/** True when the card's age is past the policy window. 0 days never expires. */
export function isPendingApprovalPastExpiry(createdAt: number, days: number, now = Date.now()): boolean {
  if (days <= 0 || !Number.isFinite(createdAt)) return false;
  return now >= createdAt + days * DAY_MS;
}

/** Locale keys for the note and the setting label (en source; fr in catalogs). */
export const PENDING_APPROVAL_EXPIRY_I18N = {
  note: "approval.pending.expiredNote",
  noteMany: "approval.pending.expiredNoteMany",
  noteManyTitled: "approval.pending.expiredNoteManyTitled",
  setting: "settings.org.pendingApprovalExpireDays",
  settingPerson: "settings.me.pendingApprovalExpireDays",
} as const;

/** The language of the person who owns a conversation ("fr", "en", ...). */
export type ExpiryLocale = string;

const CATALOGS: Readonly<Record<string, Readonly<Record<string, string>>>> = { en, fr };

function catalogText(locale: ExpiryLocale | undefined, key: string): string {
  const tag = (locale ?? "").trim().toLowerCase().split("-")[0] ?? "";
  return CATALOGS[tag]?.[key] ?? (en as Record<string, string>)[key] ?? key;
}

/** Plain note the waiting bot / requester reads when a card expires by age
 * (#3471: every waiting card, not approvals only), from the locale
 * catalogs in the language of the person who owns the conversation (#3522). */
export function pendingApprovalExpiryNote(days: number, locale: ExpiryLocale = "en"): string {
  return catalogText(locale, PENDING_APPROVAL_EXPIRY_I18N.note).replace("{days}", String(days));
}

/** At most this many titles name the requests of one summary line. */
export const EXPIRY_NOTE_TITLES_MAX = 3;
const EXPIRY_TITLE_MAX = 80;

/** #3522: the one line a conversation gets when several of its requests
 * expire in the same pass: how many, and the titles of the first three. */
export function pendingApprovalExpirySummary(count: number, days: number, titles: readonly string[], locale: ExpiryLocale = "en"): string {
  if (count <= 1) return pendingApprovalExpiryNote(days, locale);
  const named = titles
    .map((title) => title.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, EXPIRY_NOTE_TITLES_MAX)
    .map((title) => (title.length > EXPIRY_TITLE_MAX ? `${title.slice(0, EXPIRY_TITLE_MAX - 3).trimEnd()}...` : title));
  const key = named.length ? PENDING_APPROVAL_EXPIRY_I18N.noteManyTitled : PENDING_APPROVAL_EXPIRY_I18N.noteMany;
  return catalogText(locale, key)
    .replace("{count}", String(count))
    .replace("{days}", String(days))
    .replace("{titles}", named.join(", "));
}

/** #3522: the expiry lines of one pass, one per conversation. A request
 * seen twice (two rows, or two sweeps of the same pass) counts once; when
 * the pass ends, each conversation gets one line: the plain note for one
 * request, the count and the first titles for several. */
export class ExpiryNotes {
  private readonly byThread = new Map<string, { days: number; locale: ExpiryLocale; titles: string[]; keys: Set<string> }>();

  /** False when this request already has its line in this pass. */
  add(threadId: string, entry: { key: string; days: number; locale: ExpiryLocale; title?: string }): boolean {
    let slot = this.byThread.get(threadId);
    if (!slot) {
      slot = { days: entry.days, locale: entry.locale, titles: [], keys: new Set() };
      this.byThread.set(threadId, slot);
    }
    if (slot.keys.has(entry.key)) return false;
    slot.keys.add(entry.key);
    if (entry.title?.trim()) slot.titles.push(entry.title);
    return true;
  }

  /** Write each conversation's one line, then forget them. */
  flush(write: (threadId: string, text: string) => void): void {
    const slots = [...this.byThread];
    this.byThread.clear();
    for (const [threadId, slot] of slots) {
      try {
        write(threadId, pendingApprovalExpirySummary(slot.keys.size, slot.days, slot.titles, slot.locale));
      } catch {
        // the requests are closed either way
      }
    }
  }
}

export interface PendingExpiryRow {
  threadId: string;
  message: Message;
}

export interface PendingExpiryDeps {
  /** Open inbox cards (permission, question, request): requestId set, not answered/dismissed/expired. */
  open: () => PendingExpiryRow[];
  /** Policy days for this card's owner (0 = never). */
  daysFor: (row: PendingExpiryRow) => number;
  now?: () => number;
  patch: (threadId: string, messageId: string, card: NonNullable<Message["card"]>) => void;
  /** Plain note into the waiting thread for the requester (the bot). */
  note: (threadId: string, text: string) => void;
  /** Release the turn the same way a denial-without-answer would (no action taken). */
  release: (row: {
    threadId: string;
    requestId: string;
    messageId: string;
    card: NonNullable<Message["card"]>;
    note: string;
  }) => void | Promise<void>;
  /** Decision log: decision "expired" (never counted as denied). */
  journal: (row: {
    threadId: string;
    requestId: string;
    tool?: string;
    summary?: string;
    botId?: string;
    botName?: string;
  }) => void;
  withdraw?: (threadId: string, requestId: string) => void;
  botOf?: (threadId: string) => { id?: string; name?: string } | undefined;
  localeFor?: (threadId: string) => ExpiryLocale;
}

function cardOpen(card: Message["card"] | undefined): card is NonNullable<Message["card"]> {
  return Boolean(card?.requestId && !card.approvalOrigin && !card.answered && !card.dismissed && !card.expired);
}

function createdAtOf(message: Message, card: NonNullable<Message["card"]>): number {
  if (typeof message.at === "number" && Number.isFinite(message.at)) return message.at;
  if (typeof card.expiresAt === "number" && Number.isFinite(card.expiresAt)) {
    // Older cards sometimes only carried expiresAt; without createdAt, treat
    // a past expiresAt as already due when the age policy also says so.
    return card.expiresAt;
  }
  return 0;
}

/** Expire one open card by age. Returns true when it expired. With
 * `notes`, its line joins the pass's one line for that conversation
 * (written when the pass flushes them); a second row of a request already
 * expired in this pass closes without a second line, release or journal. */
export function expirePendingApprovalIfDue(deps: PendingExpiryDeps, row: PendingExpiryRow, notes?: ExpiryNotes): boolean {
  const card = row.message.card;
  if (!cardOpen(card)) return false;
  const days = deps.daysFor(row);
  const now = deps.now?.() ?? Date.now();
  const createdAt = createdAtOf(row.message, card);
  if (!isPendingApprovalPastExpiry(createdAt, days, now)) return false;

  const requestId = card.requestId!;
  const locale = deps.localeFor?.(row.threadId) ?? "en";
  const note = pendingApprovalExpiryNote(days, locale);
  // Status "expired" only: do not set answered to a person's deny.
  deps.patch(row.threadId, row.message.id, { ...card, expired: true, options: [] });
  if (notes && !notes.add(row.threadId, { key: `request:${requestId}`, days, locale, title: card.title })) return true;
  try {
    void deps.release({ threadId: row.threadId, requestId, messageId: row.message.id, card, note });
  } catch {
    // The live request may already be gone; the card is closed either way.
  }
  if (!notes) deps.note(row.threadId, note);
  const bot = deps.botOf?.(row.threadId);
  deps.journal({
    threadId: row.threadId,
    requestId,
    tool: card.tool,
    summary: card.subtitle,
    botId: bot?.id,
    botName: bot?.name,
  });
  deps.withdraw?.(row.threadId, requestId);
  return true;
}

/** Sweep every open inbox card past its age. Returns how many expired.
 * #3522: each conversation gets one line for the pass. Given `notes`, the
 * caller flushes them (one pass over both sweeps); else this sweep does. */
export function sweepPendingApprovalExpiry(deps: PendingExpiryDeps, notes?: ExpiryNotes): number {
  const batch = notes ?? new ExpiryNotes();
  let expired = 0;
  for (const row of deps.open()) {
    if (expirePendingApprovalIfDue(deps, row, batch)) expired += 1;
  }
  if (!notes) batch.flush(deps.note);
  return expired;
}

/** expiresAt clients should see: the card's own instant, else createdAt + policy. */
export function visiblePendingExpiresAt(input: {
  cardExpiresAt: number | null | undefined;
  createdAt: number | null | undefined;
  days: number;
}): number | null {
  if (typeof input.cardExpiresAt === "number" && Number.isFinite(input.cardExpiresAt)) return input.cardExpiresAt;
  if (typeof input.createdAt === "number" && Number.isFinite(input.createdAt)) {
    return pendingApprovalExpiresAt(input.createdAt, input.days);
  }
  return null;
}

/** #3471: the kinds that are not option cards with a requestId, under the
 * same policy: a question in words a bot's work left (an input request row,
 * an attention card) and a proposal card. A proposal keeps its own shorter
 * life (`proposalMaxMs`, the proposal is gone after it), so it closes at the
 * sooner of the two. */
export interface WaitingRowExpiryDeps {
  /** Open person requests and open proposal cards, with their thread. */
  open: () => PendingExpiryRow[];
  daysFor: (row: PendingExpiryRow) => number;
  now?: () => number;
  /** Close a person request as expired with this note (waiting-card-skip.ts).
   * `quiet`: the request already had its line in this pass, close the row
   * only. `noteWork`: where a line kept in the work's thread goes (the
   * pass's one line per conversation, #3522). */
  closeRequest: (row: PendingExpiryRow, note: string, how?: { quiet?: boolean; noteWork?: (workThreadId: string, text: string) => void }) => boolean;
  /** Write a line into a thread (the pass's one line per conversation). */
  note?: (threadId: string, text: string) => void;
  /** Fold a proposal card as expired (nothing waits on it). */
  expireProposal: (row: PendingExpiryRow) => void;
  proposalMaxMs?: number;
  localeFor?: (threadId: string) => ExpiryLocale;
}

/** When a waiting row is due, given the policy days (0 = never). */
export function waitingRowDue(row: PendingExpiryRow, days: number, now: number, proposalMaxMs?: number): boolean {
  const at = row.message.at;
  if (!Number.isFinite(at)) return false;
  if (row.message.card?.proactiveProposal && proposalMaxMs !== undefined && now - at >= proposalMaxMs) return true;
  return isPendingApprovalPastExpiry(at, days, now);
}

/** The work thread a question in words waits in: one request per work
 * thread, whatever the number of rows that show it. */
function waitingRowWork(message: Message): string | undefined {
  return message.inputRequest?.threadId ?? message.attention?.threadId;
}

function waitingRowTitle(message: Message): string | undefined {
  return message.inputRequest?.question ?? message.attention?.items?.[0]?.text ?? message.attention?.threadTitle;
}

/** Sweep the waiting rows past their age. Returns how many closed.
 * #3522: the rows of one request (the same question shown in two
 * conversations and on a hand-off's card) close together with one line,
 * and each work thread gets one line for the pass. Given `notes`, the
 * caller flushes them; else this sweep does. */
export function sweepWaitingRowExpiry(deps: WaitingRowExpiryDeps, notes?: ExpiryNotes): number {
  const now = deps.now?.() ?? Date.now();
  const batch = notes ?? new ExpiryNotes();
  const seen = new Set<string>();
  let closed = 0;
  for (const row of deps.open()) {
    const days = deps.daysFor(row);
    if (!waitingRowDue(row, days, now, deps.proposalMaxMs)) continue;
    try {
      if (row.message.card?.proactiveProposal) {
        deps.expireProposal(row);
        closed += 1;
        continue;
      }
      const locale = deps.localeFor?.(row.threadId) ?? "en";
      const note = pendingApprovalExpiryNote(days, locale);
      const work = waitingRowWork(row.message);
      const quiet = work !== undefined && seen.has(work);
      // the line the waiting work did not take joins the pass's one line
      const noteWork = (workThreadId: string) => {
        batch.add(workThreadId, { key: `work:${work ?? row.message.id}`, days, locale, title: waitingRowTitle(row.message) });
      };
      if (deps.closeRequest(row, note, { quiet, noteWork })) {
        closed += 1;
        if (work !== undefined) seen.add(work);
      }
    } catch {
      // leave the row; the next sweep retries
    }
  }
  if (!notes && deps.note) batch.flush(deps.note);
  return closed;
}
