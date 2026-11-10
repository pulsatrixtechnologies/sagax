// Pending approvals older than N days leave the inbox (#1940).
//
// A card waiting on the person (permission, question, inter-bot / request)
// used to sit forever when expiresAt was null. This policy gives every open
// card an age: after N days it expires on its own (status "expired", never a
// person's deny), the waiting turn hears a plain note, and the inbox drops it.
//
// Resolution order for N: per-person override, then organization setting,
// then SAGAX_PENDING_APPROVAL_EXPIRE_DAYS, then 7. 0 means never expire.
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

/** Plain note the waiting bot / requester reads when a card expires by age. */
export function pendingApprovalExpiryNote(days: number, locale: "en" | "fr" = "en"): string {
  if (locale === "fr") {
    return `Cette approbation a expiré après ${days} jours sans réponse; redemande-la si elle est encore nécessaire.`;
  }
  return `This approval expired after ${days} days without an answer; ask again if it is still needed.`;
}

/** Locale keys for the note and the setting label (en source; fr in catalogs). */
export const PENDING_APPROVAL_EXPIRY_I18N = {
  note: "approval.pending.expiredNote",
  setting: "settings.org.pendingApprovalExpireDays",
  settingPerson: "settings.me.pendingApprovalExpireDays",
} as const;

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
  localeFor?: (threadId: string) => "en" | "fr";
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

/** Expire one open card by age. Returns true when it expired. */
export function expirePendingApprovalIfDue(deps: PendingExpiryDeps, row: PendingExpiryRow): boolean {
  const card = row.message.card;
  if (!cardOpen(card)) return false;
  const days = deps.daysFor(row);
  const now = deps.now?.() ?? Date.now();
  const createdAt = createdAtOf(row.message, card);
  if (!isPendingApprovalPastExpiry(createdAt, days, now)) return false;

  const requestId = card.requestId!;
  const note = pendingApprovalExpiryNote(days, deps.localeFor?.(row.threadId) ?? "en");
  // Status "expired" only: do not set answered to a person's deny.
  deps.patch(row.threadId, row.message.id, { ...card, expired: true, options: [] });
  try {
    void deps.release({ threadId: row.threadId, requestId, messageId: row.message.id, card, note });
  } catch {
    // The live request may already be gone; the card is closed either way.
  }
  deps.note(row.threadId, note);
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

/** Sweep every open inbox card past its age. Returns how many expired. */
export function sweepPendingApprovalExpiry(deps: PendingExpiryDeps): number {
  let expired = 0;
  for (const row of deps.open()) {
    if (expirePendingApprovalIfDue(deps, row)) expired += 1;
  }
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
