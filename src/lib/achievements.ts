// The app's side of achievements (shared/achievements.ts, server/achievements/achievements.ts):
// the person's snapshot from GET /api/me/achievements, the client events the
// app reports (batched, POST /api/me/achievements/events), the unlock frames
// that feed the toast queue, and what the mascot editor and the app icon
// picker may offer (useUnlocks).
//
// Until GET answers, pickers stay enforced (the owl, plus a look already
// worn). A server without achievements answers 404: then nothing is locked
// and nothing is reported. Any other failure keeps the lock.
import { useSyncExternalStore } from "react";
import { ACHIEVEMENTS, achievementById } from "../../shared/achievements-catalog";
import {
  achievementRewarding,
  characterUnlocked,
  LOCKED_UNTIL_LOADED,
  NOTHING_LOCKED,
  rewardedAppIcons,
  rewardLineVisible,
  skinUnlocked,
  type AchievementDefinition,
  type AchievementItemState,
  type AchievementReward,
  type AchievementSettings,
  type AchievementSnapshot,
  type AchievementUnlock,
  type ClientEvent,
  type Localized,
  type RewardCharacter,
  type Unlocks,
} from "../../shared/achievements";
import { isMasteryCharacter, masteryCharacterName, masteryLock, masterySkinName, type MasteryName } from "../../shared/mascot-unlocks";
import { en as englishStrings } from "@/locales";
import { activeLocale, t } from "./i18n";
import type { LocaleKey } from "@/locales";
import { achievementToasts } from "./achievement-toasts";

export type AchievementsStatus = "idle" | "loading" | "ready" | "unavailable";

interface State {
  status: AchievementsStatus;
  snapshot: AchievementSnapshot | null;
  unlocks: Unlocks;
}

let state: State = { status: "idle", snapshot: null, unlocks: LOCKED_UNTIL_LOADED };
const listeners = new Set<() => void>();

function setState(next: Partial<State>): void {
  state = { ...state, ...next };
  if (next.snapshot) state.unlocks = unlocksFromSnapshot(next.snapshot);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What a snapshot lets the person use: the rewards the server lists. */
export function unlocksFromSnapshot(snapshot: Pick<AchievementSnapshot, "rewards">): Unlocks {
  return { enforced: true, keys: new Set(snapshot.rewards) };
}

export function achievementsState(): State {
  return state;
}

export function useAchievements(): State {
  return useSyncExternalStore(subscribe, achievementsState, achievementsState);
}

export function useUnlocks(): Unlocks {
  return useSyncExternalStore(subscribe, () => state.unlocks, () => state.unlocks);
}

/** The unlocks now, outside a component (a bot's app icon change, #1545). */
export function currentUnlocks(): Unlocks {
  return state.unlocks;
}

/** Test seam: start over. */
export function resetAchievementsForTests(next: Partial<State> = {}): void {
  state = { status: "idle", snapshot: null, unlocks: LOCKED_UNTIL_LOADED, ...next };
  if (next.snapshot) state.unlocks = unlocksFromSnapshot(next.snapshot);
  pending = [];
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (path, init) => fetch(path, { credentials: "same-origin", ...init });

export function setAchievementsFetcher(next: Fetcher): void {
  fetcher = next;
}

export async function loadAchievements(): Promise<void> {
  if (state.status === "unavailable") return;
  if (state.status === "idle") setState({ status: "loading" });
  try {
    const response = await fetcher("/api/me/achievements");
    if (response.status === 404) return setState({ status: "unavailable", snapshot: null, unlocks: NOTHING_LOCKED });
    if (!response.ok) return;
    setState({ status: "ready", snapshot: (await response.json()) as AchievementSnapshot });
  } catch {
    /* offline: keep what we had */
  }
}

/* ------------------------------------------------------------------ */
/* Client events                                                      */
/* ------------------------------------------------------------------ */

let pending: Array<{ type: ClientEvent; key?: string; value?: number }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Something only the app sees happened. Batched for a moment (petting is
 * quick); the server rate limits and counts. Free when the server keeps no
 * achievements.
 */
export function reportAchievement(type: ClientEvent, extra: { key?: string; value?: number } = {}): void {
  if (state.status === "unavailable") return;
  if (pending.length >= 32) return;
  pending.push({ type, ...extra });
  if (flushTimer) return;
  flushTimer = setTimeout(() => void flushAchievementEvents(), 400);
}

export async function flushAchievementEvents(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!pending.length || state.status === "unavailable") return;
  const events = pending;
  pending = [];
  try {
    const response = await fetcher("/api/me/achievements/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
    });
    if (response.status === 404) return setState({ status: "unavailable", snapshot: null, unlocks: NOTHING_LOCKED });
    if (!response.ok) return;
    const body = (await response.json()) as { unlocked?: AchievementUnlock[]; snapshot?: AchievementSnapshot };
    if (body.snapshot) setState({ status: "ready", snapshot: body.snapshot });
    if (body.unlocked?.length) announceUnlocks(body.unlocked);
  } catch {
    /* offline: these few events are lost, nothing else */
  }
}

/** The server's live frame: { kind: "achievements", unlocked }. */
export function receiveAchievementsFrame(frame: { unlocked?: unknown }): void {
  const unlocked = Array.isArray(frame.unlocked) ? (frame.unlocked as AchievementUnlock[]).filter((item) => item && typeof item.id === "string") : [];
  if (!unlocked.length) return;
  announceUnlocks(unlocked);
  void loadAchievements();
}

/** Fired on the window when achievements unlock (the desktop mascots react: a Shiba turns in circles). */
export const ACHIEVEMENT_UNLOCKED_EVENT = "sagax:achievement-unlocked";

function announceUnlocks(unlocked: readonly AchievementUnlock[]): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent(ACHIEVEMENT_UNLOCKED_EVENT));
  if (state.snapshot?.settings.toasts === false) {
    achievementToasts.markSeen(unlocked.map((item) => item.id));
    return;
  }
  achievementToasts.enqueue(unlocked.map((item) => item.id));
}

export async function saveAchievementSettings(patch: Omit<Partial<AchievementSettings>, "title"> & { title?: string | null }): Promise<void> {
  if (state.snapshot) setState({ snapshot: { ...state.snapshot, settings: { ...state.snapshot.settings, ...(patch as AchievementSettings) } } });
  try {
    const response = await fetcher("/api/me/achievements/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: patch }),
    });
    if (!response.ok) return void loadAchievements();
    const body = (await response.json()) as { settings: AchievementSettings };
    if (state.snapshot) setState({ snapshot: { ...state.snapshot, settings: body.settings } });
  } catch {
    void loadAchievements();
  }
}

/* ------------------------------------------------------------------ */
/* Words                                                              */
/* ------------------------------------------------------------------ */

export function localized(text: Localized | MasteryName): string {
  const locale = activeLocale();
  if (locale.startsWith("fr")) return text.fr;
  if (locale.startsWith("pt") && text.ptBR) return text.ptBR;
  return text.en;
}

// The characters this build names in its locales. A Mastery character
// (shared/mascot-unlocks.ts) that has not landed yet is named by the registry;
// once its branch adds `floatingBots.mascot.<id>`, that wins.
const CHARACTER_KEY: Readonly<Record<string, LocaleKey>> = {
  owl: "floatingBots.mascot.owl",
  shape: "floatingBots.mascot.body",
  trombi: "floatingBots.mascot.trombi",
  bunbu: "floatingBots.mascot.bunbu",
  shiba: "floatingBots.mascot.shiba",
  grump: "floatingBots.mascot.grump",
  ogre: "floatingBots.mascot.ogre",
  frog: "floatingBots.mascot.frog",
  crab: "floatingBots.mascot.crab",
};

/** The English pack carries every key this build knows. */
function hasLocaleKey(key: string): boolean {
  return Object.hasOwn(englishStrings, key);
}

export function characterName(character: RewardCharacter): string {
  const key = CHARACTER_KEY[character] ?? `floatingBots.mascot.${character}`;
  if (hasLocaleKey(key)) return t(key as LocaleKey);
  return isMasteryCharacter(character) ? localized(masteryCharacterName(character)) : character;
}

export function skinName(character: RewardCharacter, skin: string): string {
  const key = character === "owl" ? `mascot.skin.${skin === "none" ? "classic" : skin}` : `mascot.${character === "shape" ? "shapeSkin" : `${character}Skin`}.${skin}`;
  if (hasLocaleKey(key)) return t(key as LocaleKey);
  return isMasteryCharacter(character) ? localized(masterySkinName(character, skin)) : skin;
}

/** Shown on a card: surprise copy while the character is locked, nothing for an unregistered item. */
export function displayReward(reward: AchievementReward, unlocks: Unlocks, options?: { revealing?: boolean }): string | null {
  if (!rewardLineVisible(reward)) return null;
  const surprise = !options?.revealing && (reward.kind === "character" || reward.kind === "skin") && !characterUnlocked(unlocks, reward.character);
  if (surprise && reward.kind === "character") return t("achievements.reward.surpriseCharacter");
  if (surprise && reward.kind === "skin") return t("achievements.reward.surpriseLook");
  return rewardLabel(reward);
}

function rewardIdName(id: string): string {
  return id ? id[0]!.toUpperCase() + id.slice(1) : id;
}

/** "Skin unlocked: Galaxy (Owl)", "Character unlocked: Trombi", "Title unlocked: Rookie". */
export function rewardLabel(reward: AchievementReward): string {
  switch (reward.kind) {
    case "character":
      return t("achievements.reward.character", { name: characterName(reward.character) });
    case "skin":
      return t("achievements.reward.skin", { name: skinName(reward.character, reward.skin), character: characterName(reward.character) });
    case "appIcon":
      return t("achievements.reward.appIcon");
    case "title":
      return t("achievements.reward.title", { name: localized(reward.name) });
    case "emote":
      return t("achievements.reward.emote", { name: rewardIdName(reward.id) });
    case "move":
      return t("achievements.reward.move", { name: rewardIdName(reward.id) });
    case "accessory":
      return t("achievements.reward.accessory", { name: rewardIdName(reward.id) });
    case "effect":
      return t("achievements.reward.effect", { name: rewardIdName(reward.id) });
  }
}

/* ------------------------------------------------------------------ */
/* Locks                                                              */
/* ------------------------------------------------------------------ */

export interface LockInfo {
  locked: boolean;
  /** A Mastery look: shown locked, with its achievement and progress, rather than hidden. */
  mastery?: boolean;
  /** The achievement that unlocks it, when one does. */
  achievement?: AchievementDefinition;
  item?: AchievementItemState;
}

function itemState(id: string): AchievementItemState | undefined {
  return state.snapshot?.items.find((item) => item.id === id);
}

/** A Mastery look's lock (shared/mascot-unlocks.ts): the achievement, its progress, `mastery` set so the editor shows it locked instead of hiding it. */
function masteryLockInfo(unlocks: Unlocks, character: RewardCharacter, skin?: string): LockInfo | null {
  if (!isMasteryCharacter(character)) return null;
  if (!unlocks.enforced) return { locked: false };
  const lock = masteryLock(unlocks.keys, character, skin);
  if (!lock.locked || !lock.achievement) return { locked: false };
  const achievement = achievementById(lock.achievement);
  return { locked: true, mastery: true, achievement, item: achievement ? itemState(achievement.id) : undefined };
}

export function characterLock(unlocks: Unlocks, character: RewardCharacter): LockInfo {
  const mastery = masteryLockInfo(unlocks, character);
  if (mastery) return mastery;
  if (characterUnlocked(unlocks, character)) return { locked: false };
  const achievement = achievementRewarding(`character:${character}`, ACHIEVEMENTS);
  return { locked: true, achievement, item: achievement ? itemState(achievement.id) : undefined };
}

export function skinLock(unlocks: Unlocks, character: RewardCharacter, skin: string): LockInfo {
  const mastery = masteryLockInfo(unlocks, character, skin);
  if (mastery) return mastery;
  if (skinUnlocked(unlocks, character, skin)) return { locked: false };
  const achievement = achievementRewarding(`skin:${character}:${skin}`, ACHIEVEMENTS) ?? achievementRewarding(`character:${character}`, ACHIEVEMENTS);
  return { locked: true, achievement, item: achievement ? itemState(achievement.id) : undefined };
}

const REWARDED_ICONS = rewardedAppIcons(ACHIEVEMENTS);

/** An app icon is locked when an achievement rewards it, or when the mascot it draws is locked. */
export function appIconLock(unlocks: Unlocks, id: string, art: { kind: string; skin?: string }): LockInfo {
  if (!unlocks.enforced) return { locked: false };
  if (REWARDED_ICONS.has(id) && !unlocks.keys.has(`appIcon:${id}`)) {
    const achievement = achievementRewarding(`appIcon:${id}`, ACHIEVEMENTS);
    return { locked: true, achievement, item: achievement ? itemState(achievement.id) : undefined };
  }
  if (art.kind === "owl" || art.kind === "shape" || art.kind === "trombi" || art.kind === "bunbu" || art.kind === "shiba" || art.kind === "grump" || art.kind === "ogre" || art.kind === "frog" || art.kind === "crab") {
    return art.skin ? skinLock(unlocks, art.kind, art.skin) : characterLock(unlocks, art.kind);
  }
  return { locked: false };
}

/** The hint on a locked item: "Unlock: Small Family (2/3)" or, for a secret, "Unlock: a secret achievement". */
export function lockHint(info: LockInfo): string {
  if (!info.locked) return "";
  const achievement = info.achievement;
  if (!achievement) return t("achievements.locked");
  const unlockedSecret = achievement.hidden && !info.item?.unlockedAt;
  const name = unlockedSecret ? t("achievements.secretName") : localized(achievement.name);
  const progress = info.item && info.item.target > 1 && !unlockedSecret ? ` (${info.item.current}/${info.item.target})` : "";
  const line = t("achievements.unlockBy", { name: `${name}${progress}` });
  return unlockedSecret && achievement.hint ? `${line} ${localized(achievement.hint)}` : line;
}

export { achievementById, characterUnlocked };
