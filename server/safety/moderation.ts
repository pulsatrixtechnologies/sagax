// Content between people (App Store guideline 1.2): reports, personal
// blocks and the one-time acceptance of the terms of use. One small JSON
// file in the data directory, written atomically.
//
// - A report names one message someone else wrote in a room or a direct
//   conversation between people. It goes to the organization's admins (on
//   a solo server, the server's owner), who read the list and mark a report
//   handled. The author is the one the stored message names, never the body.
// - A block is personal: the person's own list of people whose lines their
//   apps fold away. It changes nothing for anyone else and is undone from
//   the app (Settings). Kept here so every device of the person agrees.
// - The terms are accepted once per person, with the date, so another
//   device never asks again.
//
// Routes: server/routes/moderation.ts. Keyed by the acting person
// (`actorPrincipalId` in server/index.ts): the session's principal, or the
// operator at this computer.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../atomic.ts";

/** The version of the terms a person accepts (https://pulsatrix.ca/terms). */
export const TERMS_VERSION = "2026-10-26";
export const TERMS_URL = "https://pulsatrix.ca/terms";

export const REPORT_REASONS = ["harassment", "hate", "sexual", "violence", "spam", "privacy", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Bounds, not quotas: a store a busy organization never reaches. */
export const MAX_REPORTS = 5_000;
export const MAX_BLOCKS_PER_PERSON = 500;
export const MAX_PEOPLE = 10_000;
export const MAX_NOTE = 1_000;
export const MAX_EXCERPT = 1_000;

export interface ModerationReport {
  id: string;
  at: number;
  threadId: string;
  messageId: string;
  /** The room or direct conversation, when the thread belongs to one. */
  groupId?: string;
  groupName?: string;
  /** A direct conversation between two people. */
  peopleDm?: boolean;
  /** Who wrote the message, as the stored message names them. */
  reportedId: string;
  reportedName: string;
  reportedKind: "person" | "bot";
  reason: ReportReason;
  note?: string;
  /** The reported message's words, cut short: what the admin acts on. */
  excerpt?: string;
  reporterId: string;
  reporterName: string;
  status: "open" | "resolved";
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface BlockedPerson {
  id: string;
  name: string;
  at: number;
}

export interface TermsAcceptance {
  version: string;
  acceptedAt: number;
}

const reportSchema = z.object({
  id: z.string(),
  at: z.number(),
  threadId: z.string(),
  messageId: z.string(),
  groupId: z.string().optional(),
  groupName: z.string().optional(),
  peopleDm: z.boolean().optional(),
  reportedId: z.string(),
  reportedName: z.string(),
  reportedKind: z.enum(["person", "bot"]),
  reason: z.enum(REPORT_REASONS),
  note: z.string().optional(),
  excerpt: z.string().optional(),
  reporterId: z.string(),
  reporterName: z.string(),
  status: z.enum(["open", "resolved"]),
  resolvedAt: z.number().optional(),
  resolvedBy: z.string().optional(),
});

const fileSchema = z.object({
  version: z.literal(1),
  reports: z.array(reportSchema),
  blocks: z.record(z.string(), z.array(z.object({ id: z.string(), name: z.string(), at: z.number() }))),
  terms: z.record(z.string(), z.object({ version: z.string(), acceptedAt: z.number() })),
});

type ModerationFile = z.infer<typeof fileSchema>;

/** A person key the store accepts: a principal id, an older hashed key or
 * an address. No control characters, bounded. */
export function moderationPersonKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (!key || key.length > 200 || /[/\\]/.test(key) || [...key].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) return null;
  return key;
}

export interface NewReport {
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
}

export interface ModerationStore {
  addReport(input: NewReport): ModerationReport;
  /** Newest first. */
  reports(): ModerationReport[];
  resolveReport(id: string, by: string): ModerationReport | null;
  blocks(person: string): BlockedPerson[];
  block(person: string, target: { id: string; name: string }): BlockedPerson[];
  unblock(person: string, targetId: string): BlockedPerson[];
  terms(person: string): TermsAcceptance | null;
  acceptTerms(person: string, version: string): TermsAcceptance;
  /** Forget a person's own blocks and acceptance (account deletion). The
   * reports they made or that name them stay with the admins. */
  forgetPerson(person: string): void;
}

export interface ModerationStoreOptions {
  now?: () => number;
  newId?: () => string;
  /** Tests use a small bound. */
  maxReports?: number;
}

export function createModerationStore(dataDir: string, options: ModerationStoreOptions = {}): ModerationStore {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => `rep_${randomBytes(9).toString("hex")}`);
  const maxReports = options.maxReports ?? MAX_REPORTS;
  const file = join(dataDir, "moderation.json");
  let state: ModerationFile | null = null;

  const load = (): ModerationFile => {
    if (state) return state;
    state = { version: 1, reports: [], blocks: {}, terms: {} };
    if (!existsSync(file)) return state;
    try {
      state = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      // A damaged file costs the list, never the server.
      console.warn(`moderation: ${file} could not be read (${error instanceof Error ? error.message : String(error)}); starting empty`);
    }
    return state;
  };
  const save = () => {
    writeFileAtomic(file, `${JSON.stringify(load(), null, 2)}\n`, { mode: 0o600 });
  };
  const requireKey = (value: string): string => {
    const key = moderationPersonKey(value);
    if (!key) throw Object.assign(new Error("not a person"), { status: 403 });
    return key;
  };
  const newPersonAllowed = (record: Record<string, unknown>, key: string) => {
    if (!Object.hasOwn(record, key) && Object.keys(record).length >= MAX_PEOPLE) throw Object.assign(new Error("too many people"), { status: 507 });
  };

  return {
    addReport(input) {
      const all = load();
      const note = input.note?.trim().slice(0, MAX_NOTE);
      const excerpt = input.excerpt?.trim().slice(0, MAX_EXCERPT);
      const report: ModerationReport = {
        id: newId(),
        at: now(),
        threadId: input.threadId,
        messageId: input.messageId,
        ...(input.groupId ? { groupId: input.groupId } : {}),
        ...(input.groupName ? { groupName: input.groupName } : {}),
        ...(input.peopleDm ? { peopleDm: true } : {}),
        reportedId: input.reportedId,
        reportedName: input.reportedName,
        reportedKind: input.reportedKind,
        reason: input.reason,
        ...(note ? { note } : {}),
        ...(excerpt ? { excerpt } : {}),
        reporterId: input.reporterId,
        reporterName: input.reporterName,
        status: "open",
      };
      all.reports.push(report);
      // The oldest handled report goes first when the list is full, then the oldest.
      while (all.reports.length > maxReports) {
        const resolved = all.reports.findIndex((entry) => entry.status === "resolved");
        all.reports.splice(resolved >= 0 ? resolved : 0, 1);
      }
      save();
      return { ...report };
    },
    reports() {
      // stored oldest first: the reverse keeps the later of two at the same time first
      return load().reports.map((report) => ({ ...report })).reverse().sort((a, b) => b.at - a.at);
    },
    resolveReport(id, by) {
      const report = load().reports.find((entry) => entry.id === id);
      if (!report) return null;
      if (report.status !== "resolved") {
        report.status = "resolved";
        report.resolvedAt = now();
        report.resolvedBy = by;
        save();
      }
      return { ...report };
    },
    blocks(person) {
      const key = requireKey(person);
      return (load().blocks[key] ?? []).map((entry) => ({ ...entry }));
    },
    block(person, target) {
      const key = requireKey(person);
      const targetId = requireKey(target.id);
      if (targetId === key) throw Object.assign(new Error("you cannot block yourself"), { status: 400 });
      const all = load();
      newPersonAllowed(all.blocks, key);
      const list = all.blocks[key] ?? [];
      const name = target.name.trim().slice(0, 120) || targetId;
      const existing = list.find((entry) => entry.id === targetId);
      if (existing) existing.name = name;
      else {
        if (list.length >= MAX_BLOCKS_PER_PERSON) throw Object.assign(new Error("too many blocked people"), { status: 409 });
        list.push({ id: targetId, name, at: now() });
      }
      all.blocks[key] = list;
      save();
      return list.map((entry) => ({ ...entry }));
    },
    unblock(person, targetId) {
      const key = requireKey(person);
      const id = moderationPersonKey(targetId);
      const all = load();
      const list = all.blocks[key] ?? [];
      const next = id ? list.filter((entry) => entry.id !== id) : list;
      if (next.length !== list.length) {
        if (next.length) all.blocks[key] = next;
        else delete all.blocks[key];
        save();
      }
      return next.map((entry) => ({ ...entry }));
    },
    terms(person) {
      const entry = load().terms[requireKey(person)];
      return entry ? { ...entry } : null;
    },
    acceptTerms(person, version) {
      const key = requireKey(person);
      const all = load();
      newPersonAllowed(all.terms, key);
      const existing = all.terms[key];
      if (existing && existing.version === version) return { ...existing };
      const entry = { version, acceptedAt: now() };
      all.terms[key] = entry;
      save();
      return { ...entry };
    },
    forgetPerson(person) {
      const key = moderationPersonKey(person);
      if (!key) return;
      const all = load();
      if (!all.blocks[key] && !all.terms[key]) return;
      delete all.blocks[key];
      delete all.terms[key];
      save();
    },
  };
}
