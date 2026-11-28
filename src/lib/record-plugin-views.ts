// What the record windows of the other plugins read (M-20261127-141,
// M-20261127-146): a SentinelOne threat, an Axcient x360Recover protected
// system, a BookStack page, a Twilio conversation, an X post and a folder of
// files. Each is read through the record's detail route, like a ticket's tabs
// (GET /api/me/records/:product/:kind/:id/detail?section=..., src/lib/record-detail.ts):
//
// - `counts`: `{ counts: { <section>: n }, actions: [...] }`, the tabs' counts
//   and the writes the console takes for the record;
// - `view`: one object, the record's overview (its verdict, its tiles, its page,
//   its post), the shape of its window below;
// - a list section (`timeline`, `notes`, `restore_points`, `conversation`, ...):
//   `{ lines: [...], next }`, read page by page like a ticket's.
//
// Every word is the console's, ready to show in the person's language: Sagax
// computes nothing it shows (a price, a total, a share) and parses tolerantly:
// an unknown field is dropped, a line without its key words is skipped, a
// value of the wrong type is absent. Nothing here invents a value: a part the
// console does not send is not drawn. A value shaped like a GUID is never a
// label on screen (the app's rule): such a fact or tile is left out.
import { isGuid } from "./record-card-format";
import { readXPost, type XPostView } from "../../shared/x-post";
import { RECORD_TONES, validRecordRef, type RecordRef, type RecordTone } from "../../shared/record-cards";

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** A ready text: a string (trimmed), or a finite number written as sent. */
export const textOf = (value: unknown, max = 4_000): string => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
};
const optionalText = (value: unknown, max?: number): string | undefined => textOf(value, max) || undefined;
const numberOf = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const shareOf = (value: unknown): number | undefined => {
  const share = numberOf(value);
  return share !== undefined && share >= 0 && share <= 100 ? share : undefined;
};
const toneOf = (value: unknown): RecordTone | undefined => (RECORD_TONES as readonly unknown[]).includes(value) ? value as RecordTone : undefined;
const refOf = (value: unknown): RecordRef | undefined => isObject(value) && validRecordRef(value as { product?: unknown; kind?: unknown; id?: unknown }) ? { product: String(value.product), kind: String(value.kind), id: String(value.id) } : undefined;
const instantOf = (value: unknown): string | undefined => {
  const raw = textOf(value, 64);
  return raw && /^\d{4}-\d{2}-\d{2}T/.test(raw) && Number.isFinite(Date.parse(raw)) ? raw : undefined;
};
const idOf = (value: unknown): string | undefined => {
  const id = textOf(value, 128);
  return /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? id : undefined;
};
const httpsOf = (value: unknown): string | undefined => {
  const raw = textOf(value, 2_048);
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};
const listOf = (value: unknown, most = 200): Raw[] => Array.isArray(value) ? value.filter(isObject).slice(0, most) : [];
const textsOf = (value: unknown, most = 24): string[] => Array.isArray(value) ? value.map((one) => textOf(one, 120)).filter(Boolean).slice(0, most) : [];
/** An object without its absent parts. */
const clean = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, one]) => one !== undefined && one !== "")) as T;

// ── shared parts ─────────────────────────────────────────────────────────

/** A labelled value (a file's path, a number's region). `code`: drawn as code. */
export interface ViewFact { label: string; value: string; code?: boolean; tone?: RecordTone; ref?: RecordRef }
/** A tile: a big value under its label, a quieter line under it. */
export interface ViewTile { label: string; value: string; detail?: string; tone?: RecordTone }
/** A step of a timeline or of a message's life. */
export interface ViewStep { id?: string; text: string; at?: string; when?: string; detail?: string; tone?: RecordTone }
export interface ViewPill { label: string; tone: RecordTone }

export function parseFacts(raw: unknown): ViewFact[] {
  return listOf(raw, 40).map((one) => clean({ label: textOf(one.label, 80), value: textOf(one.value, 400), code: one.code === true ? true : undefined, tone: toneOf(one.tone), ref: refOf(one.ref) }))
    .filter((one) => one.label && one.value && !isGuid(one.value));
}
export function parseTiles(raw: unknown): ViewTile[] {
  return listOf(raw, 8).map((one) => clean({ label: textOf(one.label, 80), value: textOf(one.value, 80), detail: optionalText(one.detail, 120), tone: toneOf(one.tone) }))
    .filter((one) => one.label && one.value && !isGuid(one.value));
}
export function parseSteps(raw: unknown): ViewStep[] {
  return listOf(raw).map((one) => clean({ id: idOf(one.id), text: textOf(one.text, 600), at: instantOf(one.at), when: optionalText(one.when, 80), detail: optionalText(one.detail, 200), tone: toneOf(one.tone) }))
    .filter((one) => one.text);
}
const pillOf = (raw: unknown): ViewPill | undefined => {
  if (!isObject(raw)) return undefined;
  const label = textOf(raw.label, 80);
  return label ? { label, tone: toneOf(raw.tone) ?? "open" } : undefined;
};

/** A list section's rows, each read by `row` (null: skipped). */
export function parseLines<T>(raw: unknown, row: (line: Raw) => T | null): T[] {
  const lines = isObject(raw) && Array.isArray(raw.lines) ? raw.lines.filter(isObject) : [];
  return lines.map(row).filter((one): one is T => one !== null);
}
export function viewOf(raw: unknown): Raw | undefined {
  return isObject(raw) && isObject(raw.view) ? raw.view : undefined;
}

/** A note of a record of another plugin (no kind of its own). */
export interface PluginNote { id?: string; author: string; authorRef?: RecordRef; at?: string; when?: string; text: string }
export function parseNote(line: Raw): PluginNote | null {
  const text = textOf(line.text, 20_000);
  return text ? clean({ id: idOf(line.id), author: textOf(line.author, 80), authorRef: refOf(line.author_ref), at: instantOf(line.timestamp ?? line.at), when: optionalText(line.date ?? line.when, 80), text }) : null;
}
/** A file of a record (an attachment, a page's file). */
export interface PluginFile { id: string; name: string; size?: string; date?: string; author?: string; type?: string }
export function parseFile(line: Raw): PluginFile | null {
  const id = idOf(line.id), name = textOf(line.name, 255);
  return id && name ? clean({ id, name, size: optionalText(line.size, 40), date: optionalText(line.date, 80), author: optionalText(line.author, 80), type: optionalText(line.type, 40) }) : null;
}

// ── SentinelOne: a threat ────────────────────────────────────────────────

export interface ThreatNode { depth: number; name: string; detail?: string; tone?: RecordTone }
export interface ThreatView {
  verdict?: { label: string; tone: RecordTone; detail?: string };
  /** what the agent already did (put in quarantine, killed the process) */
  done: string[];
  tree: ThreatNode[];
  file: ViewFact[];
  device?: { name: string; ref?: RecordRef; detail?: string; state?: ViewPill; isolated?: boolean };
  deviceTiles: ViewTile[];
  deviceFacts: ViewFact[];
}
export function parseThreatView(raw: unknown): ThreatView | undefined {
  const view = viewOf(raw);
  if (!view) return undefined;
  const verdict = isObject(view.verdict) && textOf(view.verdict.label, 80) ? clean({ label: textOf(view.verdict.label, 80), tone: toneOf(view.verdict.tone) ?? "open", detail: optionalText(view.verdict.detail, 300) }) : undefined;
  const device = isObject(view.device) && textOf(view.device.name, 120)
    ? clean({ name: textOf(view.device.name, 120), ref: refOf(view.device.ref), detail: optionalText(view.device.detail, 300), state: pillOf(view.device.state), isolated: view.device.isolated === true ? true : undefined })
    : undefined;
  return clean({
    verdict,
    done: textsOf(view.done, 6),
    tree: listOf(view.tree, 40).map((one) => clean({ depth: Math.max(0, Math.min(8, Math.round(numberOf(one.depth) ?? 0))), name: textOf(one.name, 300), detail: optionalText(one.detail, 200), tone: toneOf(one.tone) })).filter((one) => one.name),
    file: parseFacts(view.file),
    device,
    deviceTiles: parseTiles(view.device_tiles),
    deviceFacts: parseFacts(view.device_facts),
  });
}
export interface ThreatExclusion { id?: string; value: string; type?: string; scope?: string }
export function parseExclusion(line: Raw): ThreatExclusion | null {
  const value = textOf(line.value, 400);
  return value ? clean({ id: idOf(line.id), value, type: optionalText(line.type, 80), scope: optionalText(line.scope, 120) }) : null;
}

// ── Axcient x360Recover: a protected system ──────────────────────────────

export interface BackupDay { day: string; tone: RecordTone; label?: string }
export interface BackupVolume { name: string; label?: string; used: string; share?: number; fs?: string }
export interface BackupView {
  tiles: ViewTile[];
  days: BackupDay[];
  daysSummary?: string;
  daysNote?: string;
  /** the day of the last failure, in words (for "Explain the failure of ...") */
  failure?: string;
  volumes: BackupVolume[];
  vault: ViewFact[];
}
export function parseBackupView(raw: unknown): BackupView | undefined {
  const view = viewOf(raw);
  if (!view) return undefined;
  return clean({
    tiles: parseTiles(view.tiles),
    days: listOf(view.days, 62).map((one) => clean({ day: textOf(one.day, 40), tone: toneOf(one.tone) ?? "open", label: optionalText(one.label, 120) })).filter((one) => one.day),
    daysSummary: optionalText(view.days_summary, 200),
    daysNote: optionalText(view.days_note, 300),
    failure: optionalText(view.failure, 80),
    volumes: parseVolumes(view.volumes),
    vault: parseFacts(view.vault),
  });
}
export function parseVolumes(raw: unknown): BackupVolume[] {
  return listOf(raw, 26).map((one) => clean({ name: textOf(one.name, 40), label: optionalText(one.label, 80), used: textOf(one.used, 80), share: shareOf(one.share), fs: optionalText(one.fs, 20) })).filter((one) => one.name && one.used);
}
export interface RestorePoint { id?: string; at?: string; when: string; kind: string; size?: string; verified?: boolean }
export function parseRestorePoint(line: Raw): RestorePoint | null {
  const when = textOf(line.when, 80), kind = textOf(line.kind, 80);
  return when ? clean({ id: idOf(line.id), at: instantOf(line.at), when, kind, size: optionalText(line.size, 40), verified: typeof line.verified === "boolean" ? line.verified : undefined }) : null;
}

// ── BookStack: a page ────────────────────────────────────────────────────

export interface PageCrumb { label: string; ref?: RecordRef }
export interface PageBookEntry { label: string; depth: number; current?: boolean; chapter?: boolean; ref?: RecordRef }
export interface PageView {
  path: PageCrumb[];
  /** the page as Markdown (headings, callouts as GitHub alerts, code) */
  body: string;
  updated?: string;
  revision?: string;
  book: PageBookEntry[];
  facts: ViewFact[];
  tags: string[];
  editUrl?: string;
}
export function parsePageView(raw: unknown): PageView | undefined {
  const view = viewOf(raw);
  const body = view ? textOf(view.body, 200_000) : "";
  if (!view || !body) return undefined;
  return clean({
    path: listOf(view.path, 8).map((one) => clean({ label: textOf(one.label, 120), ref: refOf(one.ref) })).filter((one) => one.label),
    body,
    updated: optionalText(view.updated, 160),
    revision: optionalText(view.revision, 40),
    book: listOf(view.book, 120).map((one) => clean({ label: textOf(one.label, 160), depth: numberOf(one.depth) === 1 ? 1 : 0, current: one.current === true ? true : undefined, chapter: one.chapter === true ? true : undefined, ref: refOf(one.ref) })).filter((one) => one.label),
    facts: parseFacts(view.facts),
    tags: textsOf(view.tags),
    editUrl: httpsOf(view.edit_url),
  });
}
export interface PageRevision { id?: string; at?: string; when: string; author: string; summary: string }
export function parseRevision(line: Raw): PageRevision | null {
  const when = textOf(line.when, 80);
  return when ? clean({ id: idOf(line.id), at: instantOf(line.at), when, author: textOf(line.author, 80), summary: textOf(line.summary, 400) }) : null;
}

// ── Twilio: a conversation ───────────────────────────────────────────────

export interface MessageError { code: string; title: string; cause?: string; fix?: string }
export interface SmsMessage {
  id: string;
  direction: "in" | "out";
  body: string;
  at?: string;
  when: string;
  /** the status in words (Delivered), its tone, and Twilio's own word (delivered, undelivered) */
  status: string;
  tone: RecordTone;
  state?: string;
  by?: string;
  from: string;
  to: string;
  service?: string;
  segments?: string;
  price?: string;
  error?: MessageError;
  life: ViewStep[];
  /** the day it is listed under, in the console's words (Thursday, November 26) */
  day?: string;
}
export function parseMessage(line: Raw): SmsMessage | null {
  const id = idOf(line.id), from = textOf(line.from, 40), to = textOf(line.to, 40);
  if (!id || (!from && !to)) return null;
  const error = isObject(line.error) && textOf(line.error.code, 12)
    ? clean({ code: textOf(line.error.code, 12), title: textOf(line.error.title, 160), cause: optionalText(line.error.cause, 400), fix: optionalText(line.error.fix, 400) })
    : undefined;
  return clean({
    id, direction: line.direction === "in" ? "in" as const : "out" as const, body: textOf(line.body, 1_600), at: instantOf(line.at), when: textOf(line.when, 80),
    status: textOf(line.status, 60), tone: toneOf(line.tone) ?? "open", state: optionalText(line.state, 30), by: optionalText(line.by, 120), from, to,
    service: optionalText(line.service, 120), segments: optionalText(line.segments, 120), price: optionalText(line.price, 40), error, life: parseSteps(line.life),
    day: optionalText(line.day, 80),
  });
}
export interface ConversationView { stats?: { title?: string; parts: Array<{ text: string; tone?: RecordTone; strong?: boolean }> } }
export function parseConversationView(raw: unknown): ConversationView | undefined {
  const view = viewOf(raw);
  if (!view) return undefined;
  const stats = isObject(view.stats) ? clean({ title: optionalText(view.stats.title, 120), parts: listOf(view.stats.parts, 8).map((one) => clean({ text: textOf(one.text, 120), tone: toneOf(one.tone), strong: one.strong === true ? true : undefined })).filter((one) => one.text) }) : undefined;
  return clean({ stats: stats?.parts.length ? stats : undefined });
}
export interface CallRow { id: string; direction: "in" | "out"; when: string; duration?: string; transcript?: string; recording?: boolean }
export function parseCall(line: Raw): CallRow | null {
  const id = idOf(line.id), when = textOf(line.when, 80);
  return id && when ? clean({ id, direction: line.direction === "in" ? "in" as const : "out" as const, when, duration: optionalText(line.duration, 40), transcript: optionalText(line.transcript, 2_000), recording: line.recording === true ? true : undefined }) : null;
}
export interface NumberView { number: string; facts: ViewFact[]; capabilities: string[]; routingTitle?: string; routing: ViewFact[] }
export function parseNumberView(raw: unknown): NumberView | undefined {
  const view = viewOf(raw);
  const number = view ? textOf(view.number, 40) : "";
  if (!view || !number) return undefined;
  return clean({ number, facts: parseFacts(view.facts), capabilities: textsOf(view.capabilities, 8), routingTitle: optionalText(view.routing_title, 120), routing: parseFacts(view.routing) });
}

/** What an SMS costs in segments (Twilio's rule: GSM-7 160 characters, 153 a
 * segment once split; UCS-2 70, 67), for the person's draft. An estimate shown
 * as such: the console's own count is what a sent message says. */
const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€";
export function smsSegments(text: string): { chars: number; segments: number; encoding: "GSM-7" | "UCS-2"; per: number } {
  const gsm = [...text].every((char) => GSM7.includes(char) || GSM7_EXTENDED.includes(char));
  if (gsm) {
    const chars = [...text].reduce((sum, char) => sum + (GSM7_EXTENDED.includes(char) ? 2 : 1), 0);
    return { chars, segments: chars <= 160 ? (chars ? 1 : 0) : Math.ceil(chars / 153), encoding: "GSM-7", per: chars <= 160 ? 160 : 153 };
  }
  const chars = [...text].reduce((sum, char) => sum + ((char.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0);
  return { chars, segments: chars <= 70 ? 1 : Math.ceil(chars / 67), encoding: "UCS-2", per: chars <= 70 ? 70 : 67 };
}

// ── X: a post ────────────────────────────────────────────────────────────

/** A post: X's own post as the chat's X cards read it (`readXPost`, shared/x-post.ts), and the window's parts beside it. */
export interface PostView { post: XPostView; tiles: ViewTile[]; pinned?: boolean; bookmarked?: boolean }
export function parsePostView(raw: unknown): PostView | undefined {
  const view = viewOf(raw);
  const post = view ? readXPost(view.post) : null;
  if (!view || !post) return undefined;
  return clean({ post, tiles: parseTiles(view.tiles), pinned: view.pinned === true ? true : undefined, bookmarked: view.bookmarked === true ? true : undefined });
}
/** A reply under the post: X's own post, with its id (a reply is answered by it). */
export function parseReply(line: Raw): (XPostView & { id: string }) | null {
  const post = readXPost(line);
  return post?.id && idOf(post.id) ? { ...post, id: post.id } : null;
}
export interface PostStats { hourlyTitle?: string; hourly: Array<{ label: string; value: number; text?: string }>; sourcesTitle?: string; sources: Array<{ label: string; share: number; text?: string }> }
export function parsePostStats(raw: unknown): PostStats | undefined {
  const view = viewOf(raw);
  if (!view) return undefined;
  const hourly = listOf(view.hourly, 48).map((one) => ({ label: textOf(one.label, 20), value: numberOf(one.value) ?? -1, text: optionalText(one.text, 40) })).filter((one) => one.label && one.value >= 0).map(clean);
  const sources = listOf(view.sources, 12).map((one) => ({ label: textOf(one.label, 80), share: shareOf(one.share) ?? -1, text: optionalText(one.text, 40) })).filter((one) => one.label && one.share >= 0).map(clean);
  return hourly.length || sources.length ? clean({ hourlyTitle: optionalText(view.hourly_title, 120), hourly, sourcesTitle: optionalText(view.sources_title, 120), sources }) : undefined;
}

// ── Files: a folder ──────────────────────────────────────────────────────

/** The Finder's tag colours (its own seven). */
export const FOLDER_TAGS = ["red", "orange", "yellow", "green", "blue", "purple", "gray"] as const;
export type FolderTag = (typeof FOLDER_TAGS)[number];
const tagOf = (value: unknown): FolderTag | undefined => (FOLDER_TAGS as readonly unknown[]).includes(value) ? value as FolderTag : undefined;
export interface FolderPlace { group: "favorites" | "locations" | "tags"; label: string; ref?: RecordRef; tag?: FolderTag; current?: boolean; icon?: string }
export interface FolderView { path: PageCrumb[]; places: FolderPlace[]; siblings: Array<{ label: string; ref?: RecordRef; current?: boolean }>; summary?: string; size?: string }
export function parseFolderView(raw: unknown): FolderView | undefined {
  const view = viewOf(raw);
  if (!view) return undefined;
  const groups = ["favorites", "locations", "tags"] as const;
  return clean({
    path: listOf(view.path, 12).map((one) => clean({ label: textOf(one.label, 160), ref: refOf(one.ref) })).filter((one) => one.label),
    places: listOf(view.places, 40).map((one) => clean({ group: groups.find((group) => group === one.group) ?? "locations", label: textOf(one.label, 80), ref: refOf(one.ref), tag: tagOf(one.tag), current: one.current === true ? true : undefined, icon: optionalText(one.icon, 20) })).filter((one) => one.label),
    siblings: listOf(view.siblings, 200).map((one) => clean({ label: textOf(one.label, 160), ref: refOf(one.ref), current: one.current === true ? true : undefined })).filter((one) => one.label),
    summary: optionalText(view.summary, 160),
    size: optionalText(view.size, 60),
  });
}
export interface FolderItem { id: string; name: string; folder: boolean; ext?: string; size?: string; modified?: string; at?: string; type?: string; tag?: FolderTag; ref?: RecordRef; shared?: string }
export function parseFolderItem(line: Raw): FolderItem | null {
  const id = idOf(line.id), name = textOf(line.name, 255);
  if (!id || !name) return null;
  const folder = line.folder === true;
  const ext = folder ? undefined : (optionalText(line.ext, 8) ?? (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]))?.toUpperCase();
  return clean({ id, name, folder, ext, size: optionalText(line.size, 40), modified: optionalText(line.modified, 80), at: instantOf(line.at), type: optionalText(line.type, 80), tag: tagOf(line.tag), ref: refOf(line.ref), shared: optionalText(line.shared, 160) });
}
