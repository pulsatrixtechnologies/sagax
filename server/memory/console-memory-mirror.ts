// #4461: every memory a bot keeps is visible in the organization console's
// Memory section.
//
// Owner of truth on a linked organization server: the console (tiers me,
// team:<id>, org). Local files stay the working copy the bot reads each
// turn; this module mirrors each entry out (POST /api/v1/memory/read/entry
// with bot + written_at) and pulls console edits and deletes back into the
// local file. A solo install (no console) is a no-op.
//
// Inventory of stores a bot later reads back as memory (who reads / writes /
// whether the console showed it before this module):
//
// | Store | Path / key | Who reads | Who writes | Console before |
// | --- | --- | --- | --- | --- |
// | Bot index | workspaces/<bot>/MEMORY.md | that bot (prompt) | bot, person, upkeep | no |
// | Bot topics | workspaces/<bot>/memory/<topic>.md | that bot (on demand) | bot, person, upkeep | no |
// | Team memory (org) | team-memory person:<id> | owner's bots | owner, their bots | only after manual publish |
// | Team memory (solo) | team-memory <section> | person's bots | person, bots | n/a (no console) |
// | Group memory | group-memory/<group>/MEMORY.md | bots in the group | group owner / bots | no |
// | Company | workspaces/<bot>/memory/company.md | every bot of the person | bots, person | no |
// | Procedures | workspaces/<bot>/memory/procedures.md | that bot | bots, upkeep | no |
// | Daily logs | memory/log/YYYY-MM-DD.md | that bot (search) | harness | no (noisy; not mirrored) |
// | Dreams / archive | memory/dreams, memory/archive.md | upkeep | upkeep | no (derived) |
// | Journal | ~/.sagax/memory-journal | person (UI) | journal | no (history, not memory) |
// | Console tiers | Perspicax me/team/org | entitled people | console, linked Sagax | yes (own store) |
//
// Mirrored today: MEMORY.md entries, topic files, person-scoped team memory,
// company.md, procedures.md. Group memory is inventoried and stays local for
// now (same person isolation; a later pass can push it under sagax-group).
// Secrets stay filtered by the console (flagged, not refused), as today.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";
import { parseMemoryEntries, type MemoryEntryLine } from "./memory-entries.ts";
import { memoryReadPath, type NotesCallResult, type PerspicaxMemoryNotesClient } from "./perspicax-memory-notes.ts";
import { TEAM_MEMORY_KINDS, type TeamMemoryEntry, type TeamMemoryKind } from "./team-memory.ts";

/** Prefer the live env so a test can isolate the map after import. */
function dataDir(): string {
  return process.env.SAGAX_DATA_DIR?.trim() || process.env.OMB_DATA_DIR?.trim() || DATA_DIR;
}

export const MIRROR_TOPIC_BOT = "sagax-bot";
export const MIRROR_TOPIC_GROUP = "sagax-group";
export const MIRROR_TOPIC_TEAM = "sagax-team";

/** Same folders as team-memory-http PUBLISH_TOPICS (#4460). */
const TEAM_TOPICS: Record<TeamMemoryKind, string> = {
  person: "people",
  place: "places",
  decision: "decisions",
  term: "terms",
};

/** One line of the inventory above, for tests and the pull request. */
export const MEMORY_STORE_INVENTORY = [
  { id: "bot-index", path: "MEMORY.md", mirrored: true },
  { id: "bot-topics", path: "memory/<topic>.md", mirrored: true },
  { id: "team-memory-org", path: "person:<principal>", mirrored: true },
  { id: "team-memory-solo", path: "<section>", mirrored: false },
  { id: "group-memory", path: "group-memory/<group>/MEMORY.md", mirrored: false },
  { id: "company", path: "memory/company.md", mirrored: true },
  { id: "procedures", path: "memory/procedures.md", mirrored: true },
  { id: "daily-logs", path: "memory/log/", mirrored: false },
  { id: "dreams-archive", path: "memory/dreams|archive.md", mirrored: false },
  { id: "journal", path: "memory-journal/", mirrored: false },
  { id: "console-tiers", path: "perspicax me|team|org", mirrored: false },
] as const;

export interface ConsoleMirrorNote {
  scope: string;
  topic: string;
  title: string;
  body: string;
  bot?: string;
  written_at?: string;
  tags?: string[];
}

export interface MirrorRemote {
  call(
    principalId: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<NotesCallResult>;
}

export interface MirrorMapEntry {
  scope: string;
  id: string;
  hash: string;
  /** Local key this console note came from (bot path, team entry id, ...). */
  local: string;
}

export interface MirrorMapFile {
  version: 1;
  /** local key -> remote */
  entries: Record<string, MirrorMapEntry>;
}

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** Content fingerprint shared by push and pull (title + body only). */
function contentHash(title: string, body: string): string {
  return hashOf(`${title}\0${body}`);
}

/** RFC 3339 UTC from a MEMORY.md day (noon) or a unix ms. */
export function writtenAtIso(dayOrMs: string | number, now = Date.now()): string {
  if (typeof dayOrMs === "number") {
    const ms = Math.min(dayOrMs, now);
    return new Date(ms).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayOrMs)) {
    const iso = `${dayOrMs}T12:00:00.000Z`;
    const ms = Date.parse(iso);
    if (!Number.isNaN(ms)) return new Date(Math.min(ms, now)).toISOString();
  }
  return new Date(now).toISOString();
}

function titleOf(body: string, fallback: string): string {
  const line = body.split("\n").map((part) => part.trim()).find(Boolean) ?? fallback;
  return line.slice(0, 120);
}

/** One dated MEMORY.md fact as a console note (scope me). */
export function noteFromBotEntry(
  entry: Pick<MemoryEntryLine, "body" | "date">,
  botName: string,
  topic = MIRROR_TOPIC_BOT,
  now = Date.now(),
): ConsoleMirrorNote | null {
  const body = entry.body.trim();
  if (!body) return null;
  return {
    scope: "me",
    topic,
    title: titleOf(body, botName),
    body,
    bot: botName.slice(0, 64),
    written_at: writtenAtIso(entry.date, now),
    tags: ["source:sagax", "kind:bot-index"],
  };
}

/** A whole topic / company / procedures / group MEMORY.md file as one note. */
export function noteFromMemoryFile(
  text: string,
  botName: string,
  topic: string,
  title: string,
  writtenAt: number,
  now = Date.now(),
): ConsoleMirrorNote | null {
  const body = text.replace(/\s+$/u, "").trim();
  if (!body) return null;
  return {
    scope: "me",
    topic,
    title: title.slice(0, 120),
    body,
    bot: botName.slice(0, 64),
    written_at: writtenAtIso(writtenAt, now),
    tags: ["source:sagax", `kind:${topic}`],
  };
}

/** A person-scoped team memory entry as a console note (scope me by default). */
export function noteFromTeamEntry(
  entry: Pick<TeamMemoryEntry, "kind" | "name" | "detail" | "aliases" | "updatedAt" | "source">,
  botName: string | undefined,
  scope = "me",
  now = Date.now(),
): ConsoleMirrorNote {
  const kind = (TEAM_MEMORY_KINDS as readonly string[]).includes(entry.kind) ? entry.kind : "term";
  const also = entry.aliases.length ? `\n\nAlso: ${entry.aliases.join(", ")}` : "";
  return {
    scope,
    topic: TEAM_TOPICS[kind as TeamMemoryKind] ?? MIRROR_TOPIC_TEAM,
    title: entry.name.slice(0, 120),
    body: `${entry.detail}${also}`,
    bot: (botName ?? entry.source.botName).slice(0, 64),
    written_at: writtenAtIso(entry.source.at || entry.updatedAt, now),
    tags: ["source:sagax", "kind:team-memory", `team-kind:${entry.kind}`],
  };
}

/** Paths under a bot workspace that this module mirrors (not logs/dreams/archive). */
export function isMirroredMemoryPath(path: string): boolean {
  if (path === "MEMORY.md") return true;
  if (path === "memory/company.md" || path === "memory/procedures.md") return true;
  if (path === "memory/archive.md" || path.startsWith("memory/log/") || path.startsWith("memory/dreams/")) return false;
  if (/^memory\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.md$/.test(path)) return true;
  return false;
}

function topicForPath(path: string): string {
  if (path === "MEMORY.md") return MIRROR_TOPIC_BOT;
  if (path === "memory/company.md") return "sagax-company";
  if (path === "memory/procedures.md") return "sagax-procedures";
  const match = /^memory\/([A-Za-z0-9_-]+)\.md$/.exec(path);
  return match ? `sagax-topic-${match[1]}` : MIRROR_TOPIC_BOT;
}

function mapPath(principalId: string): string {
  const dir = join(dataDir(), "console-memory-mirror");
  mkdirSync(dir, { recursive: true });
  const safe = principalId.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").slice(0, 120) || "unknown";
  return join(dir, `${safe}.json`);
}

export function readMirrorMap(principalId: string): MirrorMapFile {
  const path = mapPath(principalId);
  if (!existsSync(path)) return { version: 1, entries: Object.create(null) };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as MirrorMapFile;
    if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") {
      return { version: 1, entries: Object.create(null) };
    }
    return { version: 1, entries: parsed.entries };
  } catch {
    return { version: 1, entries: Object.create(null) };
  }
}

export function writeMirrorMap(principalId: string, file: MirrorMapFile): void {
  writeFileAtomic(mapPath(principalId), `${JSON.stringify({ version: 1, entries: file.entries }, null, 2)}\n`);
}

function savedId(body: unknown): { id: string; scope: string; state?: string } | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  const scope = typeof row.scope === "string" && row.scope.trim() ? row.scope.trim() : "me";
  const state = typeof row.state === "string" ? row.state : undefined;
  return { id, scope, state };
}

export interface ConsoleMemoryMirrorOptions {
  client: MirrorRemote;
  /** Solo / unlinked: every call is a no-op. */
  enabled: () => boolean;
  now?: () => number;
  /** Optional log (never a token or a note body). */
  log?: (line: string) => void;
}

/**
 * Mirrors local memory into the console and pulls console edits back.
 * Fail open: a refused or unreachable console never blocks a bot write.
 */
export class ConsoleMemoryMirror {
  private readonly opts: ConsoleMemoryMirrorOptions;
  private readonly now: () => number;

  constructor(opts: ConsoleMemoryMirrorOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  /** Push one note; records the console id under `localKey`. */
  async push(
    principalId: string,
    localKey: string,
    note: ConsoleMirrorNote,
  ): Promise<{ ok: true; id: string; scope: string } | { ok: false; error: string }> {
    if (!this.opts.enabled()) return { ok: false, error: "disabled" };
    const hash = contentHash(note.title, note.body);
    const map = readMirrorMap(principalId);
    const prior = map.entries[localKey];
    if (prior && prior.hash === hash) return { ok: true, id: prior.id, scope: prior.scope };

    let result: NotesCallResult;
    if (prior) {
      result = await this.opts.client.call(principalId, "PUT", memoryReadPath("/entry"), {
        scope: prior.scope,
        id: prior.id,
        title: note.title,
        body: note.body,
        tags: note.tags ?? [],
      });
      if (result.ok) {
        map.entries[localKey] = { scope: prior.scope, id: prior.id, hash, local: localKey };
        writeMirrorMap(principalId, map);
        return { ok: true, id: prior.id, scope: prior.scope };
      }
      // stale remote: fall through to create
    }

    result = await this.opts.client.call(principalId, "POST", memoryReadPath("/entry"), note);
    if (!result.ok) {
      this.opts.log?.(`console-memory-mirror: push refused (${result.error}${result.status ? ` ${result.status}` : ""})`);
      return { ok: false, error: result.error };
    }
    const saved = savedId(result.body);
    if (!saved) {
      this.opts.log?.("console-memory-mirror: push answered without an id");
      return { ok: false, error: "no_id" };
    }
    map.entries[localKey] = { scope: saved.scope, id: saved.id, hash, local: localKey };
    writeMirrorMap(principalId, map);
    return { ok: true, id: saved.id, scope: saved.scope };
  }

  /** Drop the console note that mirrored `localKey` (local delete). */
  async forget(principalId: string, localKey: string): Promise<void> {
    if (!this.opts.enabled()) return;
    const map = readMirrorMap(principalId);
    const prior = map.entries[localKey];
    if (!prior) return;
    const result = await this.opts.client.call(
      principalId,
      "DELETE",
      memoryReadPath("/entry", { scope: prior.scope, id: prior.id }),
    );
    if (result.ok || result.status === 404) {
      delete map.entries[localKey];
      writeMirrorMap(principalId, map);
    }
  }

  /**
   * Bring MEMORY.md dated entries into the console (existing memories).
   * Struck / empty lines are skipped. Returns how many were pushed.
   */
  async bringInMemoryIndex(
    principalId: string,
    botId: string,
    botName: string,
    text: string,
  ): Promise<number> {
    if (!this.opts.enabled()) return 0;
    let count = 0;
    for (const entry of parseMemoryEntries(text)) {
      if (entry.struck || !entry.body.trim()) continue;
      const note = noteFromBotEntry(entry, botName, MIRROR_TOPIC_BOT, this.now());
      if (!note) continue;
      const localKey = `bot:${botId}:MEMORY.md:${entry.date}:${hashOf(entry.body).slice(0, 12)}`;
      const pushed = await this.push(principalId, localKey, note);
      if (pushed.ok) count += 1;
    }
    return count;
  }

  /** Bring one whole mirrored file (topic / company / procedures / group). */
  async bringInMemoryFile(
    principalId: string,
    localKey: string,
    botName: string,
    path: string,
    text: string,
    writtenAt: number,
  ): Promise<boolean> {
    if (!this.opts.enabled() || !isMirroredMemoryPath(path) || path === "MEMORY.md") return false;
    const note = noteFromMemoryFile(text, botName, topicForPath(path), titleOf(text, path), writtenAt, this.now());
    if (!note) return false;
    return (await this.push(principalId, localKey, note)).ok;
  }

  /** Bring one team-memory entry (person-scoped) into scope me. */
  async bringInTeamEntry(
    principalId: string,
    entry: TeamMemoryEntry,
  ): Promise<boolean> {
    if (!this.opts.enabled()) return false;
    const note = noteFromTeamEntry(entry, entry.source.botName, "me", this.now());
    return (await this.push(principalId, `team:${entry.id}`, note)).ok;
  }

  /**
   * Pull console edits and deletes for mirrored keys.
   * `applyEdit` receives the new body; `applyDelete` removes the local entry.
   */
  async pull(
    principalId: string,
    handlers: {
      applyEdit: (localKey: string, body: string, title: string) => void;
      applyDelete: (localKey: string) => void;
    },
  ): Promise<{ edited: number; deleted: number }> {
    if (!this.opts.enabled()) return { edited: 0, deleted: 0 };
    const map = readMirrorMap(principalId);
    let edited = 0;
    let deleted = 0;
    for (const [localKey, remote] of Object.entries(map.entries)) {
      const result = await this.opts.client.call(
        principalId,
        "GET",
        memoryReadPath("/entry", { scope: remote.scope, id: remote.id }),
      );
      if (!result.ok) {
        if (result.status === 404) {
          handlers.applyDelete(localKey);
          delete map.entries[localKey];
          deleted += 1;
        }
        continue;
      }
      const row = result.body && typeof result.body === "object" ? result.body as Record<string, unknown> : null;
      if (!row) continue;
      if (row.archived === true) {
        handlers.applyDelete(localKey);
        delete map.entries[localKey];
        deleted += 1;
        continue;
      }
      const body = typeof row.body === "string" ? row.body : "";
      const title = typeof row.title === "string" ? row.title : "";
      const hash = contentHash(title, body);
      if (hash !== remote.hash) {
        handlers.applyEdit(localKey, body, title);
        map.entries[localKey] = { ...remote, hash };
        edited += 1;
      }
    }
    writeMirrorMap(principalId, map);
    return { edited, deleted };
  }
}

/** Build a MirrorRemote from the notes client. */
export function mirrorRemoteFrom(client: PerspicaxMemoryNotesClient): MirrorRemote {
  return {
    call: (principalId, method, path, body) => client.call(principalId, method, path, body),
  };
}
