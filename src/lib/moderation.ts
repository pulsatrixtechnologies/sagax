// Content between people (App Store guideline 1.2, server/safety/moderation.ts):
// Report a message someone else wrote, Block a person (personal: their
// lines fold away for me only, on every device of mine), and the terms of
// use accepted once per account.
//
// The blocked list lives on the server (GET/POST/DELETE /api/me/blocks) so
// the desktop and the phone agree; this module keeps one copy for the page
// and hides nothing by itself: the transcript asks `isBlockedLine`.
import { useSyncExternalStore } from "react";
import { otherAuthorName } from "@/lib/viewer";

/** The store owns `api`. It binds that function once, so this module does
 * not import the store (#1381). */
export type ModerationApi = <T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number; stepUpTry?: "recent" | "fresh" },
) => Promise<T>;

let boundApi: ModerationApi | null = null;

export function bindModerationApi(next: ModerationApi): void {
  boundApi = next;
}

function callApi<T>(path: string, init?: Parameters<ModerationApi>[1]): Promise<T> {
  if (!boundApi) throw new Error("moderation api is not bound");
  return boundApi<T>(path, init);
}

type LineMessage = Parameters<typeof otherAuthorName>[0];
type LineConfig = Parameters<typeof otherAuthorName>[1];

/** The only group fields a blocked direct conversation needs. */
type BlockedDmGroup = {
  threadId?: string;
  peopleDm?: boolean;
  humanIds?: readonly string[];
  tasks?: readonly { threadId?: string }[] | null;
};

type BlockedDmState = {
  groups: readonly BlockedDmGroup[];
  config: { viewer?: { principalId?: string | null } | null } | null;
};

export const REPORT_REASONS = ["harassment", "hate", "sexual", "violence", "spam", "privacy", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const TERMS_URL = "https://pulsatrix.ca/terms";

export interface BlockedPerson {
  id: string;
  name: string;
  at: number;
}

export interface ModerationReport {
  id: string;
  at: number;
  threadId: string;
  messageId: string;
  groupId?: string;
  groupName?: string;
  peopleDm?: boolean;
  reportedId: string;
  reportedName: string;
  reportedKind: "person" | "bot";
  reason: ReportReason;
  note?: string;
  excerpt?: string;
  reporterId: string;
  reporterName: string;
  status: "open" | "resolved";
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface TermsStatus {
  accepted: boolean;
  current: string;
  url: string;
  version?: string;
  acceptedAt?: number;
}

/** The person behind another person's line, or null: your own lines, a
 * bot's, and a line nobody is named on. The key is the sender id the
 * server wrote (lowercased), the one the blocked list holds. */
export function personLineAuthor(message: LineMessage, config: LineConfig): { id: string; name: string } | null {
  if (message.role !== "user") return null;
  const name = otherAuthorName(message, config);
  if (name === null) return null;
  const id = message.sender?.id?.trim().toLowerCase();
  return id ? { id, name } : null;
}

// ---- the blocked list (one copy per page) -------------------------------

let blocked: readonly BlockedPerson[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: readonly BlockedPerson[]): void {
  blocked = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!loading) loading = loadBlockedPeople();
  return () => { listeners.delete(listener); };
}

/** Read the list again (start, a reconnect, another device's change). An
 * older server without the route keeps an empty list. */
export async function loadBlockedPeople(): Promise<void> {
  try {
    const answer = await callApi<{ people?: BlockedPerson[] }>("/api/me/blocks");
    publish(Array.isArray(answer.people) ? answer.people : []);
  } catch {
    /* an older server, or nobody signed in: nothing is folded away */
  }
}

export function useBlockedPeople(): readonly BlockedPerson[] {
  return useSyncExternalStore(subscribe, () => blocked, () => blocked);
}

export function isBlockedId(people: readonly BlockedPerson[], id: string | null | undefined): boolean {
  const key = id?.trim().toLowerCase();
  return Boolean(key) && people.some((person) => person.id === key);
}

/** Whether this line is from someone the viewer blocked. */
export function isBlockedLine(message: LineMessage, config: LineConfig, people: readonly BlockedPerson[]): boolean {
  if (!people.length) return false;
  const author = personLineAuthor(message, config);
  return author ? isBlockedId(people, author.id) : false;
}

export async function blockPerson(person: { id: string; name: string }): Promise<void> {
  const answer = await callApi<{ people: BlockedPerson[] }>("/api/me/blocks", {
    method: "POST",
    body: JSON.stringify({ id: person.id, name: person.name }),
  });
  publish(answer.people);
}

export async function unblockPerson(id: string): Promise<void> {
  const answer = await callApi<{ people: BlockedPerson[] }>(`/api/me/blocks/${encodeURIComponent(id)}`, { method: "DELETE" });
  publish(answer.people);
}

/** A direct conversation between two people whose other person this viewer
 * blocked: its new-message notice stays quiet. */
export function blockedDmSender(threadId: string, state: BlockedDmState): boolean {
  if (!blocked.length || !threadId) return false;
  const group = state.groups.find((entry) => entry.threadId === threadId || entry.tasks?.some((task) => task.threadId === threadId));
  if (!group?.peopleDm) return false;
  const me = state.config?.viewer?.principalId?.toLowerCase();
  const others = (group.humanIds ?? []).map((id) => id.toLowerCase()).filter((id) => id !== me);
  return others.length > 0 && others.every((id) => isBlockedId(blocked, id));
}

// ---- reports -----------------------------------------------------------

export async function reportMessage(input: { threadId: string; messageId: string; reason: ReportReason; note?: string }): Promise<void> {
  const note = input.note?.trim();
  await callApi(`/api/threads/${encodeURIComponent(input.threadId)}/messages/${encodeURIComponent(input.messageId)}/report`, {
    method: "POST",
    body: JSON.stringify({ reason: input.reason, ...(note ? { note } : {}) }),
  });
}

const reportListeners = new Set<() => void>();
/** A new report arrived (the live notice): an open list reads again. */
export function notifyReportsChanged(): void {
  for (const listener of reportListeners) listener();
}
export function onReportsChanged(listener: () => void): () => void {
  reportListeners.add(listener);
  return () => { reportListeners.delete(listener); };
}

/** Admins: every report, newest first. */
export async function fetchReports(): Promise<ModerationReport[]> {
  const answer = await callApi<{ reports?: ModerationReport[] }>("/api/moderation/reports");
  return Array.isArray(answer.reports) ? answer.reports : [];
}

export async function resolveReport(id: string): Promise<ModerationReport> {
  const answer = await callApi<{ report: ModerationReport }>(`/api/moderation/reports/${encodeURIComponent(id)}/resolve`, { method: "POST" });
  return answer.report;
}

// ---- terms of use --------------------------------------------------------

/** Null when the server has no such route (an older server): nothing to ask. */
export async function fetchTerms(): Promise<TermsStatus | null> {
  try {
    return await callApi<TermsStatus>("/api/me/terms");
  } catch {
    return null;
  }
}

export async function acceptTerms(version: string): Promise<TermsStatus> {
  return callApi<TermsStatus>("/api/me/terms", {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}
