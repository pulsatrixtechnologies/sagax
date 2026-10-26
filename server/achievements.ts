// Each person's achievements (shared/achievements.ts, catalog in
// shared/achievements-catalog.ts): progress counters, unlocks and their own
// settings, kept per person on an organization server (the principal id) and
// per install on a solo server (the local operator's principal). One JSON
// file in the data directory, written atomically, so every device the person
// signs in on sees the same trophies.
//
// Events come from two places: the server's own hooks (server/index.ts,
// achievementRequestEvents below, a message sent, a routine that ran) and the
// app (POST /api/me/achievements/events, client events only). Every event is
// rate limited per person and type, an event with an id counts once, and an
// achievement unlocks once: replaying anything never unlocks twice.
//
// Private: a person reads only their own record. Others see a card (points,
// the chosen title id, unlocked achievement ids) by default. An explicit off
// ("Show my points to colleagues") stays private (publicPoints). "Show my
// points" and "Show my title" off leave the total and the title off that card
// (the person's own choice, for everyone who looks). Locked ids stay off it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ACHIEVEMENTS } from "../shared/achievements-catalog.ts";
import { applyMasteryFact, cleanMasteryState, emptyMasteryState, reconcileMastery, type MasteryFact } from "../shared/achievements-mastery.ts";
import {
  ACHIEVEMENT_EVENTS,
  currentStreak,
  DEFAULT_CLIENT_LIMIT,
  DEFAULT_SERVER_LIMIT,
  dayKey,
  emptyProgress,
  EVENT_LIMITS,
  isClientEvent,
  isServerEvent,
  levelFor,
  MAX_DAYS_PER_EVENT,
  MAX_KEYS_PER_EVENT,
  newlyEarned,
  pointsOf,
  ruleStatus,
  unlocksFor,
  type AchievementDefinition,
  type AchievementEventType,
  type AchievementItemState,
  type AchievementProgress,
  type AchievementSettings,
  type AchievementSnapshot,
  type AchievementUnlock,
  type PublicAchievementCard,
} from "../shared/achievements.ts";

export type { AchievementItemState, AchievementSettings, AchievementSnapshot, AchievementUnlock, PublicAchievementCard };
import { writeFileAtomic } from "./atomic.ts";

export interface AchievementEvent {
  type: AchievementEventType;
  /** A distinct key (a slash command's name, a character, a call id). */
  key?: string;
  /** A measure (minutes on a call). */
  value?: number;
  /** Counts once: replaying the same id is a no-op. */
  id?: string;
  /** A Mastery fact (type "mastery" only, server only). */
  fact?: MasteryFact;
}

// `public` is shared unless the stored record says false. A missing flag is not an opt-out.
export const DEFAULT_ACHIEVEMENT_SETTINGS: AchievementSettings = Object.freeze({ showPoints: true, showTitle: true, toasts: true, native: false, public: true });

interface PersonRecord extends AchievementProgress {
  settings: AchievementSettings;
  /** Grandfathering ran once for this person. */
  migrated: boolean;
  /** Crab keep-on-upgrade ran once for this person. Missing in stored JSON means false. */
  migratedCrab: boolean;
  /** Ids of events already counted (bounded). */
  seen: string[];
  updatedAt: number;
}

export interface AchievementStore {
  snapshot(person: string): AchievementSnapshot;
  /** Count events for a person; returns what they unlocked. `source` client refuses server events. */
  record(person: string, events: readonly AchievementEvent[], source: "server" | "client"): { accepted: number; unlocked: AchievementUnlock[] };
  updateSettings(person: string, patch: unknown): AchievementSettings;
  /** Cards of people who share them (the default). Absent when they stored public false, or have no record. */
  publicPoints(people: readonly string[]): Record<string, PublicAchievementCard>;
  remove(person: string): void;
  /** Write pending changes now (tests, shutdown). */
  flush(): void;
  /** Everyone with a record (the nightly pass). */
  people(): string[];
  /** The person's day now (YYYY-MM-DD in their time zone). */
  localDay(person: string): string;
  /**
   * The nightly pass for one person: the facts only a look at the whole
   * picture gives (their conversations), then the measures that span days.
   * Returns what that unlocked.
   */
  reconcile(person: string, facts?: readonly MasteryFact[]): AchievementUnlock[];
}

export interface AchievementStoreOptions {
  dataDir: string;
  now?: () => number;
  catalog?: readonly AchievementDefinition[];
  /** Reward keys a person keeps from before achievements existed (their bots' current looks). */
  grandfather?: (person: string) => string[];
  /** Reward keys for people already wearing the crab (one-time crab keep). */
  grandfatherCrab?: (person: string) => string[];
  /** Coalesce writes (petting the mascot is quick); 0 writes at once. */
  persistDelayMs?: number;
}

const PERSON = /^[\w:.@-]{1,128}$/;
const MAX_PEOPLE = 10_000;
const MAX_SEEN = 400;
const MAX_ACTIVE_DAYS = 800;
const MAX_EVENTS_PER_CALL = 32;
/** Under this many people, a percentage would point at someone: none is shown. */
export const MIN_PEOPLE_FOR_PERCENT = 5;

function freshRecord(now: number): PersonRecord {
  return { ...emptyProgress(), settings: { ...DEFAULT_ACHIEVEMENT_SETTINGS }, migrated: false, migratedCrab: false, seen: [], updatedAt: now };
}

function stringList(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length <= 160).slice(-max) : [];
}

function numberMap(value: unknown): Partial<Record<AchievementEventType, number>> {
  const out: Partial<Record<AchievementEventType, number>> = {};
  if (!value || typeof value !== "object") return out;
  for (const event of ACHIEVEMENT_EVENTS) {
    const n = (value as Record<string, unknown>)[event];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[event] = n;
  }
  return out;
}

function listMap(value: unknown, max: number): Partial<Record<AchievementEventType, string[]>> {
  const out: Partial<Record<AchievementEventType, string[]>> = {};
  if (!value || typeof value !== "object") return out;
  for (const event of ACHIEVEMENT_EVENTS) {
    const list = stringList((value as Record<string, unknown>)[event], max);
    if (list.length) out[event] = list;
  }
  return out;
}

export function cleanSettings(input: unknown, base: AchievementSettings = DEFAULT_ACHIEVEMENT_SETTINGS): AchievementSettings {
  const out: AchievementSettings = { ...base };
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const value = input as Record<string, unknown>;
  for (const key of ["showPoints", "showTitle", "toasts", "native", "public"] as const) if (typeof value[key] === "boolean") out[key] = value[key] as boolean;
  if (value.title === null) delete out.title;
  else if (typeof value.title === "string" && /^[a-z0-9-]{1,40}$/.test(value.title)) out.title = value.title;
  if (typeof value.tzOffset === "number" && Number.isInteger(value.tzOffset) && Math.abs(value.tzOffset) <= 14 * 60) out.tzOffset = value.tzOffset;
  return out;
}

function cleanRecord(input: unknown, now: number): PersonRecord {
  const record = freshRecord(now);
  if (!input || typeof input !== "object") return record;
  const value = input as Record<string, unknown>;
  record.counters = numberMap(value.counters);
  record.maxima = numberMap(value.maxima);
  record.keys = listMap(value.keys, MAX_KEYS_PER_EVENT);
  record.days = listMap(value.days, MAX_DAYS_PER_EVENT);
  record.activeDays = stringList(value.activeDays, MAX_ACTIVE_DAYS);
  record.grandfathered = stringList(value.grandfathered, 200);
  record.seen = stringList(value.seen, MAX_SEEN);
  record.migrated = value.migrated === true;
  record.migratedCrab = value.migratedCrab === true;
  record.settings = cleanSettings(value.settings);
  record.updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : now;
  if (value.mastery && typeof value.mastery === "object") record.mastery = cleanMasteryState(value.mastery);
  if (value.unlocked && typeof value.unlocked === "object") {
    for (const [id, at] of Object.entries(value.unlocked as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at)) record.unlocked[id] = at;
    }
  }
  return record;
}

function pushBounded(list: string[], item: string, max: number): boolean {
  if (list.includes(item)) return false;
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
  return true;
}

export function createAchievementStore(options: AchievementStoreOptions): AchievementStore {
  const file = join(options.dataDir, "achievements.json");
  const now = options.now ?? Date.now;
  const catalog = options.catalog ?? ACHIEVEMENTS;
  const delay = options.persistDelayMs ?? 750;
  let people: Record<string, PersonRecord> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** person|type → last counted time and today's count. In memory: a restart forgives. */
  const rate = new Map<string, { last: number; day: string; count: number }>();

  const load = () => {
    if (people) return people;
    people = {};
    if (!existsSync(file)) return people;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown; people?: Record<string, unknown> };
      if (parsed.version === 1 && parsed.people && typeof parsed.people === "object") {
        for (const [id, entry] of Object.entries(parsed.people)) if (PERSON.test(id)) people[id] = cleanRecord(entry, now());
      }
    } catch (error) {
      // A damaged file costs people their trophies, never the server.
      console.warn(`achievements: ${file} could not be read (${error instanceof Error ? error.message : String(error)}); starting empty`);
    }
    return people;
  };

  const write = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!people) return;
    writeFileAtomic(file, `${JSON.stringify({ version: 1, people })}\n`, { mode: 0o600 });
  };

  const persist = (urgent = false) => {
    if (urgent || delay <= 0) return write();
    if (timer) return;
    timer = setTimeout(write, delay);
    timer.unref?.();
  };

  const requirePerson = (person: string) => {
    if (!PERSON.test(person)) throw Object.assign(new Error("not a person"), { status: 403 });
  };

  /** The person's record, created (and grandfathered) on first use. */
  const recordOf = (person: string): PersonRecord => {
    requirePerson(person);
    const all = load();
    let record = all[person];
    if (!record) {
      if (Object.keys(all).length >= MAX_PEOPLE) throw Object.assign(new Error("too many people"), { status: 507 });
      record = freshRecord(now());
      all[person] = record;
    }
    if (!record.migrated) {
      record.migrated = true;
      try {
        for (const key of options.grandfather?.(person) ?? []) pushBounded(record.grandfathered, key, 200);
      } catch {
        /* the bots could not be read: nothing is grandfathered, nothing breaks */
      }
      persist(true);
    }
    if (!record.migratedCrab) {
      record.migratedCrab = true;
      try {
        for (const key of options.grandfatherCrab?.(person) ?? []) pushBounded(record.grandfathered, key, 200);
      } catch {
        /* same as grandfather: nothing breaks */
      }
      persist(true);
    }
    return record;
  };

  const allowed = (person: string, type: AchievementEventType, source: "server" | "client", at: number, day: string): boolean => {
    const limit = EVENT_LIMITS[type] ?? (source === "client" ? DEFAULT_CLIENT_LIMIT : DEFAULT_SERVER_LIMIT);
    const key = `${person}|${type}`;
    const entry = rate.get(key);
    if (entry && entry.day === day) {
      if (at - entry.last < limit.intervalMs || entry.count >= limit.perDay) return false;
      entry.last = at;
      entry.count += 1;
    } else {
      if (rate.size > 50_000) rate.clear();
      rate.set(key, { last: at, day, count: 1 });
    }
    return true;
  };

  const percents = (): Map<string, number> | null => {
    const all = Object.values(load());
    if (all.length < MIN_PEOPLE_FOR_PERCENT) return null;
    const out = new Map<string, number>();
    for (const item of catalog) out.set(item.id, Math.round((all.filter((record) => record.unlocked[item.id]).length / all.length) * 100));
    return out;
  };

  return {
    snapshot(person) {
      const record = recordOf(person);
      const points = pointsOf(record.unlocked, catalog);
      const share = percents();
      const today = dayKey(now(), record.settings.tzOffset ?? 0);
      return {
        points,
        maxPoints: catalog.reduce((sum, item) => sum + item.points, 0),
        level: levelFor(points),
        unlockedCount: catalog.filter((item) => record.unlocked[item.id]).length,
        count: catalog.length,
        streak: currentStreak(record.activeDays, today),
        rewards: [...unlocksFor(record, catalog).keys].sort(),
        recent: Object.entries(record.unlocked)
          .filter(([id]) => catalog.some((item) => item.id === id))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([id]) => id),
        items: catalog.map((item) => {
          const status = ruleStatus(item, record, catalog);
          const unlockedAt = record.unlocked[item.id];
          return {
            id: item.id,
            ...(unlockedAt ? { unlockedAt } : {}),
            current: unlockedAt ? status.target : status.current,
            target: status.target,
            ...(share ? { percent: share.get(item.id) ?? 0 } : {}),
          };
        }),
        settings: { ...record.settings },
      };
    },

    record(person, events, source) {
      const record = recordOf(person);
      const at = now();
      const day = dayKey(at, record.settings.tzOffset ?? 0);
      let accepted = 0;
      for (const event of events.slice(0, MAX_EVENTS_PER_CALL)) {
        if (!event || typeof event !== "object") continue;
        const known = source === "client" ? isClientEvent(event.type) : isServerEvent(event.type) || isClientEvent(event.type);
        if (!known) continue;
        if (event.type === "mastery") {
          // a Mastery fact: its own state, no counter, no active day (a routine
          // that ran at night is not the person using Sagax)
          if (source !== "server" || !event.fact || typeof event.fact !== "object") continue;
          if (typeof event.id === "string" && event.id) {
            const id = `mastery:${event.id}`.slice(0, 160);
            if (record.seen.includes(id)) continue;
            pushBounded(record.seen, id, MAX_SEEN);
          }
          if (!allowed(person, event.type, source, at, day)) continue;
          if (applyMasteryFact((record.mastery ??= emptyMasteryState()), event.fact, at, day)) accepted += 1;
          continue;
        }
        if (typeof event.id === "string" && event.id) {
          const id = `${event.type}:${event.id}`.slice(0, 160);
          if (record.seen.includes(id)) continue;
          if (!allowed(person, event.type, source, at, day)) continue;
          pushBounded(record.seen, id, MAX_SEEN);
        } else if (!allowed(person, event.type, source, at, day)) continue;
        accepted += 1;
        record.counters[event.type] = (record.counters[event.type] ?? 0) + 1;
        if (typeof event.key === "string" && event.key.trim()) {
          const keys = (record.keys[event.type] ??= []);
          pushBounded(keys, event.key.trim().toLowerCase().slice(0, 80), MAX_KEYS_PER_EVENT);
        }
        if (typeof event.value === "number" && Number.isFinite(event.value) && event.value >= 0) {
          record.maxima[event.type] = Math.max(record.maxima[event.type] ?? 0, Math.min(event.value, 1e6));
        }
        pushBounded((record.days[event.type] ??= []), day, MAX_DAYS_PER_EVENT);
        pushBounded(record.activeDays, day, MAX_ACTIVE_DAYS);
      }
      if (!accepted) return { accepted, unlocked: [] };
      const earned = newlyEarned(record, catalog);
      for (const id of earned) record.unlocked[id] = at;
      record.updatedAt = at;
      persist(earned.length > 0);
      return {
        accepted,
        unlocked: earned.map((id) => ({ id, points: catalog.find((item) => item.id === id)?.points ?? 0, unlockedAt: at })),
      };
    },

    updateSettings(person, patch) {
      const record = recordOf(person);
      const next = cleanSettings(patch, record.settings);
      // a title must be one this person unlocked
      if (next.title && !unlocksFor(record, catalog).keys.has(`title:${next.title}`)) delete next.title;
      record.settings = next;
      record.updatedAt = now();
      persist(true);
      return { ...next };
    },

    publicPoints(ids) {
      const all = load();
      const out: Record<string, PublicAchievementCard> = {};
      for (const id of ids.slice(0, 500)) {
        const record = all[id];
        if (!record?.settings.public) continue;
        const points = pointsOf(record.unlocked, catalog);
        // Unlocked ids only. A locked secret is not in this list, and nothing
        // here carries a name or a progress fraction. The client has the catalog.
        const unlocked = catalog.flatMap((item) => {
          const unlockedAt = record.unlocked[item.id];
          return typeof unlockedAt === "number" ? [{ id: item.id, points: item.points, unlockedAt }] : [];
        });
        // "Show my points" / "Show my title" off: the person's own choice,
        // for everyone who looks. A record without the flag shows both.
        out[id] = {
          ...(record.settings.showPoints !== false ? { points, level: levelFor(points).level } : {}),
          ...(record.settings.title && record.settings.showTitle !== false ? { title: record.settings.title } : {}),
          unlocked,
        };
      }
      return out;
    },

    remove(person) {
      const all = load();
      if (!all[person]) return;
      delete all[person];
      persist(true);
    },

    flush() {
      if (timer) write();
    },

    people() {
      return Object.keys(load());
    },

    localDay(person) {
      return dayKey(now(), recordOf(person).settings.tzOffset ?? 0);
    },

    reconcile(person, facts = []) {
      const record = recordOf(person);
      const at = now();
      const day = dayKey(at, record.settings.tzOffset ?? 0);
      const state = (record.mastery ??= emptyMasteryState());
      for (const fact of facts) applyMasteryFact(state, fact, at, day);
      reconcileMastery(state, day);
      const earned = newlyEarned(record, catalog);
      for (const id of earned) record.unlocked[id] = at;
      record.updatedAt = at;
      persist(earned.length > 0);
      return earned.map((id) => ({ id, points: catalog.find((item) => item.id === id)?.points ?? 0, unlockedAt: at }));
    },
  };
}

/* ------------------------------------------------------------------ */
/* What the server's own requests mean                                */
/* ------------------------------------------------------------------ */

export interface RequestFacts {
  method: string;
  path: string;
  status: number;
}

export interface RequestLookups {
  /** A group's people and bots (null: no such group). */
  group(id: string): { peopleDm: boolean; humans: number; bots: number } | null;
}

/** The people a room lists: distinct persons, never a `team:` entry (a team
 * is not a second person) and at least the one who made it. */
export function roomPeopleCount(humanIds: readonly string[] | undefined): number {
  return new Set((humanIds ?? []).filter((id) => !id.startsWith("team:"))).size || 1;
}

/**
 * The events a successful request means for the person who made it, read from
 * its method and path only (the handler already authorized it). A message's
 * content is read where it is sent (achievementSendEvents).
 */
export function achievementRequestEvents(request: RequestFacts, lookups: RequestLookups): AchievementEvent[] {
  if (request.status < 200 || request.status >= 300) return [];
  const { method, path } = request;
  if (method === "POST" && path === "/api/bots") return [{ type: "bot.created" }];
  if (method === "POST" && /^\/api\/bots\/[\w-]+\/primary$/.test(path)) return [{ type: "bot.primary" }];
  if (method === "POST" && path === "/api/routines") return [{ type: "routine.created" }];
  // an approval answered from the bot's panel or from a thread (/api/threads/:id/respond)
  if ((method === "PATCH" && /^\/api\/bots\/[\w-]+\/cards\/[\w-]+$/.test(path)) || (method === "POST" && /^\/api\/(?:bots\/[\w-]+\/(?:respond|requests\/[A-Za-z0-9_-]{16,80})|threads\/[\w-]+\/respond)$/.test(path))) {
    return [{ type: "approval.answered" }];
  }
  if (method === "POST" && /^\/api\/bots\/[\w-]+\/computer\/control$/.test(path)) return [{ type: "computer.control" }];
  if ((method === "POST" || method === "PUT") && /^\/api\/bots\/[\w-]+\/(?:grants(?:\/[^/]+)?|direct-grants)$/.test(path)) return [{ type: "bot.shared" }];
  if (method === "POST" && path === "/api/people-dms") return [{ type: "dm.sent" }];
  const groupSend = method === "POST" ? path.match(/^\/api\/groups\/([\w-]+)\/messages$/) : null;
  if (groupSend) {
    const group = lookups.group(groupSend[1]!);
    if (!group) return [];
    if (group.peopleDm) return [{ type: "dm.sent" }];
    const events: AchievementEvent[] = [{ type: "group.message" }, { type: "message.sent" }];
    if (group.humans >= 2 && group.bots >= 2) events.push({ type: "group.mixed" });
    return events;
  }
  return [];
}

/** A slash command's name as the person typed it ("/compact now" is "compact"). */
export function slashCommandName(text: string): string | null {
  const match = /^\/([\w:.-]{1,64})(?:\s|$)/.exec(text.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * The events a message sent to a bot means: a message, a slash command, an
 * attachment (a .zip one too), a parallel task, and on a voice call the call
 * itself, its length so far and a polite interruption. `callStarts` remembers
 * when each call was first heard from (bounded by the caller).
 */
export function achievementSendEvents(
  input: { text: string; parallel: boolean; voiceCall?: { callId: string; interrupted?: boolean } },
  callStarts: Map<string, number>,
  at: number,
): AchievementEvent[] {
  const events: AchievementEvent[] = [{ type: "message.sent" }];
  const command = slashCommandName(input.text);
  if (command) events.push({ type: "message.slash", key: command });
  if (/<attached-(?:image|file)\b/.test(input.text)) events.push({ type: "message.attachment" });
  if (/<attached-file\b[^>]*\.zip["'\s>]/i.test(input.text)) events.push({ type: "message.zip" });
  if (input.parallel) events.push({ type: "message.parallel" });
  const call = input.voiceCall;
  if (call) {
    if (!callStarts.has(call.callId)) {
      if (callStarts.size >= 2_000) callStarts.clear();
      callStarts.set(call.callId, at);
    }
    events.push({ type: "voice.call", key: call.callId, id: call.callId });
    events.push({ type: "voice.minutes", value: Math.floor((at - callStarts.get(call.callId)!) / 60_000) });
    if (call.interrupted) events.push({ type: "voice.interrupt" });
  }
  return events;
}

/** A routine run's frame: a completed run counts for the routine's person, once per run. */
export function routineRunEvents(run: { id?: unknown; status?: unknown }): AchievementEvent[] {
  return run.status === "completed" && typeof run.id === "string" ? [{ type: "routine.ran", id: run.id }] : [];
}

/** A bot's activity line: a sub-agent at work, or the bot picking its computer on Auto. */
export function activityEvents(message: { kind?: unknown; tool?: { name?: unknown; parentItemId?: unknown; itemId?: unknown } }): AchievementEvent[] {
  if (message.kind !== "activity" || !message.tool) return [];
  const events: AchievementEvent[] = [];
  const parent = message.tool.parentItemId;
  if (typeof parent === "string" && parent) events.push({ type: "subagent.used", id: parent });
  const name = typeof message.tool.name === "string" ? message.tool.name : "";
  if (/(?:^|__|\.)computer_select$/.test(name)) events.push({ type: "computer.auto", ...(typeof message.tool.itemId === "string" ? { id: message.tool.itemId } : {}) });
  return events;
}

/** May this live stream see an achievements frame? Only its person's. */
export function achievementFrameAllowed(payload: { kind?: unknown; audience?: unknown }, viewerId: string | undefined, localPersonId: string): boolean {
  if (payload.kind !== "achievements") return true;
  return payload.audience === (viewerId ?? localPersonId);
}
