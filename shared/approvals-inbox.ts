// The Approvals screen (2026-10-19): every card waiting on the person, from
// every bot and room, in one list with the full context of the one picked.
// The server builds the list (server/routes/approvals-inbox.ts): what the
// viewer may decide, what waits for an organization admin, and, for a team
// manager, what waits on the people of their teams. This file holds the
// wire shape and the pure pieces both sides read: filters, the address
// they live in, ages, what a bulk answer may cover.
//
// Never an id on screen: `key`, `threadId` and `requestId` route answers
// and selection, nothing more.
import type { ApprovalRisk } from "./approval-describe.ts";
import type { ServedWaitingItem } from "./waiting-item.ts";

/** Whose card it is, from the viewer's side. */
export type InboxScope = "mine" | "org" | "team";
/** What the card asks for. A proposal (a routine, a skill, a profile, a
 * team setup, a model, a proactive offer) is answered on its own card,
 * never in bulk. 2026-11-08 (#2689, the Today box): "attention" is a bot's
 * "needs you" card (shared/person-attention.ts), answered by a reply in the
 * conversation or marked handled. */
export type InboxKind = "permission" | "question" | "proposal" | "attention";
/** Where the action would run, in plain words on the client. */
export type InboxDestination = "computer" | "vm" | "sandbox" | "server" | "cloud" | "browser";
/** Why a card is left out of a bulk answer. */
export type InboxBulkRefusal = "question" | "proposal" | "needs-key" | "confidential" | "not-yours" | "special";

export interface InboxApproval {
  /** `${threadId}:${requestId}`: selection, the address, the bulk set */
  key: string;
  threadId: string;
  requestId: string;
  botId: string;
  botName: string;
  /** a room's name when the card was raised there */
  roomName?: string;
  /** the conversation's own title, when it has one */
  threadTitle?: string;
  /** 2026-11-04: the routine whose run raised the card (its hidden task),
   * so the row names the routine as well as the bot */
  routineName?: string;
  scope: InboxScope;
  kind: InboxKind;
  /** #2689: a proactive proposal, answered by POST /api/bots/:botId/proactive/:proactiveId */
  proactiveId?: string;
  /** when the card was raised (ms) */
  at: number;
  risk?: ApprovalRisk;
  /** the provider's tool, for the plain title (never shown raw) */
  tool?: string;
  toolHints?: { readOnly?: boolean; destructive?: boolean };
  /** the viewer may answer it here */
  decidable: boolean;
  /** who answers it when the viewer cannot */
  waitingOn?: "owner" | "admin";
  waitingOnName?: string;
  /** whose bot it is, on an organization server */
  ownerName?: string;
  /** an Allow asks for one of the viewer's security keys */
  needsKey?: boolean;
  /** may be answered in a bulk Allow or Deny, or why not */
  bulk: true | InboxBulkRefusal;
  /** 2026-10-19 ("Toujours permettre" in bulk too): what Always allow
   * would keep for this card, in plain words (the card's own scope), when
   * a bulk Always allow may keep it. */
  alwaysRule?: string;
  /** 2026-10-20 (security review): the kind of rule it keeps (tool, scope
   * keys, destructive kind, situation): a bulk Always allow takes cards of
   * one kind only, the same action on targets of the same type. */
  alwaysKind?: string;
  confidential?: boolean;
  destination?: InboxDestination;
  /** #2936: the chat message holding the card, so "Open {bot}'s chat"
   * lands on it (the same as a notification's cardId), even on a row the
   * viewer cannot decide (no `message` then). */
  messageId?: string;
  /** The card's message, exactly as the conversation shows it to the
   * viewer, so the screen draws it with the conversation's own
   * components. Only on cards the viewer may decide. */
  message?: unknown;
}

export interface InboxHistoryEntry {
  at: string;
  /** user-approved, user-denied, user-undone, expired (decision-log DecisionKind) */
  decision: string;
  /** a question's answer, not a permission's */
  question?: true;
  /** the person who answered, as the activity log names them */
  who: string;
  botName?: string;
  tool?: string;
  summary?: string;
  via?: "call" | "console";
  threadId: string;
  requestId?: string;
}

export interface InboxPayload {
  pending: InboxApproval[];
  history: InboxHistoryEntry[];
  /** which scope chips make sense here (solo servers have neither) */
  scopes: { org: boolean; team: boolean };
  /** #3512: with ?waiting=1, what waits on the person, read from `pending`, each with its message (#3543)
   * (shared/waiting-items.ts). */
  waiting?: ServedWaitingItem[];
}

export const INBOX_BULK_MAX = 50;
export const INBOX_HISTORY_MAX = 300;

export function inboxKey(threadId: string, requestId: string): string {
  return `${threadId}:${requestId}`;
}

// ── filters ─────────────────────────────────────────────────────────────

export type InboxScopeFilter = "all" | InboxScope;
export type InboxKindFilter = "permission" | "question";
/** 2026-10-26: the Journal tab, beside the History (shared/action-journal.ts). */
export type InboxTab = "pending" | "history" | "journal";

export interface InboxFilters {
  tab: InboxTab;
  scope: InboxScopeFilter;
  /** a bot id, or empty */
  bot: string;
  /** empty: both */
  kind: InboxKindFilter | "";
  risky: boolean;
  /** the history search */
  q: string;
}

export const DEFAULT_INBOX_FILTERS: InboxFilters = { tab: "pending", scope: "all", bot: "", kind: "", risky: false, q: "" };

/** A card that deserves a second look: it deletes or runs something, waits
 * for an organization admin, or needs a security key. */
export function inboxRisky(entry: Pick<InboxApproval, "risk" | "needsKey" | "waitingOn">): boolean {
  return entry.risk === "destructive" || entry.risk === "execute" || entry.needsKey === true || entry.waitingOn === "admin";
}

/** Every filter at once (AND): scope, bot, type and risk. A proposal is
 * a permission for the type filter: it asks for an Allow too. */
export function filterInbox(entries: readonly InboxApproval[], filters: InboxFilters): InboxApproval[] {
  return entries.filter((entry) => {
    if (filters.scope !== "all" && entry.scope !== filters.scope) return false;
    if (filters.bot && entry.botId !== filters.bot) return false;
    // a bot's "needs you" card is something it asks the person (#2689)
    if (filters.kind === "question" && entry.kind !== "question" && entry.kind !== "attention") return false;
    if (filters.kind === "permission" && (entry.kind === "question" || entry.kind === "attention")) return false;
    if (filters.risky && !inboxRisky(entry)) return false;
    return true;
  });
}

/** Oldest waiting first: the one that has held a bot the longest is the
 * one to answer next. */
export function sortInbox(entries: readonly InboxApproval[]): InboxApproval[] {
  return [...entries].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

/** The history rows that match a free-text search (bot, person, tool,
 * summary, decision), newest first. */
export function searchInboxHistory(rows: readonly InboxHistoryEntry[], q: string): InboxHistoryEntry[] {
  const needle = q.trim().toLowerCase();
  const out = needle
    ? rows.filter((row) => [row.botName, row.who, row.tool, row.summary, row.decision]
      .some((field) => typeof field === "string" && field.toLowerCase().includes(needle)))
    : [...rows];
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

const SCOPES: readonly InboxScopeFilter[] = ["all", "mine", "org", "team"];

/** The filters, as the part of the address after `#approvals`. Defaults are
 * left out, so the plain screen is just `#approvals`. */
export function inboxHash(filters: InboxFilters): string {
  const params = new URLSearchParams();
  if (filters.tab !== "pending") params.set("tab", filters.tab);
  if (filters.scope !== "all") params.set("scope", filters.scope);
  if (filters.bot) params.set("bot", filters.bot);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.risky) params.set("risky", "1");
  if (filters.tab !== "pending" && filters.q.trim()) params.set("q", filters.q.trim().slice(0, 200));
  const query = params.toString();
  return query ? `#approvals?${query}` : "#approvals";
}

/** Whether an address opens the Approvals screen. */
export function isInboxHash(hash: string): boolean {
  return /^#approvals(?:\?|$)/.test(hash);
}

/** The filters an address carries; anything unknown falls back to its
 * default rather than failing. */
export function parseInboxHash(hash: string): InboxFilters {
  if (!isInboxHash(hash)) return { ...DEFAULT_INBOX_FILTERS };
  const at = hash.indexOf("?");
  const params = new URLSearchParams(at >= 0 ? hash.slice(at + 1) : "");
  const scope = params.get("scope") as InboxScopeFilter | null;
  const kind = params.get("kind");
  const bot = params.get("bot") ?? "";
  return {
    tab: params.get("tab") === "history" ? "history" : params.get("tab") === "journal" ? "journal" : "pending",
    scope: scope && SCOPES.includes(scope) ? scope : "all",
    bot: /^[\w-]{1,80}$/.test(bot) ? bot : "",
    kind: kind === "permission" || kind === "question" ? kind : "",
    risky: params.get("risky") === "1",
    q: (params.get("q") ?? "").slice(0, 200),
  };
}

// ── age ─────────────────────────────────────────────────────────────────

export type InboxAgeTone = "fresh" | "aging" | "stale";

/** Green under an hour, amber under a day, red beyond. */
export function inboxAgeTone(at: number, now: number): InboxAgeTone {
  const age = Math.max(0, now - at);
  if (age < 60 * 60_000) return "fresh";
  if (age < 24 * 60 * 60_000) return "aging";
  return "stale";
}

/** The age in its largest whole unit: { n, unit }, for "3 min", "2 h", "4 d". */
export function inboxAge(at: number, now: number): { n: number; unit: "now" | "min" | "h" | "d" } {
  const age = Math.max(0, now - at);
  if (age < 60_000) return { n: 0, unit: "now" };
  if (age < 60 * 60_000) return { n: Math.floor(age / 60_000), unit: "min" };
  if (age < 24 * 60 * 60_000) return { n: Math.floor(age / (60 * 60_000)), unit: "h" };
  return { n: Math.floor(age / (24 * 60 * 60_000)), unit: "d" };
}

// ── bulk ────────────────────────────────────────────────────────────────

/** What a bulk Allow or Deny of `selected` would answer, and what it leaves
 * for one at a time. A Deny never needs a key, so a card left out of a bulk
 * Allow for its key can still be in a bulk Deny. */
export function bulkPlan(selected: readonly InboxApproval[], decision: "allow" | "deny"): {
  answered: InboxApproval[];
  skipped: Array<{ entry: InboxApproval; reason: InboxBulkRefusal }>;
} {
  const answered: InboxApproval[] = [];
  const skipped: Array<{ entry: InboxApproval; reason: InboxBulkRefusal }> = [];
  for (const entry of selected.slice(0, INBOX_BULK_MAX)) {
    if (!entry.decidable) skipped.push({ entry, reason: "not-yours" });
    else if (entry.bulk === true) answered.push(entry);
    else if (entry.bulk === "needs-key" && decision === "deny") answered.push(entry);
    else skipped.push({ entry, reason: entry.bulk });
  }
  return { answered, skipped };
}
