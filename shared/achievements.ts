// Achievements: the types, the rules and the pure engine. The catalog itself
// is data (shared/achievements-catalog.ts); the server keeps each person's
// progress (server/achievements/achievements.ts) and the app draws it (src/lib/achievements.ts).
//
// An achievement is unlocked by events. A server event is one the server saw
// happen (a message sent, a routine that ran); a client event is one only the
// app can see (the mascot petted, the Files tab opened). The server refuses a
// client that posts a server event, so what teaches real use cannot be faked
// from the outside; client events only unlock cosmetic things anyway.
//
// Unlocking is idempotent: an achievement unlocks once, its rewards stay. The
// rewards are what the mascot editor and the app icon picker unlock: a
// character (Trombi, Bunbu, Shiba, Grump, Ogre, Frog), a skin of a character, an app icon, or a title.
import { botMascotSkin, MASCOT_SKIN_IDS, OWL_SKIN_TIER, type MascotSkinId } from "./mascot-skins.ts";
import {
  BUNBU_SKIN_TIER,
  BUNBU_SKINS,
  CRAB_SKIN_TIER,
  CRAB_SKINS,
  SHAPE_SKIN_TIER,
  SHAPE_SKINS,
  TROMBI_SKIN_TIER,
  TROMBI_SKINS,
  completeMascotLook,
  type MascotCharacter,
  type SkinTier,
} from "./mascot-look.ts";
import { isMasteryCharacter, masteryKey, masteryLock, masterySkins, masterySkinTier, type MasteryCharacter } from "./mascot-unlocks.ts";
import { masteryMetricValue, type MasteryMetric, type MasteryState } from "./achievements-mastery.ts";

/** Events the server records by itself. A client may never post one. */
export const SERVER_EVENTS = [
  "message.sent",
  "message.slash",
  "message.attachment",
  "message.zip",
  "message.parallel",
  "group.message",
  "group.mixed",
  "dm.sent",
  "bot.created",
  "bot.primary",
  "bot.shared",
  "routine.created",
  "routine.ran",
  "approval.answered",
  "computer.control",
  "computer.auto",
  "subagent.used",
  "voice.call",
  "voice.minutes",
  "voice.interrupt",
  /** A Mastery fact (shared/achievements-mastery.ts): carries `fact`, counts nothing else. */
  "mastery",
  "claude.linked",
  "claude.turn",
  "claude.subagent",
  "claude.routine",
  "claude.computer",
  "claude.voice",
] as const;

/** Events the app reports (POST /api/me/achievements/events). */
export const CLIENT_EVENTS = [
  "app.opened",
  "trombi.summoned",
  "grok.linked",
  "konami",
  "mascot.pet",
  "mascot.midnight",
  "mascot.floated",
  "bot.customized",
  "files.opened",
  "fullaccess.granted",
  "fullaccess.revoked",
  "achievements.viewed",
  "appicon.changed",
  "palette.opened",
  "shortcuts.opened",
] as const;

export type ServerEvent = (typeof SERVER_EVENTS)[number];
export type ClientEvent = (typeof CLIENT_EVENTS)[number];
export type AchievementEventType = ServerEvent | ClientEvent;

export const ACHIEVEMENT_EVENTS: readonly AchievementEventType[] = [...SERVER_EVENTS, ...CLIENT_EVENTS];

const serverEvents: ReadonlySet<string> = new Set(SERVER_EVENTS);
const clientEvents: ReadonlySet<string> = new Set(CLIENT_EVENTS);

export function isServerEvent(type: unknown): type is ServerEvent {
  return typeof type === "string" && serverEvents.has(type);
}

export function isClientEvent(type: unknown): type is ClientEvent {
  return typeof type === "string" && clientEvents.has(type);
}

/** Anti-spam per event type: at most one counted every `intervalMs`, at most `perDay` a day. */
export const EVENT_LIMITS: Readonly<Partial<Record<AchievementEventType, { intervalMs: number; perDay: number }>>> = {
  "mascot.pet": { intervalMs: 250, perDay: 400 },
  "app.opened": { intervalMs: 60_000, perDay: 48 },
  "bot.customized": { intervalMs: 500, perDay: 100 },
  "files.opened": { intervalMs: 2_000, perDay: 50 },
  "palette.opened": { intervalMs: 2_000, perDay: 50 },
  "shortcuts.opened": { intervalMs: 2_000, perDay: 50 },
  "achievements.viewed": { intervalMs: 2_000, perDay: 50 },
  "appicon.changed": { intervalMs: 2_000, perDay: 50 },
  "mascot.floated": { intervalMs: 1_000, perDay: 50 },
  // every Mastery fact shares this type: tool lines and turns add up on a busy day
  mastery: { intervalMs: 0, perDay: 50_000 },
};
/** The default for any other client event. Server events are trusted but still bounded. */
export const DEFAULT_CLIENT_LIMIT = { intervalMs: 1_000, perDay: 100 };
export const DEFAULT_SERVER_LIMIT = { intervalMs: 0, perDay: 5_000 };

// "mastery" is the Mastery tier (Maîtrise): the hard achievements that prove
// real use of AI and of Sagax and unlock the Mastery characters
// (shared/mascot-unlocks.ts). "tiers" holds the points tiers (Bronze to Platinum).
export const ACHIEVEMENT_CATEGORIES = ["onboarding", "productivity", "power", "voice", "claude", "collaboration", "streaks", "mastery", "tiers", "secrets"] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

/** Gamerscore-like values; 150 and above belong to the Mastery tier. */
export const ACHIEVEMENT_POINTS = [5, 10, 20, 50, 100, 150, 200, 250, 300] as const;
export type AchievementPoints = (typeof ACHIEVEMENT_POINTS)[number];

/** An achievement's rarity follows its points. */
export function rarityForPoints(points: AchievementPoints): SkinTier {
  if (points >= 100) return "legendary";
  if (points >= 50) return "epic";
  if (points >= 20) return "rare";
  return "common";
}

export type AchievementRule =
  /** The event happened `target` times. */
  | { kind: "count"; event: AchievementEventType; target: number }
  /** `target` different keys of the event (slash commands, characters, calls). */
  | { kind: "distinct"; event: AchievementEventType; target: number }
  /** The event happened on `target` different days. */
  | { kind: "days"; event: AchievementEventType; target: number }
  /** The largest value the event carried reached `target` (minutes on a call). */
  | { kind: "max"; event: AchievementEventType; target: number }
  /** Each of these events happened at least once. */
  | { kind: "all"; events: readonly AchievementEventType[] }
  /** Active `target` days in a row. */
  | { kind: "streak"; target: number }
  /** `target` consecutive days the named event happened. */
  | { kind: "eventStreak"; event: AchievementEventType; target: number }
  /** Active on `target` days in all. */
  | { kind: "activeDays"; target: number }
  /** `target` points earned from the other achievements. */
  | { kind: "points"; target: number }
  /** Every other achievement that is not secret, the Mastery tier aside. */
  | { kind: "completion" }
  /** A Mastery measure (shared/achievements-mastery.ts) reached `target`. */
  | { kind: "mastery"; metric: MasteryMetric; target: number }
  /** `target` other achievements of this category unlocked. */
  | { kind: "category"; category: AchievementCategory; target: number };

/** A character a reward names: one this build draws, or a Mastery character (shared/mascot-unlocks.ts) that may not have landed yet. */
export type RewardCharacter = MascotCharacter | MasteryCharacter;

export type AchievementReward =
  | { kind: "character"; character: Exclude<RewardCharacter, "owl"> }
  | { kind: "skin"; character: RewardCharacter; skin: string }
  | { kind: "appIcon"; id: string }
  | { kind: "title"; id: string; name: Localized }
  | { kind: "emote"; character: RewardCharacter; id: string }
  | { kind: "move"; character: RewardCharacter; id: string }
  | { kind: "accessory"; id: string }
  | { kind: "effect"; id: string };

export interface Localized {
  en: string;
  fr: string;
  /** Portuguese (Brazil); English stands in when absent. */
  ptBR?: string;
}

export interface AchievementDefinition {
  id: string;
  category: AchievementCategory;
  name: Localized;
  description: Localized;
  /** A lucide icon name the app maps to a component (src/components/achievements/icons.ts). */
  icon: string;
  points: AchievementPoints;
  /** Secret: its name and description stay hidden until it unlocks. */
  hidden?: boolean;
  /** A secret's nudge, shown on what it unlocks (never its answer). */
  hint?: Localized;
  rule: AchievementRule;
  rewards: readonly AchievementReward[];
}

/* ------------------------------------------------------------------ */
/* What the server answers (GET /api/me/achievements)                 */
/* ------------------------------------------------------------------ */

export interface AchievementSettings {
  /** My points, wherever my card shows them (my own card, colleagues' view of
   * it). The sidebar never shows points. On unless this record stored false. */
  showPoints: boolean;
  /** My chosen title, wherever my card shows it, the same way as showPoints.
   * Missing on an older record means on. */
  showTitle: boolean;
  /** The in-app unlock toast. */
  toasts: boolean;
  /** A system notification when an unlock lands while the app is in the background. */
  native: boolean;
  /** Colleagues may see my points. On unless this record stored false. */
  public: boolean;
  /** The title shown on my achievements page, one I unlocked. */
  title?: string;
  /** Minutes east of UTC, for days and streaks (ET in summer: -240). */
  tzOffset?: number;
}

export interface AchievementUnlock {
  id: string;
  points: number;
  unlockedAt: number;
}

/**
 * What colleagues may see of one person (GET /api/achievements/public).
 * Sharing is on unless `settings.public` is false. Locked achievements are not
 * here: no locked ids, no secret names, no progress.
 */
export interface PublicAchievementCard {
  /** Absent when they turned "Show my points" off. */
  points?: number;
  /** Absent with the points. */
  level?: number;
  /** The title id they chose. Absent when they chose none or turned "Show my title" off. */
  title?: string;
  /** Unlocked achievements only, catalog order. */
  unlocked: AchievementUnlock[];
}

export interface AchievementItemState {
  id: string;
  unlockedAt?: number;
  current: number;
  target: number;
  /** Share of this server's people who unlocked it, when there are enough people to say it without naming anyone. */
  percent?: number;
}

export interface AchievementSnapshot {
  points: number;
  maxPoints: number;
  level: { level: number; from: number; to: number };
  unlockedCount: number;
  count: number;
  streak: number;
  /** Reward keys this person may use (rewards earned plus grandfathered). */
  rewards: string[];
  /** Ids of the last unlocks, newest first. */
  recent: string[];
  items: AchievementItemState[];
  settings: AchievementSettings;
}

/* ------------------------------------------------------------------ */
/* Progress                                                           */
/* ------------------------------------------------------------------ */

/** One person's raw progress, as the server stores it. */
export interface AchievementProgress {
  counters: Partial<Record<AchievementEventType, number>>;
  maxima: Partial<Record<AchievementEventType, number>>;
  /** Distinct keys per event (bounded). */
  keys: Partial<Record<AchievementEventType, string[]>>;
  /** Distinct days (YYYY-MM-DD in the person's time zone) per event (bounded). */
  days: Partial<Record<AchievementEventType, string[]>>;
  /** Days the person was active (bounded to the last few hundred). */
  activeDays: string[];
  /** Achievement id → when it unlocked (ms). */
  unlocked: Record<string, number>;
  /** Rewards kept from before achievements existed (what was in use). */
  grandfathered: string[];
  /** The Mastery tier's measures (shared/achievements-mastery.ts). */
  mastery?: MasteryState;
}

export function emptyProgress(): AchievementProgress {
  return { counters: {}, maxima: {}, keys: {}, days: {}, activeDays: [], unlocked: {}, grandfathered: [] };
}

export const MAX_KEYS_PER_EVENT = 64;
export const MAX_DAYS_PER_EVENT = 400;

/** The day a time falls on, in a zone `offsetMinutes` east of UTC (ET in summer is -240). */
export function dayKey(at: number, offsetMinutes = 0): string {
  return new Date(at + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** The run of consecutive active days ending today (or yesterday: a streak lasts until a day is missed). */
export function currentStreak(activeDays: readonly string[], today: string): number {
  const days = new Set(activeDays);
  let cursor = days.has(today) ? today : previousDay(today);
  let run = 0;
  while (days.has(cursor)) {
    run += 1;
    cursor = previousDay(cursor);
  }
  return run;
}

/** The longest run of consecutive days ever (what a streak achievement checks). */
export function longestStreak(activeDays: readonly string[]): number {
  const sorted = [...new Set(activeDays)].sort();
  let best = 0;
  let run = 0;
  let last: string | null = null;
  for (const day of sorted) {
    run = last !== null && previousDay(day) === last ? run + 1 : 1;
    best = Math.max(best, run);
    last = day;
  }
  return best;
}

export interface RuleStatus {
  current: number;
  target: number;
  done: boolean;
}

export function pointsOf(unlocked: Readonly<Record<string, number>>, catalog: readonly AchievementDefinition[]): number {
  return catalog.reduce((sum, item) => sum + (unlocked[item.id] ? item.points : 0), 0);
}

/** Where a rule stands for this progress. Pure; the meta rules read `catalog`. */
export function ruleStatus(definition: AchievementDefinition, progress: AchievementProgress, catalog: readonly AchievementDefinition[]): RuleStatus {
  const rule = definition.rule;
  const of = (current: number, target: number): RuleStatus => ({ current: Math.min(current, target), target, done: current >= target });
  switch (rule.kind) {
    case "count":
      return of(progress.counters[rule.event] ?? 0, rule.target);
    case "distinct":
      return of(progress.keys[rule.event]?.length ?? 0, rule.target);
    case "days":
      return of(progress.days[rule.event]?.length ?? 0, rule.target);
    case "max":
      return of(progress.maxima[rule.event] ?? 0, rule.target);
    case "all":
      return of(rule.events.filter((event) => (progress.counters[event] ?? 0) > 0).length, rule.events.length);
    case "streak":
      return of(longestStreak(progress.activeDays), rule.target);
    case "eventStreak":
      return of(longestStreak(progress.days[rule.event] ?? []), rule.target);
    case "activeDays":
      return of(new Set(progress.activeDays).size, rule.target);
    case "points": {
      const others = catalog.filter((item) => item.id !== definition.id && item.rule.kind !== "points" && item.rule.kind !== "completion");
      return of(pointsOf(progress.unlocked, others), rule.target);
    }
    case "completion": {
      const others = catalog.filter((item) => item.id !== definition.id && !item.hidden && item.rule.kind !== "completion" && item.category !== "mastery");
      return of(others.filter((item) => progress.unlocked[item.id]).length, others.length);
    }
    case "mastery":
      return of(masteryMetricValue(progress.mastery, rule.metric), rule.target);
    case "category": {
      const others = catalog.filter((item) => item.id !== definition.id && item.category === rule.category);
      return of(others.filter((item) => progress.unlocked[item.id]).length, rule.target);
    }
  }
}

/**
 * The achievements this progress now earns and has not unlocked yet. Runs to a
 * fixed point, so an unlock that crosses a points tier unlocks that tier in
 * the same pass. Never removes an unlock.
 */
export function newlyEarned(progress: AchievementProgress, catalog: readonly AchievementDefinition[]): string[] {
  const unlocked = { ...progress.unlocked };
  const earned: string[] = [];
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const item of catalog) {
      if (unlocked[item.id]) continue;
      if (ruleStatus(item, { ...progress, unlocked }, catalog).done) {
        unlocked[item.id] = 1;
        earned.push(item.id);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return earned;
}

/* ------------------------------------------------------------------ */
/* Levels                                                             */
/* ------------------------------------------------------------------ */

/** Points a level starts at: 0, 50, 150, 300, 500, 750... (each level 50 more than the last). */
export function levelStart(level: number): number {
  return 25 * (level - 1) * level;
}

export function levelFor(points: number): { level: number; from: number; to: number } {
  let level = 1;
  while (levelStart(level + 1) <= points) level += 1;
  return { level, from: levelStart(level), to: levelStart(level + 1) };
}

/* ------------------------------------------------------------------ */
/* What is unlocked                                                   */
/* ------------------------------------------------------------------ */

/** A reward as one string, the form the store and the lock checks use. */
export function rewardKey(reward: AchievementReward): string {
  switch (reward.kind) {
    case "character":
      return `character:${reward.character}`;
    case "skin":
      return `skin:${reward.character}:${reward.skin}`;
    case "appIcon":
      return `appIcon:${reward.id}`;
    case "title":
      return `title:${reward.id}`;
    case "emote":
      return `emote:${reward.character}:${reward.id}`;
    case "move":
      return `move:${reward.character}:${reward.id}`;
    case "accessory":
      return `accessory:${reward.id}`;
    case "effect":
      return `effect:${reward.id}`;
  }
}

export type RewardRegistry = {
  emotes: Readonly<Partial<Record<RewardCharacter, readonly string[]>>>;
  moves: Readonly<Partial<Record<RewardCharacter, readonly string[]>>>;
  accessories: readonly string[];
  effects: readonly string[];
};

export const REWARD_REGISTRY: RewardRegistry = {
  emotes: { crab: ["neutral", "happy", "curious", "sleepy"] },
  moves: {},
  accessories: [],
  effects: [],
};

export function rewardLineVisible(reward: AchievementReward): boolean {
  switch (reward.kind) {
    case "character":
    case "skin":
    case "appIcon":
    case "title":
      return true;
    case "emote":
      return (REWARD_REGISTRY.emotes[reward.character] ?? []).includes(reward.id);
    case "move":
      return (REWARD_REGISTRY.moves[reward.character] ?? []).includes(reward.id);
    case "accessory":
      return (REWARD_REGISTRY.accessories as readonly string[]).includes(reward.id);
    case "effect":
      return (REWARD_REGISTRY.effects as readonly string[]).includes(reward.id);
  }
}

/** Unlocked from the start: the owl, with its Common skins. The crab waits for a linked Claude account. Shapes waits for a linked Grok account. */
export const DEFAULT_CHARACTERS: readonly MascotCharacter[] = ["owl"];

/** The rarity of a character's skin, by its id. */
export function skinTier(character: RewardCharacter, skin: string): SkinTier {
  switch (character) {
    case "owl":
      return (OWL_SKIN_TIER as Record<string, SkinTier>)[skin] ?? "common";
    case "shape":
      return (SHAPE_SKIN_TIER as Record<string, SkinTier>)[skin] ?? "common";
    case "trombi":
      return (TROMBI_SKIN_TIER as Record<string, SkinTier>)[skin] ?? "common";
    case "bunbu":
      return (BUNBU_SKIN_TIER as Record<string, SkinTier>)[skin] ?? "common";
    case "crab":
      return (CRAB_SKIN_TIER as Record<string, SkinTier>)[skin] ?? "common";
    default:
      // a Mastery character, drawn by this build or not yet: the registry's rarity
      return masterySkinTier(skin);
  }
}

export function skinsOf(character: RewardCharacter): readonly string[] {
  switch (character) {
    case "owl":
      return MASCOT_SKIN_IDS;
    case "shape":
      return SHAPE_SKINS;
    case "trombi":
      return TROMBI_SKINS;
    case "bunbu":
      return BUNBU_SKINS;
    case "crab":
      return CRAB_SKINS;
    default:
      return isMasteryCharacter(character) ? masterySkins(character) : [];
  }
}

/** Everything a person may use: the defaults plus their rewards and grandfathered items. */
export interface Unlocks {
  /** False when the server keeps no achievements (an older server): nothing is locked. */
  enforced: boolean;
  keys: ReadonlySet<string>;
}

export const NOTHING_LOCKED: Unlocks = Object.freeze({ enforced: false, keys: new Set<string>() });

/** Before a snapshot arrives. Owl, plus a look already worn. A 404 is `NOTHING_LOCKED`. */
export const LOCKED_UNTIL_LOADED: Unlocks = Object.freeze({ enforced: true, keys: new Set<string>() });

export function unlocksFor(progress: Pick<AchievementProgress, "unlocked" | "grandfathered">, catalog: readonly AchievementDefinition[]): Unlocks {
  const keys = new Set<string>(progress.grandfathered);
  for (const item of catalog) {
    if (!progress.unlocked[item.id]) continue;
    for (const reward of item.rewards) keys.add(rewardKey(reward));
    // a Mastery achievement also unlocks what the registry gives it later (a named skin a character registers after)
    if (item.category === "mastery") keys.add(masteryKey(item.id));
  }
  return { enforced: true, keys };
}

export function characterUnlocked(unlocks: Unlocks, character: RewardCharacter): boolean {
  if (!unlocks.enforced) return true;
  if (isMasteryCharacter(character)) return !masteryLock(unlocks.keys, character).locked;
  if (DEFAULT_CHARACTERS.includes(character) || unlocks.keys.has(`character:${character}`)) return true;
  // An earned skin lets its character be worn in it (2026-10-14): a skin
  // rewarded on a character still locked was neither shown nor wearable.
  // Trombi stays the easter egg: only its hidden command reveals it.
  if (character === "trombi") return false;
  const prefix = `skin:${character}:`;
  for (const key of unlocks.keys) if (key.startsWith(prefix)) return true;
  return false;
}

/**
 * A skin is usable when its character is and it is Common (a character's
 * Common skins come with it), or when it was earned or grandfathered.
 */
export function skinUnlocked(unlocks: Unlocks, character: RewardCharacter, skin: string): boolean {
  if (!unlocks.enforced) return true;
  if (isMasteryCharacter(character)) return !masteryLock(unlocks.keys, character, skin).locked;
  if (unlocks.keys.has(`skin:${character}:${skin}`)) return true;
  return skinTier(character, skin) === "common" && characterUnlocked(unlocks, character);
}

/** The app icon ids an achievement rewards; any other icon follows the mascot it draws. */
export function rewardedAppIcons(catalog: readonly AchievementDefinition[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const item of catalog) for (const reward of item.rewards) if (reward.kind === "appIcon") ids.add(reward.id);
  return ids;
}

/** The achievement that rewards this key (the editor's "unlocked by"), if any. */
export function achievementRewarding(key: string, catalog: readonly AchievementDefinition[]): AchievementDefinition | undefined {
  return catalog.find((item) => item.rewards.some((reward) => rewardKey(reward) === key));
}

/* ------------------------------------------------------------------ */
/* Grandfathering                                                     */
/* ------------------------------------------------------------------ */

/**
 * What a person keeps from before achievements existed: every character and
 * skin their bots wear or wore (each character keeps its own skin choice, so
 * a stored skin was used once). Nothing anyone selected ever turns locked.
 */
export function grandfatheredFromBots(bots: ReadonlyArray<{ mascotLook?: unknown; mascotSkin?: unknown }>): string[] {
  const keys = new Set<string>();
  for (const bot of bots) {
    const stored = bot.mascotLook && typeof bot.mascotLook === "object" ? (bot.mascotLook as { skins?: Record<string, unknown> }) : null;
    const look = completeMascotLook(bot.mascotLook);
    if (look.character !== "owl") keys.add(`character:${look.character}`);
    const owlSkin: MascotSkinId = botMascotSkin(bot.mascotSkin);
    if (OWL_SKIN_TIER[owlSkin] !== "common") keys.add(`skin:owl:${owlSkin}`);
    for (const character of ["shape", "trombi", "bunbu", "crab"] as const) {
      // The editor saves every character's skin on any change (filled with
      // the Common default), so only a skin above Common says it was chosen:
      // then that skin, and its character, were in use.
      if (!stored?.skins || stored.skins[character] === undefined) continue;
      const skin = look.skins[character];
      if (skinTier(character, skin) === "common") continue;
      keys.add(`skin:${character}:${skin}`);
      keys.add(`character:${character}`);
    }
  }
  return [...keys].sort();
}

/**
 * One-time crab keep: people already wearing the crab keep it without linking
 * Claude. Leftover skins.crab on an owl grants nothing. Do not replay
 * grandfatheredFromBots.
 */
export function migratedCrabFromBots(bots: ReadonlyArray<{ mascotLook?: unknown }>): string[] {
  const keys = new Set<string>();
  for (const bot of bots) {
    const look = completeMascotLook(bot.mascotLook);
    if (look.character !== "crab") continue;
    keys.add("character:crab");
    const skin = look.skins.crab;
    if (skinTier("crab", skin) !== "common") keys.add(`skin:crab:${skin}`);
  }
  return [...keys].sort();
}
