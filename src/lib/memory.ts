// The memory panel's client side: the wire types the server's memory
// routes answer with, the calls, and the pure wording helpers the panel
// renders from, kept here so the sentences can be tested without React.
import { ApiError, api } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

export const MEMORY_INDEX = "MEMORY.md";

export interface MemoryCapacity {
  lines: number;
  bytes: number;
  maxLines: number;
  maxBytes: number;
  loadedLines: number;
  loadedBytes: number;
  truncated: boolean;
  hash: string;
}

export interface MemoryFileInfo {
  path: string;
  name: string;
  bytes: number;
  modifiedAt: number;
}

export interface MemoryOverview {
  /** On an OMB Cloud home: this bot's memory changed in a conversation the
   * owner did not write; its turns cannot use a lent Mac until reviewed.
   * `changed` names the files (memory, or instruction files in its working
   * folders); `token` is exactly what was shown, and a review is refused
   * once anything changes again. */
  lendingReview?: LendingReview;
  botId: string;
  workspacePath: string;
  index: MemoryCapacity;
  topics: MemoryFileInfo[];
  logs: MemoryFileInfo[];
}

export interface MemoryDoc {
  path: string;
  text: string;
  hash: string;
  exists: boolean;
}

export type MemoryActor = "bot" | "person" | "import" | "upkeep";

/** A journal row as the server sends it: no prior text (that stays on
 * the server for the revert), but the chat title when the thread is known. */
export interface MemoryJournalRow {
  id: string;
  at: number;
  botId: string;
  path: string;
  actor: MemoryActor;
  via: string;
  threadId?: string;
  threadTitle?: string;
  kind: "created" | "edited" | "deleted";
  beforeHash: string | null;
  afterHash: string | null;
  diff: string;
  added: number;
  removed: number;
  canRevert: boolean;
  revertUnavailableReason?: string;
}

export type SaveResult =
  | { ok: true; doc: MemoryDoc; overview: MemoryOverview }
  | { ok: false; conflict: true; current: string; currentHash: string };

export function fetchMemoryOverview(botId: string): Promise<MemoryOverview> {
  return api(`/api/bots/${botId}/memory`);
}

export function fetchMemoryDoc(botId: string, path: string): Promise<MemoryDoc> {
  return api(`/api/bots/${botId}/memory/file?path=${encodeURIComponent(path)}`);
}

/** A 409 is an answer, not a failure: the bot wrote this file after the
 * editor opened it, and the panel has to show both versions. Every other
 * refusal throws the way api() does. */
export async function saveMemoryDoc(botId: string, path: string, text: string, expectedHash: string | undefined): Promise<SaveResult> {
  const response = await fetch(`/api/bots/${botId}/memory/file`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, text, expectedHash }),
  });
  // SAFETY: the server's JSON is narrowed field by field below
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 409 && typeof body.current === "string" && typeof body.currentHash === "string") {
    return { ok: false, conflict: true, current: body.current, currentHash: body.currentHash };
  }
  if (!response.ok) throw new ApiError(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`, response.status);
  // SAFETY: a 200 from PUT …/memory/file carries the saved document and the refreshed overview
  const saved = body as unknown as MemoryDoc & { overview: MemoryOverview };
  return { ok: true, doc: { path: saved.path, text: saved.text, hash: saved.hash, exists: saved.exists }, overview: saved.overview };
}

export function deleteMemoryDoc(botId: string, path: string): Promise<{ overview: MemoryOverview }> {
  return api(`/api/bots/${botId}/memory/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
}

export async function fetchMemoryJournal(botId: string, limit = 50): Promise<MemoryJournalRow[]> {
  const result: { entries: MemoryJournalRow[] } = await api(`/api/bots/${botId}/memory/journal?limit=${limit}`);
  return result.entries;
}

export function revertMemoryChange(botId: string, entryId: string): Promise<MemoryDoc & { overview: MemoryOverview }> {
  return api(`/api/bots/${botId}/memory/journal/${encodeURIComponent(entryId)}/revert`, { method: "POST" });
}

export interface TidyReport {
  at: number;
  expired: number;
  duplicates: number;
  superseded: number;
  deferred: number;
  organized?: number;
  contradictionsChecked: boolean;
  note?: string;
}

export interface CaptureReport {
  at: number;
  /** Facts appended to MEMORY.md. */
  added: number;
  /** Facts filed into topic files. */
  topics?: number;
  /** Facts added to About me. */
  aboutMe?: number;
  /** Facts memory already held: the "N already known" of the receipt. */
  known?: number;
  note?: string;
}

export interface UpkeepStatus {
  enabled: boolean;
  /** The engine can make the one-shot model call capture and contradictions need. */
  modelSteps: boolean;
  lastTidy?: TidyReport;
  lastCapture?: CaptureReport;
}

/** "3 facts" noticed last time, across MEMORY.md and topic files. */
export function noticedCount(report: CaptureReport | undefined): number {
  return report ? report.added + (report.topics ?? 0) : 0;
}

export function fetchUpkeepStatus(botId: string): Promise<UpkeepStatus> {
  return api(`/api/bots/${botId}/memory/upkeep`);
}

/** The owner accepts this bot's memory as it is now (OMB Cloud home only). */
export interface LendingReview {
  token: string;
  changed: string[];
}

export function markMemoryReviewed(botId: string, token: string): Promise<{ ok: true; lendingReview: false }> {
  return api(`/api/bots/${botId}/memory/reviewed`, { method: "POST", body: JSON.stringify({ token }) });
}

export function tidyMemoryNow(botId: string): Promise<{ report: TidyReport; overview: MemoryOverview }> {
  return api(`/api/bots/${botId}/memory/tidy`, { method: "POST" });
}

/** "Archived 1 expired note, merged 2 duplicates", or "Nothing to tidy". */
export function tidySummary(report: TidyReport): string {
  const parts: string[] = [];
  const part = (count: number | undefined, one: LocaleKey, many: LocaleKey) => {
    if (count) parts.push(t(count === 1 ? one : many, { count }));
  };
  part(report.expired, "memoryText.tidy.expiredOne", "memoryText.tidy.expired");
  part(report.duplicates, "memoryText.tidy.duplicatesOne", "memoryText.tidy.duplicates");
  part(report.superseded, "memoryText.tidy.supersededOne", "memoryText.tidy.superseded");
  part(report.organized, "memoryText.tidy.organizedOne", "memoryText.tidy.organized");
  const head = parts.length ? parts.join(", ") : t("memoryText.tidy.nothing");
  return head.charAt(0).toUpperCase() + head.slice(1);
}

export type MemoryOpenTarget = "obsidian" | "folder";

export function openMemoryLocation(botId: string, target: MemoryOpenTarget): Promise<{ ok: boolean; workspacePath: string }> {
  return api(`/api/bots/${botId}/memory/open`, { method: "POST", body: JSON.stringify({ target }) });
}

// ── wording ───────────────────────────────────────────────────────────

/** "749 B", "23.4 KB" ("749 o", "23,4 Ko" in French). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return t("memoryText.bytes", { count: bytes });
  const kb = Math.round(bytes / 102.4) / 10;
  let shown = String(kb);
  try {
    shown = new Intl.NumberFormat(activeLocale(), { maximumFractionDigits: 1 }).format(kb);
  } catch {
    /* an unknown locale keeps the plain number */
  }
  return t("memoryText.kilobytes", { count: shown });
}

/** "just now", "3 min ago", "2 hr ago", "yesterday", "Sep 3": the
 * journal is read for what happened recently, so recent rows get the
 * finer grain. */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return t("memoryText.when.justNow");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("memoryText.when.minutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("memoryText.when.hours", { count: hours });
  const days = Math.round(hours / 24);
  if (days === 1) return t("memoryText.when.yesterday");
  if (days < 7) return t("memoryText.when.days", { count: days });
  try {
    return new Date(at).toLocaleDateString(activeLocale(), { month: "short", day: "numeric" });
  } catch {
    return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

export type CapacityLevel = "ok" | "near" | "over";

export interface CapacityStatus {
  level: CapacityLevel;
  /** 0 to 1 of the line budget and of the byte budget; can exceed 1. */
  lineShare: number;
  byteShare: number;
  /** The one plain sentence the gauge always shows. */
  sentence: string;
  /** Only when over: how much is not loading, in the person's terms. */
  warning: string | null;
}

/** The gauge's line names the cut loadMemory makes silently. "Near"
 * starts at 80% of either budget so the person sees it coming rather than
 * finding out after a note stopped loading. */
export function capacityStatus(index: MemoryCapacity): CapacityStatus {
  const lineShare = index.maxLines ? index.lines / index.maxLines : 0;
  const byteShare = index.maxBytes ? index.bytes / index.maxBytes : 0;
  const level: CapacityLevel = index.truncated ? "over" : Math.max(lineShare, byteShare) >= 0.8 ? "near" : "ok";
  const sentence = t("memoryText.capacity.sentence", { maxLines: index.maxLines });
  let warning: string | null = null;
  if (index.truncated) {
    const missingLines = index.lines - index.loadedLines;
    warning = missingLines > 0
      ? t(missingLines === 1 ? "memoryText.capacity.missingOne" : "memoryText.capacity.missing", { count: missingLines })
      : t("memoryText.capacity.missingBytes", { loaded: formatBytes(index.loadedBytes), bytes: formatBytes(index.bytes) });
  }
  return { level, lineShare, byteShare, sentence, warning };
}

/** "MEMORY.md", "the clients topic", "the 2026-10-01 log". */
function topicLabel(path: string): string {
  if (path === MEMORY_INDEX) return "MEMORY.md";
  if (path.startsWith("memory/log/")) return t("memoryText.journal.log", { date: path.slice("memory/log/".length).replace(/\.md$/, "") });
  return t("memoryText.journal.topic", { name: path.replace(/^memory\//, "").replace(/\.md$/, "") });
}

const JOURNAL_KEYS = {
  created: ["memoryText.journal.created", "memoryText.journal.created"],
  createdWith: ["memoryText.journal.createdWithOne", "memoryText.journal.createdWith"],
  deleted: ["memoryText.journal.deleted", "memoryText.journal.deleted"],
  added: ["memoryText.journal.addedOne", "memoryText.journal.added"],
  removed: ["memoryText.journal.removedOne", "memoryText.journal.removed"],
  rewrote: ["memoryText.journal.rewroteOne", "memoryText.journal.rewrote"],
} as const satisfies Record<string, readonly [LocaleKey, LocaleKey]>;

/** "Scout added 2 lines to MEMORY.md", "You removed the clients topic",
 * "Scout rewrote 3 lines in MEMORY.md": what the row means, not which
 * fields it has. Each language orders the words its own way. */
export function journalSummary(row: MemoryJournalRow, botName: string): string {
  const who = row.actor === "bot" ? botName
    : t(row.actor === "import" ? "memoryText.journal.import" : row.actor === "upkeep" ? "memoryText.journal.upkeep" : "memoryText.journal.you");
  const topic = topicLabel(row.path);
  const say = (kind: keyof typeof JOURNAL_KEYS, count = 0) => {
    const text = t(JOURNAL_KEYS[kind][count === 1 ? 0 : 1], { who, topic, count });
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  if (row.kind === "created") return row.added ? say("createdWith", row.added) : say("created");
  if (row.kind === "deleted") return say("deleted");
  if (row.added && !row.removed) return say("added", row.added);
  if (row.removed && !row.added) return say("removed", row.removed);
  return say("rewrote", Math.max(row.added, row.removed));
}

/** Where the change came from, as the second clause of the row. */
export function journalSource(row: MemoryJournalRow): string | null {
  if (row.via === "revert") return t("memoryText.source.undo");
  if (row.via === "disk") return t("memoryText.source.disk");
  if (row.via === "tidy") return t("memoryText.source.tidy");
  if (row.via === "organize") return t("memoryText.source.organize");
  if (row.via === "capture") return row.threadTitle ? t("memoryText.source.capturedIn", { title: row.threadTitle }) : t("memoryText.source.captured");
  if (row.threadTitle) return t("memoryText.source.fromChat", { title: row.threadTitle });
  if (row.actor === "bot") return t("memoryText.source.task");
  if (row.via === "ui") return t("memoryText.source.settings");
  if (row.via === "api") return t("memoryText.source.api");
  return null;
}

export function fileManagerLabel(platform: string | undefined): string {
  if (platform === "darwin") return t("memoryText.showInFinder");
  if (platform === "win32") return t("memoryText.showInExplorer");
  return t("memoryText.showInFileManager");
}

/** A new topic's file name from whatever the person typed: spaces and
 * odd punctuation become dashes, the .md is added, and anything that
 * still fails the server's name gate is refused up front. */
export function topicFileName(input: string): string | null {
  const stem = input.trim().replace(/\.md$/i, "").replace(/[^\w .-]+/g, "-").replace(/^[^\w]+/, "").trim();
  if (!stem) return null;
  return `${stem}.md`;
}
