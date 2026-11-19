// Conditional writes for an AI client (#4939, owner decision 2026-11-19): two sessions
// can no longer overwrite each other's change to a bot's profile and
// settings or to a routine.
//
// Contract (agent API and the member API that Perspicax forwards):
//   - get_agent answers `version`; sagax_routines (GET /api/org/member/routines
//     and routines/{id}) answers each routine's `version`; every successful
//     write answers the new `version`.
//   - update_agent_settings, update_routine and delete_routine take
//     `expected_version` (update_agent_settings also takes `expectedVersion`,
//     the spelling Perspicax remaps snake_case keys to).
//   - A stale `expected_version` is refused: HTTP 409, code
//     `version_conflict`, `current_version` the version now, `conflict`
//     `stale`. Nothing is written.
//   - Without `expected_version`, an AI client's write (via perspicax-mcp or
//     a bot) goes through only when this same caller read the current
//     version (get_agent, sagax_routines) and has not written since; else the
//     same 409 with `conflict` `not_read` or `stale`. The person in an app
//     (via console, and the Sagax app itself, which never comes through
//     here) writes as before.
// The version is opaque: compare it, never parse it.
import { createHash } from "node:crypto";

import { AGENT_SETTINGS_FIELDS } from "./fleet-agent-settings.ts";

export type WriteTargetKind = "agent" | "routine";

export interface WriteTarget {
  kind: WriteTargetKind;
  id: string;
}

/** Bookkeeping kept on a bot that is not a setting: it moves without anyone
 * editing the bot, so it never changes the version. */
const NOT_SETTINGS = new Set(["unread", "pinned", "pinnedMessageId", "acknowledgeLocalAuto", "acknowledgePeerScope", "confirmFullAccess", "applyToAllThreads", "primary"]);

const VERSIONED_BOT_FIELDS = AGENT_SETTINGS_FIELDS.filter((field) => !NOT_SETTINGS.has(field));

/** A bot's version: every Edit bot field update_agent_settings may write, as
 * stored, plus the last profile card applied (a card can restore the same
 * text). */
export function agentSettingsVersion(bot: Record<string, unknown>): string {
  const fields: Record<string, unknown> = {};
  for (const field of VERSIONED_BOT_FIELDS) {
    if (bot[field] !== undefined) fields[field] = bot[field];
  }
  if (bot.lastProfileRequestId !== undefined) fields.lastProfileRequestId = bot.lastProfileRequestId;
  return createHash("sha256").update(stableJson(fields), "utf8").digest("hex").slice(0, 32);
}

/** A routine's version: its updatedAt, the store's own optimistic revision
 * of the definition (server/routines/routines.ts). */
export function routineVersion(routine: { updatedAt?: unknown }): string | null {
  return typeof routine.updatedAt === "number" && Number.isFinite(routine.updatedAt) ? String(routine.updatedAt) : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>).sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Who read: the person and the AI client Perspicax signed (two clients of
 * one person are two readers). */
export function readerKey(reader: { kind?: string; id?: string; principalId?: string; client?: string }): string {
  const id = reader.principalId ?? reader.id ?? "";
  return `${reader.kind ?? "person"}:${id.trim().toLowerCase()}|${reader.client ?? ""}`;
}

const MAX_READS = 10_000;

/** The version each reader last read of each target, until its next write. */
export class VersionReads {
  private readonly reads = new Map<string, string>();

  private static key(reader: string, target: WriteTarget): string {
    return `${reader}#${target.kind}:${target.id}`;
  }

  note(reader: string, target: WriteTarget, version: string | null): void {
    if (!version) return;
    const key = VersionReads.key(reader, target);
    this.reads.delete(key);
    this.reads.set(key, version);
    if (this.reads.size > MAX_READS) {
      const oldest = this.reads.keys().next().value;
      if (oldest !== undefined) this.reads.delete(oldest);
    }
  }

  read(reader: string, target: WriteTarget): string | undefined {
    return this.reads.get(VersionReads.key(reader, target));
  }

  /** After a write, this reader's copy is no longer the current one. */
  consume(reader: string, target: WriteTarget): void {
    this.reads.delete(VersionReads.key(reader, target));
  }
}

export type VersionVerdict =
  | { ok: true }
  | { ok: false; reason: "stale" | "not_read"; current: string };

/**
 * Whether a write may go: a given expected version must be the current one;
 * without one, a caller that must read first must have read the current one.
 */
export function checkWriteVersion(input: {
  current: string | null;
  expected: string | undefined;
  readFirst: boolean;
  read: string | undefined;
}): VersionVerdict {
  const { current, expected, readFirst, read } = input;
  if (current === null) return { ok: true };
  if (expected !== undefined) return expected === current ? { ok: true } : { ok: false, reason: "stale", current };
  if (!readFirst) return { ok: true };
  if (read === undefined) return { ok: false, reason: "not_read", current };
  return read === current ? { ok: true } : { ok: false, reason: "stale", current };
}

/** The expected version a caller sent: a non-empty string, else undefined;
 * a wrong type is an error sentence. */
export function expectedVersionArg(args: Record<string, unknown>, keys: readonly string[] = ["expected_version"]): string | undefined | { error: string } {
  for (const key of keys) {
    if (!Object.hasOwn(args, key)) continue;
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !value.trim() || value.length > 200) {
      return { error: `${key} is the version string get_agent or sagax_routines answered.` };
    }
    return value.trim();
  }
  return undefined;
}

/** The 409 body fields, shared by the agent API and the member API. */
export function versionConflictWords(target: WriteTarget, reason: "stale" | "not_read"): { message: string; hint: string } {
  const what = target.kind === "agent" ? "This agent's profile and settings" : "This routine";
  const reread = target.kind === "agent" ? "get_agent" : "sagax_routines";
  return {
    message: reason === "not_read"
      ? `${what} must be read before it is changed, so a change made meanwhile is not lost. Nothing was changed.`
      : `${what} changed since you read it. Nothing was changed.`,
    hint: `Call ${reread} again, apply your change to what it answers, then write with expected_version set to its version (current_version here).`,
  };
}

/** One write at a time per target: the check and the write it guards are
 * never split by another caller's write. */
export class TargetQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(target: WriteTarget, work: () => Promise<T>): Promise<T> {
    const key = `${target.kind}:${target.id}`;
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.tails.set(key, next);
    void next.finally(() => {
      if (this.tails.get(key) === next) this.tails.delete(key);
    }).catch(() => undefined);
    return next;
  }
}
