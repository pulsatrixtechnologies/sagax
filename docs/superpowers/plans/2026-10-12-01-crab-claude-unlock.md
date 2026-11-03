# Crab Unlock and Claude Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only the owl stays free; the crab unlocks from a server-detected own Claude link, Claude use becomes category `claude` with ten ladder rows, locked characters vanish from every picker, and people already wearing the crab keep it.
**Architecture:** Shared engine and catalog grow new reward kinds, `eventStreak`, category `claude`, and `rewardLineVisible` over `REWARD_REGISTRY`. The server records `claude.linked` from own login or own Anthropic key (never an org key), records `claude.turn|subagent|routine|computer|voice` from existing live-frame hooks when `modelFamily === "anthropic"`, and runs a one-time `migratedCrab` pass. Desktop and iOS hide locked characters, surprise-word locked character and crab-skin rewards, and ship together.
**Tech Stack:** TypeScript server/shared, React desktop, Swift iOS CompanionCore + App, vitest, XCTest
**Spec:** docs/superpowers/specs/2026-10-12-crab-claude-unlock-design.md

## Global Constraints

- Achievement ids are permanent once shipped; never rename; retire by keeping the row (`shared/achievements-catalog.ts:18-20`, AGENTS.md Achievements).
- Server events come only from server hooks; `POST /api/me/achievements/events` refuses them (`server/achievements.ts:8-10, 318`, `server/routes/achievements.ts:49-64`).
- The server never refuses a stored look (`AGENTS.md` Achievements; `lockedLookRefusal` stays Mastery-only).
- Desktop and iOS ship together in this sub-project.
- No em dash or en dash in any user-facing copy (catalog names, descriptions, locales, iOS `String(localized:)`).
- Every catalog row has English and French (`shared/achievements-catalog.test.ts:28-38`); new UI strings land in `src/locales/en.json` and `src/locales/fr.json`.
- Unlocking is idempotent: `claude.linked` and `character:crab` stay after sign-out or key delete; no second toast.
- An organization-provided Anthropic key does not link; org-key Claude turns still count toward the ladder.
- Fable and other anthropic ids that do not name opus, sonnet, or haiku count as `claude.turn` with no `key`; `three-tides` ignores them.
- Auto turns that land on Claude count; local models `modelFamily` does not class as anthropic are ignored.
- Existing non-Claude rows that reward crab skins show "a surprise look" until `character:crab` is unlocked.
- Accessory ids are unprefixed: `accessory:captain`, `accessory:crown`, `accessory:hard-hat`.
- Base crab emote ids recorded with the character: `neutral`, `happy`, `curious`, `sleepy`.
- `claw-streak` stays 20 points.
- iOS DEBUG `MascotGalleryView` keeps crab stills (not a picker).
- Sub-projects 2 and 3 fill art; this sub-project records unlocks and hides a reward line until `rewardLineVisible` is true.
- A server without achievement routes (`enforced: false`) locks nothing; crab stays pickable.
- Rate limits for the new events use `DEFAULT_SERVER_LIMIT` (`intervalMs: 0`, `perDay: 5000`).
- Catalog length stays between 60 and 90 (76 + 10 = 86).

## Review Focus

- Org-key Claude turns count toward the ladder while `claudeAccountLinked` stays false for `orgKey: true` alone, so the crab does not appear. Covered in Task 3 (`orgKey` false) and Task 4 (anthropic turn still emits `claude.turn`).
- A Fable (or other unnamed anthropic) turn counts as `claude.turn` with no `key`, so `three-tides` stays at 0/3. Covered in Task 4.
- Searching "Crab" does not match `hello-bot` (pearl crab skin) while `character:crab` is locked; that card says "a surprise look". Covered in Task 7.
- A person already wearing the crab is grandfathered without a Claude link; an owl with leftover `skins.crab` is not; a second GET does not re-run the pass. Covered in Task 5.
- `POST /api/me/achievements/events` with `type: "claude.linked"` is refused; signing out after unlock keeps `character:crab` and does not toast again. Covered in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/achievements.ts` | New reward kinds, `rewardKey`, `REWARD_REGISTRY`, `rewardLineVisible`, `eventStreak`, `SERVER_EVENTS`, `ACHIEVEMENT_CATEGORIES`, `DEFAULT_CHARACTERS` owl-only, `migratedCrabFromBots`. |
| `shared/achievements.test.ts` | Create: `rewardKey` new kinds, `rewardLineVisible`, `eventStreak`, `characterUnlocked("crab")`, `migratedCrabFromBots`. |
| `shared/achievements-catalog.ts` | Category `claude`, ten ladder rows, `character:crab` on `claude-linked` only. |
| `shared/achievements-catalog.test.ts` | Crab rewarded once; category `claude` covered; 86 rows. |
| `src/components/crab.test.ts` | Invert line 116: crab is not a default character. |
| `src/lib/achievements.ts` | `surpriseRewardLabel`, `displayReward`; crab waits like Shapes. |
| `src/lib/achievements.test.ts` | Crab locked by default; surprise labels; toast reveal. |
| `server/engines/claude-account.ts` | Create: `claudeAccountLinked(input: ClaudeAccountInput): boolean`. |
| `server/engines/claude-account.test.ts` | Create: login marker, own key, org key false. |
| `server/engines/claude-activity.ts` | Create: `claudeTide`, `isClaudeComputerTool`, `claudeActivityEvents`, `claudeFrameEvents`. |
| `server/engines/claude-activity.test.ts` | Create: tides, Fable, Auto, computer names, non-anthropic empty. |
| `server/achievements.ts` | `PersonRecord.migratedCrab`, `grandfatherCrab` option, recordOf second pass. |
| `server/achievements.test.ts` | Client POST refuses `claude.linked`; `migratedCrab` once; GET reconcile. |
| `server/routes/achievements.ts` | `AchievementRouteDeps.linked`; GET records `claude.linked` then snapshots. |
| `server/engines/principal-engine-logins.ts` | `onAuthenticated` also records `claude.linked` for `claudeAgent`. |
| `server/drivers/claude.ts` | Solo login success writes `LOGIN_MARKER` and records `claude.linked`. |
| `server/drivers/claude-login-auth.ts` | Unchanged contract; callers pass the new `onAuthenticated` body. |
| `server/index.ts` | Wire `linked`, solo key save, `observeAchievementFrame` Claude events, `grandfatherCrab`. |
| `server/achievements-mastery.ts` | Unchanged. Task 4 imports `modelFamily` from here into `server/engines/claude-activity.ts`, where `claudeTide` is defined. |
| `src/components/floating-bots/MascotLookEditor.tsx` | `listed` = unlocked or worn; drop `grokLinked` preview injection; no lock hint on a missing tile. |
| `src/components/floating-bots/wardrobe.ts` | Drop the locked chip when no listed row is locked. |
| `src/components/floating-bots/wardrobe.test.ts` | Locked chip absent when `lockedOf` is all false. |
| `src/components/floating-bots/mascots.test.ts` | Gallery omits locked characters; Shapes waits on the snapshot key. |
| `src/components/achievements/achievement-filters.ts` | Search uses surprise labels; reward filters are owl plus unlocked characters. |
| `src/components/achievements/achievement-filters.test.ts` | "Crab" does not match `hello-bot` while crab is locked. |
| `src/components/achievements/AchievementsPage.tsx` | `CATEGORY_LABEL.claude`; cards and Mastery preview use `displayReward`. |
| `src/components/achievements/AchievementsModal.tsx` | `CATEGORY_ICON.claude` = `Sparkles`. |
| `src/components/achievements/AchievementToaster.tsx` | Hide unregistered lines; `claude-linked` reveals Crab. |
| `src/components/achievements/RewardPreview.tsx` | Unchanged art for character/skin; callers skip it for surprise and unregistered. |
| `src/components/achievements/achievements-ui.test.ts` | Claude category in the modal; surprise copy on cards. |
| `src/locales/en.json` | `achievements.category.claude`, surprise keys, new reward kind labels. |
| `src/locales/fr.json` | Matching French strings. |
| `ios/Sources/CompanionCore/Achievements.swift` | Category `claude`; reward cases emote/move/accessory/effect; `RewardRegistry`; `lineVisible`. |
| `ios/Sources/CompanionCore/BotPanelRules.swift` | `defaultCharacters = [.owl]`. |
| `ios/Sources/CompanionCore/AchievementCatalog.swift` | Regenerated (86 rows, new kinds). |
| `ios/parity/achievements-catalog.mjs` | Emit new reward cases and `RewardRegistry`. |
| `ios/App/Features/Achievements/AchievementWording.swift` | Category label; surprise copy; skip unregistered; `Link` symbol. |
| `ios/App/Features/Achievements/AchievementsPage.swift` | Cards use surprise / hide rules. |
| `ios/App/Features/Achievements/AchievementToast.swift` | Reveal Crab after `claude-linked`; skip unregistered. |
| `ios/App/Features/Achievements/AchievementStore.swift` | Toast label uses the same display rules. |
| `ios/App/Mascots/CharacterEditor.swift` | Filter already uses `characterLocked`; crab disappears with the default. |
| `ios/App/Desktop/BotPanelAvatarEditor.swift` | Same filter (`:141`). |
| `ios/App/Mascots/MascotGalleryView.swift` | DEBUG stills unchanged. |
| `ios/Tests/CompanionCoreTests/MascotLookFixtureTests.swift` | Stop expecting crab in `defaultCharacters`. |
| `ios/Tests/CompanionCoreTests/SettingsAppearanceParityTests.swift` | `catalog.count` 86. |
| `ios/Tests/CompanionCoreTests/BotPanelDetailsTests.swift` | Crab locked when enforced with empty keys; worn crab stays. |
| `ios/UITests/BotPanelDetailsUITests.swift` | Owl present; Crab absent unless rewards contain `character:crab`. |
| `docs/superpowers/specs/2026-10-03-ios-feature-parity-matrix.md` | BP6 and ST9 notes. |
| `AGENTS.md` | Achievements section: owl-only default; crab from `claude.linked`. |

---

### Task 1: Shared reward model

**Files:**
- Modify: `shared/achievements.ts` (`AchievementReward` 156-160, `rewardKey` 407-417)
- Create: `shared/achievements.test.ts`
- Test: `shared/achievements.test.ts`

**Interfaces:**
- Consumes: existing `AchievementReward` character/skin/appIcon/title; `RewardCharacter`
- Produces:
  - `AchievementReward` union adds `{ kind: "emote"; character: RewardCharacter; id: string } \| { kind: "move"; character: RewardCharacter; id: string } \| { kind: "accessory"; id: string } \| { kind: "effect"; id: string }`
  - `rewardKey(reward: AchievementReward): string` also returns `emote:<character>:<id>`, `move:<character>:<id>`, `accessory:<id>`, `effect:<id>`
  - `export type RewardRegistry = { emotes: Readonly<Partial<Record<RewardCharacter, readonly string[]>>>; moves: Readonly<Partial<Record<RewardCharacter, readonly string[]>>>; accessories: readonly string[]; effects: readonly string[] }`
  - `export const REWARD_REGISTRY: RewardRegistry` with `emotes: { crab: ["neutral", "happy", "curious", "sleepy"] }`, empty `moves`, empty `accessories`, empty `effects`
  - `export function rewardLineVisible(reward: AchievementReward): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { REWARD_REGISTRY, rewardKey, rewardLineVisible, type AchievementReward } from "./achievements.ts";

describe("reward keys for crab items", () => {
  it("names emote, move, accessory and effect the same way the store will store them", () => {
    expect(rewardKey({ kind: "emote", character: "crab", id: "neutral" })).toBe("emote:crab:neutral");
    expect(rewardKey({ kind: "move", character: "crab", id: "claw-dance" })).toBe("move:crab:claw-dance");
    expect(rewardKey({ kind: "accessory", id: "captain" })).toBe("accessory:captain");
    expect(rewardKey({ kind: "effect", id: "fireworks" })).toBe("effect:fireworks");
    expect(rewardKey({ kind: "character", character: "crab" })).toBe("character:crab");
  });

  it("hides a reward line until the registry can draw it", () => {
    expect(REWARD_REGISTRY.emotes.crab).toEqual(["neutral", "happy", "curious", "sleepy"]);
    expect(rewardLineVisible({ kind: "emote", character: "crab", id: "neutral" })).toBe(true);
    expect(rewardLineVisible({ kind: "emote", character: "crab", id: "proud" })).toBe(false);
    expect(rewardLineVisible({ kind: "move", character: "crab", id: "claw-dance" })).toBe(false);
    expect(rewardLineVisible({ kind: "accessory", id: "captain" })).toBe(false);
    expect(rewardLineVisible({ kind: "effect", id: "bubbles" })).toBe(false);
    expect(rewardLineVisible({ kind: "character", character: "crab" })).toBe(true);
    expect(rewardLineVisible({ kind: "skin", character: "crab", skin: "pearl" })).toBe(true);
    expect(rewardLineVisible({ kind: "title", id: "rookie", name: { en: "Rookie", fr: "Recrue" } })).toBe(true);
    expect(rewardLineVisible({ kind: "appIcon", id: "glyph:cube" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run shared/achievements.test.ts`: expect FAIL (`rewardLineVisible` is not exported / `rewardKey` does not handle `emote`).

- [ ] **Step 3: Implement** in `shared/achievements.ts`. Extend the union after the `title` variant (line 160). Extend `rewardKey` (lines 407-417). Add the registry and visibility helper next to `rewardKey`:

```ts
export type AchievementReward =
  | { kind: "character"; character: Exclude<RewardCharacter, "owl"> }
  | { kind: "skin"; character: RewardCharacter; skin: string }
  | { kind: "appIcon"; id: string }
  | { kind: "title"; id: string; name: Localized }
  | { kind: "emote"; character: RewardCharacter; id: string }
  | { kind: "move"; character: RewardCharacter; id: string }
  | { kind: "accessory"; id: string }
  | { kind: "effect"; id: string };

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
```

- [ ] **Step 4: Run** `pnpm exec vitest run shared/achievements.test.ts`: expect PASS.

- [ ] **Step 5: Commit**

```
git add shared/achievements.ts shared/achievements.test.ts
git commit -m "feat(achievements): emote, move, accessory, effect rewards"
```

---

### Task 2: Shared catalog, events, eventStreak, crab default

**Files:**
- Modify: `shared/achievements.ts` (`SERVER_EVENTS` 32-55, `ACHIEVEMENT_CATEGORIES` 114, `AchievementRule` 129-151, `ruleStatus` 329-361, `DEFAULT_CHARACTERS` 420-421)
- Modify: `shared/achievements-catalog.ts` (insert the `claude` block after the voice section; keep existing crab-skin feeders)
- Modify: `shared/achievements-catalog.test.ts` (length still 60..90; add a `claude-linked` assertion next to `grok-linked` at 83-93)
- Modify: `src/components/crab.test.ts` (line 116)
- Modify: `shared/achievements.test.ts` (eventStreak + crab default)
- Test: `shared/achievements.test.ts`, `shared/achievements-catalog.test.ts`, `src/components/crab.test.ts`

**Interfaces:**
- Consumes: `rewardKey`, `AchievementReward` kinds from Task 1; `longestStreak(activeDays: readonly string[]): number` (305-316)
- Produces:
  - `SERVER_EVENTS` includes `"claude.linked" | "claude.turn" | "claude.subagent" | "claude.routine" | "claude.computer" | "claude.voice"`
  - `ACHIEVEMENT_CATEGORIES` is `["onboarding", "productivity", "power", "voice", "claude", "collaboration", "streaks", "mastery", "tiers", "secrets"]`
  - `AchievementRule` adds `{ kind: "eventStreak"; event: AchievementEventType; target: number }`
  - `ruleStatus` for `eventStreak` is `of(longestStreak(progress.days[rule.event] ?? []), rule.target)`
  - `DEFAULT_CHARACTERS: readonly MascotCharacter[] = ["owl"]`
  - Catalog ids: `claude-linked`, `first-pinch`, `claude-regular`, `claude-devotee`, `crab-army`, `tide-keeper`, `three-tides`, `claw-streak`, `hands-on-claw`, `shell-talk`

- [ ] **Step 1: Write the failing tests** in `shared/achievements.test.ts` (append) and invert `crab.test.ts:116`. Extend the existing catalog tests.

```ts
import { ACHIEVEMENT_CATEGORIES, DEFAULT_CHARACTERS, characterUnlocked, emptyProgress, longestStreak, ruleStatus, NOTHING_LOCKED } from "./achievements.ts";
import { ACHIEVEMENTS, achievementById } from "./achievements-catalog.ts";

it("treats only the owl as a default character", () => {
  expect(DEFAULT_CHARACTERS).toEqual(["owl"]);
  expect(characterUnlocked(NOTHING_LOCKED, "crab")).toBe(true);
  const empty = { enforced: true, keys: new Set<string>() };
  expect(characterUnlocked(empty, "owl")).toBe(true);
  expect(characterUnlocked(empty, "crab")).toBe(false);
  expect(characterUnlocked({ enforced: true, keys: new Set(["character:crab"]) }, "crab")).toBe(true);
});

it("scores eventStreak on progress.days[event], not activeDays", () => {
  const definition = {
    id: "claw-streak",
    category: "claude" as const,
    name: { en: "Claw Streak", fr: "Serie de pinces" },
    description: { en: "x", fr: "y" },
    icon: "CalendarCheck",
    points: 20 as const,
    rule: { kind: "eventStreak" as const, event: "claude.turn" as const, target: 7 },
    rewards: [{ kind: "effect" as const, id: "bubbles" }],
  };
  const progress = {
    ...emptyProgress(),
    days: { "claude.turn": ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"] },
    activeDays: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"],
  };
  expect(longestStreak(progress.days["claude.turn"]!)).toBe(7);
  expect(ruleStatus(definition, progress, [definition])).toEqual({ current: 7, target: 7, done: true });
  const broken = { ...progress, days: { "claude.turn": ["2026-10-01", "2026-10-03"] } };
  expect(ruleStatus(definition, broken, [definition])).toEqual({ current: 1, target: 7, done: false });
});
```

In `shared/achievements-catalog.test.ts`, add inside the existing `grok-linked` test (or a sibling):

```ts
it("unlocks the crab only through a linked Claude account", () => {
  const crab = ACHIEVEMENTS.filter((item) => item.rewards.some((reward) => reward.kind === "character" && reward.character === "crab"));
  expect(crab.map((item) => item.id)).toEqual(["claude-linked"]);
  expect(crab[0]!.rule).toEqual({ kind: "count", event: "claude.linked", target: 1 });
  expect(crab[0]!.category).toBe("claude");
  expect(crab[0]!.points).toBe(10);
  expect(ACHIEVEMENT_CATEGORIES).toContain("claude");
  expect(achievementById("claw-streak")?.points).toBe(20);
  expect(achievementById("claw-streak")?.rule).toEqual({ kind: "eventStreak", event: "claude.turn", target: 7 });
  expect(achievementById("three-tides")?.rule).toEqual({ kind: "distinct", event: "claude.turn", target: 3 });
});
```

In `src/components/crab.test.ts` line 116 replace `expect(DEFAULT_CHARACTERS).toContain("crab")` with `expect(DEFAULT_CHARACTERS).not.toContain("crab")`.

- [ ] **Step 2: Run** `pnpm exec vitest run shared/achievements.test.ts shared/achievements-catalog.test.ts src/components/crab.test.ts`: expect FAIL (`eventStreak` unhandled, `DEFAULT_CHARACTERS` still `["owl","crab"]`, no `claude-linked`).

- [ ] **Step 3: Implement**

In `shared/achievements.ts`:

```ts
export const SERVER_EVENTS = [
  // existing rows through "mastery", then:
  "claude.linked",
  "claude.turn",
  "claude.subagent",
  "claude.routine",
  "claude.computer",
  "claude.voice",
] as const;

export const ACHIEVEMENT_CATEGORIES = ["onboarding", "productivity", "power", "voice", "claude", "collaboration", "streaks", "mastery", "tiers", "secrets"] as const;

export type AchievementRule =
  | { kind: "count"; event: AchievementEventType; target: number }
  | { kind: "distinct"; event: AchievementEventType; target: number }
  | { kind: "days"; event: AchievementEventType; target: number }
  | { kind: "max"; event: AchievementEventType; target: number }
  | { kind: "all"; events: readonly AchievementEventType[] }
  | { kind: "streak"; target: number }
  | { kind: "eventStreak"; event: AchievementEventType; target: number }
  | { kind: "activeDays"; target: number }
  | { kind: "points"; target: number }
  | { kind: "completion" }
  | { kind: "mastery"; metric: MasteryMetric; target: number }
  | { kind: "category"; category: AchievementCategory; target: number };

// in ruleStatus, after case "streak":
    case "eventStreak":
      return of(longestStreak(progress.days[rule.event] ?? []), rule.target);

export const DEFAULT_CHARACTERS: readonly MascotCharacter[] = ["owl"];
```

Update the comment above `DEFAULT_CHARACTERS` (line 420) to: `Unlocked from the start: the owl, with its Common skins. The crab waits for a linked Claude account. Shapes waits for a linked Grok account.`

In `shared/achievements-catalog.ts`, after the last voice achievement and before collaboration, insert:

```ts
  /* ---------------------------------------------------------------- claude */
  {
    id: "claude-linked",
    category: "claude",
    name: { en: "Claude Linked", fr: "Compte Claude lie" },
    description: { en: "Sign in to Claude, or save your own Anthropic key.", fr: "Connectez-vous a Claude, ou enregistrez votre propre cle Anthropic." },
    icon: "Link",
    points: 10,
    rule: { kind: "count", event: "claude.linked", target: 1 },
    rewards: [
      { kind: "character", character: "crab" },
      { kind: "emote", character: "crab", id: "neutral" },
      { kind: "emote", character: "crab", id: "happy" },
      { kind: "emote", character: "crab", id: "curious" },
      { kind: "emote", character: "crab", id: "sleepy" },
    ],
  },
  {
    id: "first-pinch",
    category: "claude",
    name: { en: "First Pinch", fr: "Premier pincement" },
    description: { en: "Finish your first Claude turn.", fr: "Terminez votre premier tour Claude." },
    icon: "MessageCircle",
    points: 5,
    rule: { kind: "count", event: "claude.turn", target: 1 },
    rewards: [{ kind: "emote", character: "crab", id: "proud" }],
  },
  {
    id: "claude-regular",
    category: "claude",
    name: { en: "Regular Claw", fr: "Pince reguliere" },
    description: { en: "Finish 100 Claude turns.", fr: "Terminez 100 tours Claude." },
    icon: "Repeat",
    points: 50,
    rule: { kind: "count", event: "claude.turn", target: 100 },
    rewards: [{ kind: "move", character: "crab", id: "claw-dance" }],
  },
  {
    id: "claude-devotee",
    category: "claude",
    name: { en: "Devotee", fr: "Devoue" },
    description: { en: "Finish 1000 Claude turns.", fr: "Terminez 1000 tours Claude." },
    icon: "Flame",
    points: 100,
    rule: { kind: "count", event: "claude.turn", target: 1000 },
    rewards: [{ kind: "effect", id: "fireworks" }],
  },
  {
    id: "crab-army",
    category: "claude",
    name: { en: "Crab Army", fr: "Armee de crabes" },
    description: { en: "Have a bot of yours hand work to a sub-agent on Claude.", fr: "Faites confier du travail a un sous-agent par un de vos robots sur Claude." },
    icon: "Network",
    points: 20,
    rule: { kind: "count", event: "claude.subagent", target: 1 },
    rewards: [{ kind: "move", character: "crab", id: "clone" }],
  },
  {
    id: "tide-keeper",
    category: "claude",
    name: { en: "Tide Keeper", fr: "Gardien de la maree" },
    description: { en: "Have 25 Claude routines complete.", fr: "Faites completer 25 routines Claude." },
    icon: "CalendarClock",
    points: 50,
    rule: { kind: "count", event: "claude.routine", target: 25 },
    rewards: [{ kind: "accessory", id: "captain" }],
  },
  {
    id: "three-tides",
    category: "claude",
    name: { en: "Three Tides", fr: "Trois marees" },
    description: { en: "Use Opus, Sonnet and Haiku.", fr: "Utilisez Opus, Sonnet et Haiku." },
    icon: "Layers",
    points: 20,
    rule: { kind: "distinct", event: "claude.turn", target: 3 },
    rewards: [{ kind: "accessory", id: "crown" }],
  },
  {
    id: "claw-streak",
    category: "claude",
    name: { en: "Claw Streak", fr: "Serie de pinces" },
    description: { en: "Finish a Claude turn seven days in a row.", fr: "Terminez un tour Claude sept jours de suite." },
    icon: "CalendarCheck",
    points: 20,
    rule: { kind: "eventStreak", event: "claude.turn", target: 7 },
    rewards: [{ kind: "effect", id: "bubbles" }],
  },
  {
    id: "hands-on-claw",
    category: "claude",
    name: { en: "Hands on Claw", fr: "Pince aux commandes" },
    description: { en: "Use Computer Use on a Claude turn.", fr: "Utilisez Computer Use pendant un tour Claude." },
    icon: "MousePointerClick",
    points: 20,
    rule: { kind: "count", event: "claude.computer", target: 1 },
    rewards: [{ kind: "accessory", id: "hard-hat" }],
  },
  {
    id: "shell-talk",
    category: "claude",
    name: { en: "Shell Talk", fr: "Parler dans la coquille" },
    description: { en: "Have a voice conversation with Claude.", fr: "Ayez une conversation vocale avec Claude." },
    icon: "Phone",
    points: 20,
    rule: { kind: "count", event: "claude.voice", target: 1 },
    rewards: [{ kind: "emote", character: "crab", id: "laughing" }],
  },
```

French strings in the catalog must use real accents (`lié`, `clé`, `régulière`, `Dévoué`, `Armée`, `marée`, `Série`). The ASCII spellings above are a reminder not to use long dashes; type the accented French from the spec table (`Compte Claude lié`, `Pince régulière`, `Dévoué`, `Armée de crabes`, `Gardien de la marée`, `Série de pinces`). Do not put U+2013 or U+2014 in any string.

Keep existing crab-skin rewards on `hello-bot` (pearl), `dressing-room` (gold), `well-oiled` (molten), the neon/circuit/chrome rows, `juggler` (holo), and the crystal/galaxy rows. The lockable-once test then requires `character:crab` exactly once, which `claude-linked` provides.

Update `src/lib/achievements.test.ts` line 69 title and add `expect(characterLock(unlocks, "crab")).toMatchObject({ locked: true, achievement: { id: "claude-linked" } });` next to the Shapes assertion.

- [ ] **Step 4: Run** `pnpm exec vitest run shared/achievements.test.ts shared/achievements-catalog.test.ts src/components/crab.test.ts src/lib/achievements.test.ts src/components/achievements/achievements-ui.test.ts`: expect PASS (icons already include `Link`, `MessageCircle`, `Repeat`, `Flame`, `Network`, `CalendarClock`, `Layers`, `CalendarCheck`, `MousePointerClick`, `Phone`). If `achievements-ui.test.ts` "has an icon for every achievement" fails on a missing lucide name, add it in this task.

- [ ] **Step 5: Commit**

```
git add shared/achievements.ts shared/achievements.test.ts shared/achievements-catalog.ts shared/achievements-catalog.test.ts src/components/crab.test.ts src/lib/achievements.test.ts
git commit -m "feat(achievements): Claude category, crab unlock, eventStreak"
```

---

### Task 3: Server Claude link detection

**Files:**
- Create: `server/engines/claude-account.ts`, `server/engines/claude-account.test.ts`
- Modify: `server/routes/achievements.ts` (`AchievementRouteDeps` 19-25, GET 44-46)
- Modify: `server/achievements.test.ts` (route helper 288-301, GET tests 303-326)
- Modify: `server/engines/principal-engine-logins.ts` (`onAuthenticated` 172)
- Modify: `server/drivers/claude.ts` (solo login 2844; `resolveClaudeConfigDir` 149)
- Modify: `server/index.ts` (route wiring 21072-21076; PUT `/api/config` after `saveConfig(patch)` 36404)
- Test: `server/engines/claude-account.test.ts`, `server/achievements.test.ts`

**Interfaces:**
- Consumes: `LOGIN_MARKER` from `server/engines/principal-engine-logins.ts:30`; `AchievementStore.record`; `isServerEvent`
- Produces:
  - `export interface ClaudeAccountInput { signedIn?: boolean; loginMarker?: boolean; anthropicConfigured?: boolean; myKey?: boolean; orgKey?: boolean }`
  - `export function claudeAccountLinked(input: ClaudeAccountInput): boolean`
  - `AchievementRouteDeps.linked?: (person: string) => boolean`
  - GET `/api/me/achievements` records `{ type: "claude.linked" }` from source `"server"` when `linked(person)` is true, then returns `snapshot(person)`

- [ ] **Step 1: Write the failing tests**

`server/engines/claude-account.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { claudeAccountLinked } from "./claude-account.ts";

describe("claudeAccountLinked", () => {
  it("is own Claude login or own Anthropic key, never the organization key", () => {
    expect(claudeAccountLinked({})).toBe(false);
    expect(claudeAccountLinked({ orgKey: true })).toBe(false);
    expect(claudeAccountLinked({ signedIn: true })).toBe(true);
    expect(claudeAccountLinked({ loginMarker: true })).toBe(true);
    expect(claudeAccountLinked({ anthropicConfigured: true })).toBe(true);
    expect(claudeAccountLinked({ myKey: true })).toBe(true);
    expect(claudeAccountLinked({ signedIn: false, myKey: false, orgKey: true })).toBe(false);
  });
});
```

In `server/achievements.test.ts`, next to "refuses server events from the app":

```ts
it("refuses a client that posts claude.linked", () => {
  const { store } = setup();
  expect(store.record(ADA, [{ type: "claude.linked" }], "client")).toEqual({ accepted: 0, unlocked: [] });
  const server = store.record(ADA, [{ type: "claude.linked" }], "server");
  expect(server.unlocked.map((item) => item.id)).toContain("claude-linked");
  expect(store.snapshot(ADA).rewards).toContain("character:crab");
  expect(store.record(ADA, [{ type: "claude.linked" }], "server").unlocked).toEqual([]);
});
```

In the `/api/me/achievements` describe:

```ts
it("records claude.linked on GET when the person is already linked, and does not toast twice", async () => {
  const { store } = setup();
  const told: string[] = [];
  let linked = true;
  const route = createAchievementRoutes({
    store,
    person: (auth) => (auth as unknown as { person?: string | null }).person ?? null,
    unlocked: (person, unlocks) => told.push(`${person}:${unlocks.map((item) => item.id).join(",")}`),
    linked: () => linked,
  });
  const first = await call(route, { method: "GET", person: ADA });
  expect(first).toMatchObject({ status: 200 });
  expect((first as { body: { rewards: string[] } }).body.rewards).toContain("character:crab");
  expect(told.some((line) => line.includes("claude-linked"))).toBe(true);
  const before = told.length;
  await call(route, { method: "GET", person: ADA });
  expect(told.length).toBe(before);
  linked = false;
  const { store: other } = setup();
  const quiet = createAchievementRoutes({ store: other, person: () => ADA, unlocked: () => undefined, linked: () => false });
  const empty = await call(quiet, { method: "GET", person: ADA });
  expect((empty as { body: { rewards: string[] } }).body.rewards).not.toContain("character:crab");
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run server/engines/claude-account.test.ts server/achievements.test.ts`: expect FAIL (module missing; `linked` unknown; `claude.linked` not a server event until Task 2 is merged; this task sits on Task 2).

- [ ] **Step 3: Implement**

`server/engines/claude-account.ts`:

```ts
export interface ClaudeAccountInput {
  signedIn?: boolean;
  loginMarker?: boolean;
  anthropicConfigured?: boolean;
  myKey?: boolean;
  orgKey?: boolean;
}

export function claudeAccountLinked(input: ClaudeAccountInput): boolean {
  if (input.signedIn || input.loginMarker) return true;
  if (input.anthropicConfigured || input.myKey) return true;
  return false;
}
```

`server/routes/achievements.ts` GET branch:

```ts
export interface AchievementRouteDeps {
  store: AchievementStore;
  person: (auth: RequestAuth) => string | null;
  unlocked: (person: string, unlocks: AchievementUnlock[]) => void;
  linked?: (person: string) => boolean;
}

// inside GET /api/me/achievements:
      if (deps.linked?.(person)) {
        const result = deps.store.record(person, [{ type: "claude.linked" }], "server");
        if (result.unlocked.length) deps.unlocked(person, result.unlocked);
      }
      return json(res, 200, deps.store.snapshot(person));
```

Solo login in `server/drivers/claude.ts` around 2844. Import `LOGIN_MARKER` from `../principal-engine-logins.ts`, `writeFileAtomic` from `../atomic.ts`, `join` from `node:path`, and a `recordLinked` callback passed through the driver factory if the driver cannot import `recordAchievements`. Prefer a hook on the existing `onAuthenticated`:

```ts
const login = new ClaudeLoginController({
  cli: config.cli,
  environment,
  onAuthenticated: async () => {
    await refreshModels();
    const dir = resolveClaudeConfigDir(config.configDir, environment());
    writeFileAtomic(join(dir, LOGIN_MARKER), JSON.stringify({ at: Date.now() }), { mode: 0o600 });
    options.onClaudeLinked?.();
  },
});
```

If `ClaudeDriver` options have no `onClaudeLinked`, add `onClaudeLinked?: () => void` next to the existing constructor input and have `server/index.ts` pass `() => recordAchievements(localPrincipalId(), [{ type: "claude.linked" }])` for the solo Claude instance.

Org login: change `PrincipalEngineLogins` constructor options to `onClaudeLinked?: (principalId: string) => void`. In `onAuthenticated` (line 172):

```ts
const onAuthenticated = async () => {
  this.markSignedIn(principalId, driver);
  if (driver === "claudeAgent") this.options.onClaudeLinked?.(principalId);
};
```

`server/index.ts` where `PrincipalEngineLogins` is constructed: `onClaudeLinked: (person) => recordAchievements(person, [{ type: "claude.linked" }])`.

GET wiring at 21072:

```ts
ROUTES.push(createAchievementRoutes({
  store: achievementStore,
  person: (auth) => actorPrincipalId(auth) || null,
  unlocked: (person, unlocked) => broadcast({ kind: "achievements", audience: person, unlocked }),
  linked: (person) => {
    if (IDENTITY.kind === "perspicax") {
      const signedIn = engineLogins?.signedIn(person, "claudeAgent") === true;
      const sub = principals.byId(person)?.subject?.iss === IDENTITY.issuer ? principals.byId(person)?.subject?.sub : undefined;
      const held = sub ? perspicaxDirectory?.providerKeys(sub) ?? [] : [];
      const myKey = providersOfDriver("claudeAgent").some((provider) => held.includes(provider));
      return claudeAccountLinked({ signedIn, myKey, orgKey: false });
    }
    const dir = resolveClaudeConfigDir(undefined, process.env);
    const loginMarker = existsSync(join(dir, LOGIN_MARKER));
    return claudeAccountLinked({ loginMarker, anthropicConfigured: Boolean(cfg.anthropic?.key) });
  },
}));
```

After `saveConfig(patch)` at 36404, when `IDENTITY.kind !== "perspicax"` and `typeof patch.anthropic?.key === "string" && patch.anthropic.key.trim()`:

```ts
recordAchievements(localPrincipalId(), [{ type: "claude.linked" }]);
```

Org own-key saves live on Perspicax; GET `linked` covers `myKey`.

- [ ] **Step 4: Run** `pnpm exec vitest run server/engines/claude-account.test.ts server/achievements.test.ts server/engines/principal-engine-logins.test.ts server/drivers/claude-login-auth.test.ts`: expect PASS. Unlink is "do not delete counters": add a store test that after `claude.linked` the rewards still contain `character:crab` even if `linked()` becomes false on the next GET (the GET only records when linked, it never removes). That is the "no second toast / unlink keeps crab" Review Focus case.

- [ ] **Step 5: Commit**

```
git add server/engines/claude-account.ts server/engines/claude-account.test.ts server/routes/achievements.ts server/achievements.test.ts server/engines/principal-engine-logins.ts server/drivers/claude.ts server/index.ts
git commit -m "feat(achievements): server-detect Claude link"
```

---

### Task 4: Server Claude activity hooks

**Files:**
- Create: `server/engines/claude-activity.ts`, `server/engines/claude-activity.test.ts`
- Modify: `server/index.ts` (`observeAchievementFrame` 1194-1216, `achievementSendEvents` call site ~33920, `masteryThreadModel` 1076). Import `modelFamily` from `server/achievements-mastery.ts`; do not edit that file.
- Test: `server/engines/claude-activity.test.ts`

**Interfaces:**
- Consumes: `modelFamily(model: string | undefined | null): ModelFamily | null`; `AchievementEvent`; `FrameLookups.threadModel`
- Produces:
  - `export type ClaudeTide = "opus" | "sonnet" | "haiku"`
  - `export function claudeTide(model: string | undefined | null): ClaudeTide | undefined`
  - `export function isClaudeComputerTool(name: string): boolean`
  - `export function claudeActivityEvents(input: { family: ModelFamily | null; kind: "turn" | "subagent" | "routine" | "computer" | "voice"; model?: string | null }): AchievementEvent[]`
  - `export function claudeFrameEvents(payload: Record<string, unknown>, lookups: { threadPerson(threadId: string): string | null; threadModel(threadId: string): string | null; routinePerson(routineId: string, run: { botId?: unknown }): string | null }): { person: string; events: AchievementEvent[] }[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { modelFamily } from "./achievements-mastery.ts";
import { claudeActivityEvents, claudeTide, isClaudeComputerTool } from "./claude-activity.ts";

describe("claudeTide", () => {
  it("keys opus, sonnet and haiku by id substring and ignores other anthropic ids", () => {
    expect(claudeTide("claude-opus-4-6")).toBe("opus");
    expect(claudeTide("claude-sonnet-4-5")).toBe("sonnet");
    expect(claudeTide("claude-haiku-4-5")).toBe("haiku");
    expect(claudeTide("claude-fable")).toBeUndefined();
    expect(claudeTide("grok-4")).toBeUndefined();
    expect(claudeTide("")).toBeUndefined();
  });
});

describe("claudeActivityEvents", () => {
  it("emits claude.turn without a key for Fable, and nothing for non-anthropic", () => {
    expect(modelFamily("claude-fable")).toBe("anthropic");
    expect(claudeActivityEvents({ family: "anthropic", kind: "turn", model: "claude-fable" })).toEqual([{ type: "claude.turn" }]);
    expect(claudeActivityEvents({ family: "anthropic", kind: "turn", model: "claude-opus-4-6" })).toEqual([{ type: "claude.turn", key: "opus" }]);
    expect(claudeActivityEvents({ family: "xai", kind: "turn", model: "grok-4" })).toEqual([]);
    expect(claudeActivityEvents({ family: null, kind: "turn", model: "llama-3" })).toEqual([]);
  });

  it("counts Auto when the completed turn's family is anthropic", () => {
    expect(claudeActivityEvents({ family: modelFamily("claude-sonnet-4-5"), kind: "turn", model: "claude-sonnet-4-5" })).toEqual([{ type: "claude.turn", key: "sonnet" }]);
  });

  it("emits subagent, routine, computer and voice only on anthropic", () => {
    expect(claudeActivityEvents({ family: "anthropic", kind: "subagent" })).toEqual([{ type: "claude.subagent" }]);
    expect(claudeActivityEvents({ family: "anthropic", kind: "routine" })).toEqual([{ type: "claude.routine" }]);
    expect(claudeActivityEvents({ family: "anthropic", kind: "computer" })).toEqual([{ type: "claude.computer" }]);
    expect(claudeActivityEvents({ family: "anthropic", kind: "voice" })).toEqual([{ type: "claude.voice" }]);
    expect(claudeActivityEvents({ family: "openai", kind: "subagent" })).toEqual([]);
  });

  it("recognises Computer Use tool names and not computer.control", () => {
    expect(isClaudeComputerTool("computer_use")).toBe(true);
    expect(isClaudeComputerTool("computer_exec")).toBe(true);
    expect(isClaudeComputerTool("mcp__computer__click")).toBe(true);
    expect(isClaudeComputerTool("computer_select")).toBe(false);
  });
});
```

Add a store-level `three-tides` case in `server/achievements.test.ts`:

```ts
it("three-tides needs opus, sonnet and haiku keys; a Fable turn does not count as a tide", () => {
  const { store } = setup();
  store.record(ADA, [{ type: "claude.turn" }], "server");
  expect(store.snapshot(ADA).items.find((item) => item.id === "three-tides")).toMatchObject({ current: 0, target: 3 });
  store.record(ADA, [{ type: "claude.turn", key: "opus" }, { type: "claude.turn", key: "sonnet" }, { type: "claude.turn", key: "haiku" }], "server");
  expect(store.snapshot(ADA).items.find((item) => item.id === "three-tides")?.unlockedAt).toBeTypeOf("number");
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run server/engines/claude-activity.test.ts server/achievements.test.ts`: expect FAIL (module missing).

- [ ] **Step 3: Implement** `server/engines/claude-activity.ts`:

```ts
import { modelFamily, type ModelFamily } from "./achievements-mastery.ts";
import type { AchievementEvent } from "./achievements.ts";

export type ClaudeTide = "opus" | "sonnet" | "haiku";

export function claudeTide(model: string | undefined | null): ClaudeTide | undefined {
  if (!model) return undefined;
  const id = model.toLowerCase();
  if (id.includes("opus")) return "opus";
  if (id.includes("sonnet")) return "sonnet";
  if (id.includes("haiku")) return "haiku";
  return undefined;
}

export function isClaudeComputerTool(name: string): boolean {
  const n = name.toLowerCase();
  return n === "computer_use" || n === "computer_exec" || n.startsWith("mcp__computer__");
}

export function claudeActivityEvents(input: {
  family: ModelFamily | null;
  kind: "turn" | "subagent" | "routine" | "computer" | "voice";
  model?: string | null;
}): AchievementEvent[] {
  if (input.family !== "anthropic") return [];
  if (input.kind === "turn") {
    const key = claudeTide(input.model);
    return [{ type: "claude.turn", ...(key ? { key } : {}) }];
  }
  if (input.kind === "subagent") return [{ type: "claude.subagent" }];
  if (input.kind === "routine") return [{ type: "claude.routine" }];
  if (input.kind === "computer") return [{ type: "claude.computer" }];
  return [{ type: "claude.voice" }];
}
```

Wire `observeAchievementFrame` (`server/index.ts:1194`):

On `runtime` `turn.completed`, after `recordMastery`:

```ts
const model = masteryThreadModel(event.threadId) ?? (typeof event.provider === "string" ? event.provider : null);
const family = modelFamily(model);
recordAchievements(achievementThreadPerson(event.threadId), claudeActivityEvents({ family, kind: "turn", model }));
```

`masteryThreadModel` already prefers Auto's pick (`autoTurnsByThread.get(threadId)?.entry.model`), so Auto Claude counts.

On `message` / `message.patch` after `activityEvents`:

```ts
const family = modelFamily(masteryThreadModel(payload.threadId));
const extra = [];
if ((payload.message as { tool?: { parentItemId?: unknown } }).tool?.parentItemId) extra.push(...claudeActivityEvents({ family, kind: "subagent" }));
const toolName = typeof (payload.message as { tool?: { name?: unknown } }).tool?.name === "string" ? (payload.message as { tool: { name: string } }).tool.name : "";
if (isClaudeComputerTool(toolName)) extra.push(...claudeActivityEvents({ family, kind: "computer" }));
recordAchievements(achievementThreadPerson(payload.threadId), extra);
```

On `routine.run` completed, after `routineRunEvents`:

```ts
const bot = routine ? store.bot(routine.botId) : undefined;
const model = bot?.modelSelection?.model ?? null;
recordAchievements(person, claudeActivityEvents({ family: modelFamily(model), kind: "routine" }));
```

At the send site that already calls `achievementSendEvents` (~33920), when `voiceCall` is set:

```ts
const family = modelFamily(masteryThreadModel(threadId));
recordAchievements(person, claudeActivityEvents({ family, kind: "voice" }));
```

Org-key Review Focus: `claudeActivityEvents` does not read credentials; an anthropic turn records `claude.turn` even when `claudeAccountLinked` is false. Cover that in `claude-activity.test.ts` with a comment, not a second linker.

- [ ] **Step 4: Run** `pnpm exec vitest run server/engines/claude-activity.test.ts server/achievements.test.ts`: expect PASS.

- [ ] **Step 5: Commit**

```
git add server/engines/claude-activity.ts server/engines/claude-activity.test.ts server/index.ts server/achievements.test.ts
git commit -m "feat(achievements): record Claude turns, tools, voice"
```

---

### Task 5: migratedCrab grandfather pass

**Files:**
- Modify: `shared/achievements.ts` (after `grandfatheredFromBots` 517-537)
- Modify: `shared/achievements.test.ts`
- Modify: `server/achievements.ts` (`PersonRecord` 68-75, `freshRecord` 117-118, `cleanRecord` 156-177, `recordOf` 233-251, `AchievementStoreOptions` 99-107)
- Modify: `server/index.ts` (`createAchievementStore` 1022-1027)
- Modify: `server/achievements.test.ts` (grandfather test 105-112)
- Test: `shared/achievements.test.ts`, `server/achievements.test.ts`

**Interfaces:**
- Consumes: `completeMascotLook` (`shared/mascot-look.ts:483`); `skinTier`
- Produces:
  - `export function migratedCrabFromBots(bots: ReadonlyArray<{ mascotLook?: unknown }>): string[]`
  - `PersonRecord.migratedCrab: boolean`
  - `AchievementStoreOptions.grandfatherCrab?: (person: string) => string[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { grandfatheredFromBots, migratedCrabFromBots } from "./achievements.ts";

it("grandfathers a worn crab, ignores leftover skins.crab on an owl, and does not replay via grandfatheredFromBots", () => {
  expect(migratedCrabFromBots([{ mascotLook: { character: "crab" } }])).toEqual(["character:crab"]);
  expect(migratedCrabFromBots([{ mascotLook: { character: "crab", skins: { crab: "gold" } } }])).toEqual(["character:crab", "skin:crab:gold"]);
  expect(migratedCrabFromBots([{ mascotLook: { character: "owl", skins: { crab: "gold" } } }])).toEqual([]);
  expect(migratedCrabFromBots([{ mascotLook: { character: "owl" } }])).toEqual([]);
  expect(grandfatheredFromBots([{ mascotLook: { character: "crab" } }])).toEqual(["character:crab"]);
});
```

In `server/achievements.test.ts`:

```ts
it("runs migratedCrab once and does not grant crab from an owl leftover skin", () => {
  let calls = 0;
  const dir = mkdtempSync(join(tmpdir(), "sagax-achievements-"));
  const store = createAchievementStore({
    dataDir: dir,
    persistDelayMs: 0,
    grandfather: () => [],
    grandfatherCrab: () => (calls++, ["character:crab"]),
  });
  expect(store.snapshot(ADA).rewards).toContain("character:crab");
  store.snapshot(ADA);
  expect(calls).toBe(1);
  const again = createAchievementStore({
    dataDir: dir,
    persistDelayMs: 0,
    grandfatherCrab: () => (calls++, ["character:crab", "should-not-apply"]),
  });
  expect(again.snapshot(ADA).rewards).toEqual(["character:crab"]);
  expect(calls).toBe(1);
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run shared/achievements.test.ts server/achievements.test.ts`: expect FAIL (`migratedCrabFromBots` missing).

- [ ] **Step 3: Implement**

```ts
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
```

`PersonRecord` gains `migratedCrab: boolean`. `freshRecord` sets `migratedCrab: false`. `cleanRecord` sets `record.migratedCrab = value.migratedCrab === true` (missing means false, so existing `achievements.json` people get the pass).

`recordOf` after the `migrated` block:

```ts
    if (!record.migratedCrab) {
      record.migratedCrab = true;
      try {
        for (const key of options.grandfatherCrab?.(person) ?? []) pushBounded(record.grandfathered, key, 200);
      } catch {
        /* same as grandfather: nothing breaks */
      }
      persist(true);
    }
```

`server/index.ts`:

```ts
const achievementBots = (person: string) => IDENTITY.kind === "perspicax" ? store.bots.filter((bot) => effectiveBotOwner(bot) === person) : store.bots;
const achievementStore = createAchievementStore({
  dataDir: DATA_DIR,
  grandfather: (person) => grandfatheredFromBots(achievementBots(person)),
  grandfatherCrab: (person) => migratedCrabFromBots(achievementBots(person)),
});
```

Do not replay `grandfatheredFromBots`. Do not grant crab because `skins.crab` is filled by `completeMascotLook`.

- [ ] **Step 4: Run** `pnpm exec vitest run shared/achievements.test.ts server/achievements.test.ts`: expect PASS.

- [ ] **Step 5: Commit**

```
git add shared/achievements.ts shared/achievements.test.ts server/achievements.ts server/achievements.test.ts server/index.ts
git commit -m "feat(achievements): grandfather people already wearing the crab"
```

---

### Task 6: Desktop hide locked characters

**Files:**
- Modify: `src/components/floating-bots/MascotLookEditor.tsx` (`listed` 565-569, `grokLinked` injection 558-563, lock hint 751)
- Modify: `src/components/floating-bots/wardrobe.ts` (`wardrobeFilters` 37-46)
- Modify: `src/components/floating-bots/wardrobe.test.ts` (42-51)
- Modify: `src/components/floating-bots/mascots.test.ts` (200-229)
- Modify: `src/components/achievements/achievement-filters.ts` (`ACHIEVEMENT_REWARD_FILTERS` 11)
- Modify: `src/components/achievements/AchievementsPage.tsx` (reward `<select>` 248-256)
- Test: `src/components/floating-bots/mascots.test.ts`, `src/components/floating-bots/wardrobe.test.ts`, `src/components/achievements/achievement-filters.test.ts`

**Interfaces:**
- Consumes: `characterUnlocked`, `characterLock`, `useUnlocks`
- Produces:
  - `listed`: characters where `id === look.character || !characterLock(unlocks, id).locked`
  - `wardrobeFilters(entries, lockedOf?: (entry: WardrobeEntry) => boolean): WardrobeFilter[]` omits `"locked"` when `lockedOf` is passed and no entry is locked
  - `achievementRewardFilters(unlocks: Unlocks): readonly AchievementRewardFilter[]` returns `["all", "title", ...characters]` where characters are `"owl"` plus `characterUnlocked`

- [ ] **Step 1: Write the failing tests**

In `mascots.test.ts` replace the test at line 200:

```ts
  it("lists unlocked and worn characters only, with no To unlock shelf for characters", () => {
    const lockedIds = (html: string) => [...html.matchAll(/data-character-option="([a-z]+)" data-locked=""/g)].map((match) => match[1]);
    const options = (html: string) => [...html.matchAll(/data-character-option="([a-z]+)"/g)].map((match) => match[1]);
    enforce([]);
    const html = render(undefined);
    expect(options(html)).toEqual(["owl"]);
    expect(html).not.toContain('data-character-option="crab"');
    expect(html).not.toContain('data-character-option="shape"');
    expect(html).not.toContain('data-character-option="ogre"');
    expect(html).not.toContain('data-mascot-shelf="locked"');
    expect(html).not.toContain('data-mascot-filter="locked"');
    expect(lockedIds(html)).toEqual([]);
    enforce(["character:crab"]);
    expect(options(render(undefined))).toEqual(expect.arrayContaining(["owl", "crab"]));
    setGrokAccountLinked(true);
    expect(options(render(undefined))).not.toContain("shape");
    setGrokAccountLinked(false);
    enforce(["character:shape"]);
    expect(options(render(undefined))).toContain("shape");
  });
```

Keep the worn-skin assertions (lines 219-224). Add: a bot already wearing crab still lists crab (`render({ character: "crab" })` contains `data-character-option="crab"` even with `enforce([])`).

In `wardrobe.test.ts`:

```ts
  it("drops the To unlock chip when no listed row is locked", () => {
    expect(wardrobeFilters(MASCOTS, () => false)).toEqual(["all", "owned", "family:classics", "family:shapes", "family:animals"]);
    expect(wardrobeFilters(MASCOTS)).toEqual(["all", "owned", "locked", "family:classics", "family:shapes", "family:animals"]);
  });
```

When `lockedOf` is omitted, keep today's chip list so existing tests stay green.

- [ ] **Step 2: Run** `pnpm exec vitest run src/components/floating-bots/mascots.test.ts src/components/floating-bots/wardrobe.test.ts`: expect FAIL (crab and ogre still listed; locked chip still present).

- [ ] **Step 3: Implement**

`MascotLookEditor.tsx`: delete the `grokLinked` injection (558-563) and `useGrokAccountLinked`. `unlocks` is `stored` from `useUnlocks()`. Replace `listed`:

```ts
  const listed = MASCOTS.filter((option) => option.id === look.character || !characterLock(unlocks, option.id).locked);
```

Pass `wardrobeFilters(listed, (entry) => characterLock(unlocks, entry.id as MascotCharacter).locked && entry.id !== look.character)`.

`wardrobe.ts`:

```ts
export function wardrobeFilters(entries: readonly WardrobeEntry[], lockedOf?: (entry: WardrobeEntry) => boolean): WardrobeFilter[] {
  const families = MASCOT_FAMILIES.filter((family) => entries.some((entry) => entry.family === family));
  const showLocked = lockedOf ? entries.some((entry) => lockedOf(entry)) : true;
  return [
    "all",
    "owned",
    ...(showLocked ? (["locked"] as const) : []),
    ...(entries.some((entry) => entry.premium) ? (["premium"] as const) : []),
    ...families.map((family) => `family:${family}` as const),
  ];
}
```

Because `listed` already dropped locked characters, `showLocked` is false and the chip and shelf go away. Worn crab is in `listed` and `lockOf` treats it as unlocked, so it sits on Yours.

`achievement-filters.ts`:

```ts
import { characterUnlocked, type Unlocks } from "../../../shared/achievements";

export const ACHIEVEMENT_REWARD_FILTERS = ["all", "title", ...MASCOT_CHARACTERS] as const;
export type AchievementRewardFilter = (typeof ACHIEVEMENT_REWARD_FILTERS)[number];

export function achievementRewardFilters(unlocks: Unlocks): AchievementRewardFilter[] {
  const characters = MASCOT_CHARACTERS.filter((id) => id === "owl" || characterUnlocked(unlocks, id));
  return ["all", "title", ...characters];
}
```

`AchievementsPage.tsx` uses `achievementRewardFilters(unlocksFromSnapshot(snapshot))` for the `<select>` options. Skins of an owned character stay as today (skin cards still hide locked skins: `mascots.test.ts:219-223`).

- [ ] **Step 4: Run** `pnpm exec vitest run src/components/floating-bots/mascots.test.ts src/components/floating-bots/wardrobe.test.ts src/components/achievements/achievement-filters.test.ts`: expect PASS.

- [ ] **Step 5: Commit**

```
git add src/components/floating-bots/MascotLookEditor.tsx src/components/floating-bots/wardrobe.ts src/components/floating-bots/wardrobe.test.ts src/components/floating-bots/mascots.test.ts src/components/achievements/achievement-filters.ts src/components/achievements/AchievementsPage.tsx
git commit -m "fix(appearance): hide locked characters, drop To unlock shelf"
```

---

### Task 7: Desktop surprise copy, search, toast, locales

**Files:**
- Modify: `src/lib/achievements.ts` (`rewardLabel` 224-235)
- Modify: `src/lib/achievements.test.ts` (`words` 176-183)
- Modify: `src/components/achievements/achievement-filters.ts` (`searchText` 49-55)
- Modify: `src/components/achievements/achievement-filters.test.ts`
- Modify: `src/components/achievements/AchievementsPage.tsx` (card 126, Mastery preview 62-80, `CATEGORY_LABEL` 27-37)
- Modify: `src/components/achievements/AchievementsModal.tsx` (`CATEGORY_ICON` 22-33)
- Modify: `src/components/achievements/AchievementToaster.tsx` (toast 76-101)
- Modify: `src/components/achievements/achievements-ui.test.ts`
- Modify: `src/locales/en.json`, `src/locales/fr.json`
- Test: `src/lib/achievements.test.ts`, `src/components/achievements/achievement-filters.test.ts`, `src/components/achievements/achievements-ui.test.ts`

**Interfaces:**
- Consumes: `rewardLineVisible`, `characterUnlocked`, `Unlocks`, `rewardLabel`
- Produces:
  - `export function displayReward(reward: AchievementReward, unlocks: Unlocks, options?: { revealing?: boolean }): string | null`
  - Locale keys: `achievements.category.claude`, `achievements.reward.surpriseCharacter`, `achievements.reward.surpriseLook`, `achievements.reward.emote`, `achievements.reward.move`, `achievements.reward.accessory`, `achievements.reward.effect`

- [ ] **Step 1: Write the failing tests**

Locales first so `LocaleKey` includes the new keys. Add to `en.json`:

```json
  "achievements.category.claude": "Claude",
  "achievements.reward.surpriseCharacter": "a surprise character",
  "achievements.reward.surpriseLook": "a surprise look",
  "achievements.reward.emote": "Look unlocked: {name}",
  "achievements.reward.move": "Move unlocked: {name}",
  "achievements.reward.accessory": "Accessory unlocked: {name}",
  "achievements.reward.effect": "Effect unlocked: {name}"
```

Add to `fr.json`:

```json
  "achievements.category.claude": "Claude",
  "achievements.reward.surpriseCharacter": "un personnage surprise",
  "achievements.reward.surpriseLook": "une allure surprise",
  "achievements.reward.emote": "Allure debloquee : {name}",
  "achievements.reward.move": "Mouvement debloque : {name}",
  "achievements.reward.accessory": "Accessoire debloque : {name}",
  "achievements.reward.effect": "Effet debloque : {name}"
```

Type the French with real accents (`débloquée`, `débloqué`). No long dashes. Then `node scripts/generate-locale.mjs fr --accept` is not required if you edit `fr.json` by hand; run `pnpm i18n:check` after.

```ts
import { displayReward, rewardLabel } from "./achievements";
import { NOTHING_LOCKED } from "../../shared/achievements";
import { achievementById } from "../../shared/achievements-catalog";

it("names a locked crab skin a surprise look and hides unregistered items", () => {
  const locked = { enforced: true, keys: new Set<string>() };
  const hello = achievementById("hello-bot")!.rewards.find((reward) => reward.kind === "skin" && reward.character === "crab")!;
  expect(displayReward(hello, locked)).toBe("a surprise look");
  expect(displayReward({ kind: "character", character: "crab" }, locked)).toBe("a surprise character");
  expect(displayReward({ kind: "emote", character: "crab", id: "proud" }, locked)).toBeNull();
  expect(displayReward({ kind: "character", character: "crab" }, locked, { revealing: true })).toBe("Character unlocked: Crab");
  const owned = { enforced: true, keys: new Set(["character:crab"]) };
  expect(displayReward(hello, owned)).toBe("Skin unlocked: Pearl (Crab)");
  expect(displayReward({ kind: "emote", character: "crab", id: "neutral" }, owned)).toBe("Look unlocked: Neutral");
});
```

In `achievement-filters.test.ts`:

```ts
it("does not match Crab through a locked crab-skin reward", () => {
  const hello = ACHIEVEMENTS.find((item) => item.id === "hello-bot")!;
  const locked = { enforced: true, keys: new Set<string>() };
  expect(achievementMatches(hello, undefined, query({ search: "Crab" }), locked)).toBe(false);
  expect(achievementMatches(hello, undefined, query({ search: "Pearl" }), locked)).toBe(false);
  expect(achievementMatches(hello, undefined, query({ search: "Alive" }), locked)).toBe(true);
  expect(achievementMatches(hello, undefined, query({ search: "surprise" }), locked)).toBe(true);
  const army = ACHIEVEMENTS.find((item) => item.id === "crab-army")!;
  expect(achievementMatches(army, undefined, query({ search: "Crab" }), locked)).toBe(true);
});
```

`achievementMatches` gains a fourth argument `unlocks: Unlocks = NOTHING_LOCKED` so existing tests keep passing.

- [ ] **Step 2: Run** `pnpm exec vitest run src/lib/achievements.test.ts src/components/achievements/achievement-filters.test.ts`: expect FAIL (`displayReward` missing; search still uses `rewardLabel` which names Crab).

- [ ] **Step 3: Implement**

```ts
export function displayReward(reward: AchievementReward, unlocks: Unlocks, options?: { revealing?: boolean }): string | null {
  if (!rewardLineVisible(reward)) return null;
  const surprise = !options?.revealing && (reward.kind === "character" || reward.kind === "skin") && !characterUnlocked(unlocks, reward.character);
  if (surprise && reward.kind === "character") return t("achievements.reward.surpriseCharacter");
  if (surprise && reward.kind === "skin") return t("achievements.reward.surpriseLook");
  return rewardLabel(reward);
}

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
      return t("achievements.reward.emote", { name: reward.id });
    case "move":
      return t("achievements.reward.move", { name: reward.id });
    case "accessory":
      return t("achievements.reward.accessory", { name: reward.id });
    case "effect":
      return t("achievements.reward.effect", { name: reward.id });
  }
}
```

`searchText` maps rewards through `displayReward(reward, unlocks)` and drops nulls.

`AchievementCard` and `MasteryUnlockPreview` take `unlocks`. For Mastery looks of a locked character, skip `RewardPreview` and do not put the real name in `title`. For a visible registered reward, show `displayReward`. For `null`, omit the span.

`AchievementToast`: `const line = displayReward(reward, achievementsState().unlocks, { revealing: true });` render the line and `RewardPreview` only when `line` is non-null and `reward.kind` is `character` or `skin`. For `claude-linked`, `revealing: true` prints "Character unlocked: Crab" and draws crab art.

`CATEGORY_LABEL.claude = "achievements.category.claude"`. `CATEGORY_ICON.claude = Sparkles` (import from `lucide-react`).

- [ ] **Step 4: Run** `pnpm exec vitest run src/lib/achievements.test.ts src/components/achievements/achievement-filters.test.ts src/components/achievements/achievements-ui.test.ts src/lib/achievement-toasts.test.ts` and `pnpm i18n:check`: expect PASS.

- [ ] **Step 5: Commit**

```
git add src/lib/achievements.ts src/lib/achievements.test.ts src/components/achievements src/locales/en.json src/locales/fr.json
git commit -m "feat(achievements): surprise copy until the crab unlocks"
```

---

### Task 8: iOS CompanionCore catalog and wording

**Files:**
- Modify: `ios/Sources/CompanionCore/Achievements.swift` (`AchievementCategory` 34-37, `AchievementReward` 48-62)
- Modify: `ios/Sources/CompanionCore/BotPanelRules.swift` (182-183, comment 182)
- Modify: `ios/parity/achievements-catalog.mjs` (`reward` 53-60)
- Modify: `ios/Sources/CompanionCore/AchievementCatalog.swift` (generated)
- Modify: `ios/App/Features/Achievements/AchievementWording.swift` (10-20, 42-54, symbols 71)
- Modify: `ios/Tests/CompanionCoreTests/MascotLookFixtureTests.swift` (309)
- Modify: `ios/Tests/CompanionCoreTests/SettingsAppearanceParityTests.swift` (15)
- Modify: `ios/Tests/CompanionCoreTests/BotPanelDetailsTests.swift` (332-347)
- Test: `cd ios` then `swift test`

**Interfaces:**
- Consumes: Task 1 kinds and keys; Task 2 category `claude`; `REWARD_REGISTRY`
- Produces:
  - `AchievementCategory.claude`
  - `AchievementReward.emote(character:id:)`, `.move(character:id:)`, `.accessory(id:)`, `.effect(id:)`
  - `AchievementReward.key` matches `rewardKey`
  - `public enum RewardRegistry` with `lineVisible(_ reward: AchievementReward) -> Bool`
  - `MascotUnlocks.defaultCharacters: Set<MascotCharacter> = [.owl]`
  - `AchievementWording.displayReward(_:language:keys:revealing:) -> String?`
  - `AchievementWording.symbol` maps `"Link"` to `"link"`

- [ ] **Step 1: Write the failing tests** in CompanionCore tests.

`MascotLookFixtureTests.swift` line 309:

```swift
XCTAssertFalse(MascotUnlocks.defaultCharacters.contains(.crab))
XCTAssertTrue(MascotUnlocks.defaultCharacters.contains(.owl))
```

`SettingsAppearanceParityTests.swift` line 15: `XCTAssertEqual(catalog.count, 86)`.

`BotPanelDetailsTests.swift` in `testSkinLocksFollowTheEarnedRewardsAndTheWornSkinStays`:

```swift
XCTAssertTrue(earned.characterLocked(.crab, current: .owl))
XCTAssertFalse(earned.characterLocked(.crab, current: .crab), "what the bot wears stays usable")
XCTAssertFalse(MascotUnlocks.nothingLocked.characterLocked(.crab, current: .owl))
let crab = MascotUnlocks(enforced: true, keys: ["character:crab"])
XCTAssertFalse(crab.characterLocked(.crab, current: .owl))
```

Add `AchievementCatalogTests` (or extend SettingsAppearanceParityTests):

```swift
func testClaudeLinkedRewardsTheCrabAndHidesUnregisteredLines() {
    let linked = AchievementDefinition.lookup("claude-linked")
    XCTAssertEqual(linked?.category, .claude)
    XCTAssertEqual(linked?.rewards.first?.key, "character:crab")
    XCTAssertTrue(RewardRegistry.lineVisible(.character(id: "crab", name: AchievementText(en: "Crab", fr: "Crabe", ptBR: "Crab"))))
    XCTAssertFalse(RewardRegistry.lineVisible(.emote(character: "crab", id: "proud")))
    XCTAssertTrue(RewardRegistry.lineVisible(.emote(character: "crab", id: "neutral")))
}
```

- [ ] **Step 2: Run** `cd ios` then `swift test`: expect FAIL (`catalog.count` 76, `defaultCharacters` contains crab, no `.claude`).

- [ ] **Step 3: Implement**

`Achievements.swift`:

```swift
public enum AchievementCategory: String, CaseIterable, Hashable, Sendable {
    case onboarding, productivity, power, voice, claude, collaboration, streaks, mastery, tiers, secrets
}

public enum AchievementReward: Hashable, Sendable {
    case character(id: String, name: AchievementText)
    case skin(character: String, skin: String, name: AchievementText, characterName: AchievementText)
    case appIcon(id: String)
    case title(id: String, name: AchievementText)
    case emote(character: String, id: String)
    case move(character: String, id: String)
    case accessory(id: String)
    case effect(id: String)

    public var key: String {
        switch self {
        case let .character(id, _): return "character:\(id)"
        case let .skin(character, skin, _, _): return "skin:\(character):\(skin)"
        case let .appIcon(id): return "appIcon:\(id)"
        case let .title(id, _): return "title:\(id)"
        case let .emote(character, id): return "emote:\(character):\(id)"
        case let .move(character, id): return "move:\(character):\(id)"
        case let .accessory(id): return "accessory:\(id)"
        case let .effect(id): return "effect:\(id)"
        }
    }
}

public enum RewardRegistry {
    public static let emotes: [String: Set<String>] = ["crab": ["neutral", "happy", "curious", "sleepy"]]
    public static let moves: [String: Set<String>] = [:]
    public static let accessories: Set<String> = []
    public static let effects: Set<String> = []

    public static func lineVisible(_ reward: AchievementReward) -> Bool {
        switch reward {
        case .character, .skin, .appIcon, .title: return true
        case let .emote(character, id): return emotes[character]?.contains(id) == true
        case let .move(character, id): return moves[character]?.contains(id) == true
        case let .accessory(id): return accessories.contains(id)
        case let .effect(id): return effects.contains(id)
        }
    }
}
```

Prefer generating `RewardRegistry` from `REWARD_REGISTRY` in `ios/parity/achievements-catalog.mjs` so the four base emotes cannot drift. Extend `reward()`:

```js
    case "emote": return `.emote(character: ${s(r.character)}, id: ${s(r.id)})`;
    case "move": return `.move(character: ${s(r.character)}, id: ${s(r.id)})`;
    case "accessory": return `.accessory(id: ${s(r.id)})`;
    case "effect": return `.effect(id: ${s(r.id)})`;
```

Run `node ios/parity/achievements-catalog.mjs` then `node ios/parity/achievements-catalog.mjs --check`.

`BotPanelRules.swift`:

```swift
    /// The character every person has (`DEFAULT_CHARACTERS`): the owl. The crab waits on `character:crab`.
    public static let defaultCharacters: Set<MascotCharacter> = [.owl]
```

`AchievementWording.swift` add `case .claude?: "Claude"`, `Link: "link"`, and:

```swift
    static func displayReward(_ reward: AchievementReward, language: String?, keys: Set<String>, revealing: Bool = false) -> String? {
        guard RewardRegistry.lineVisible(reward) else { return nil }
        if !revealing {
            if case let .character(id, _) = reward, !keys.contains("character:\(id)") && id != "owl" {
                return String(localized: "a surprise character")
            }
            if case let .skin(character, _, _, _) = reward, !keys.contains("character:\(character)") && character != "owl" {
                return String(localized: "a surprise look")
            }
        }
        return rewardLabel(reward, language: language)
    }
```

Extend `rewardLabel` with emote/move/accessory/effect using `String(localized:)` and the id. iOS search (`Achievements.swift:350-359`) already matches name and description only, so "Crab" does not leak through reward labels on the phone.

Do not change `MascotGalleryView.swift` crab stills.

- [ ] **Step 4: Run** `cd ios` then `swift test`: expect PASS. Run `node ios/parity/achievements-catalog.mjs --check`: expect silent success.

- [ ] **Step 5: Commit**

```
git add ios/Sources/CompanionCore/Achievements.swift ios/Sources/CompanionCore/BotPanelRules.swift ios/Sources/CompanionCore/AchievementCatalog.swift ios/parity/achievements-catalog.mjs ios/App/Features/Achievements/AchievementWording.swift ios/Tests/CompanionCoreTests
git commit -m "feat(ios): Claude category, crab default, catalog 86"
```

---

### Task 9: iOS app cards, toast, editor, UITest

**Files:**
- Modify: `ios/App/Features/Achievements/AchievementsPage.swift` (`AchievementCard` 278-327)
- Modify: `ios/App/Features/Achievements/AchievementStore.swift` (`rewardLabel` 228-230)
- Modify: `ios/App/Features/Achievements/AchievementToast.swift` (`AchievementToastView` 124-158)
- Modify: `ios/App/Mascots/CharacterEditor.swift` (filter 125 already correct; no picker change)
- Modify: `ios/App/Desktop/BotPanelAvatarEditor.swift` (filter 141 already correct)
- Modify: `ios/UITests/BotPanelDetailsUITests.swift` (Character section 347)
- Test: `cd ios` then `swift test`; UITest via `xcodebuild` (skips without `PARITY_ENDPOINT` / `PARITY_TOKEN`)

**Interfaces:**
- Consumes: `AchievementWording.displayReward`, `MascotUnlocks.characterLocked`, snapshot `rewards`
- Produces: cards and toasts that omit unregistered lines and surprise-word locked characters; UITest `testLockedCrabIsAbsentFromTheCharacterRow`

- [ ] **Step 1: Write the failing tests**

CompanionCore already covers locks. Add an App-level wording test if one exists; otherwise keep the assertions in `BotPanelDetailsTests` and add the UITest:

```swift
    /// Character row (BP6): Owl is always there; Crab is absent until character:crab is in rewards.
    @MainActor
    func testLockedCrabIsAbsentFromTheCharacterRow() throws {
        let rewards = (try api("GET", "/api/me/achievements", allowFailure: true) as? [String: Any])?["rewards"] as? [String]
        guard let rewards else { throw XCTSkip("this server keeps no achievements: nothing is locked") }
        let ara = try XCTUnwrap(try bot(named: "Ara"))
        let id = try XCTUnwrap(ara["id"] as? String)
        defer { _ = try? api("PATCH", "/api/bots/\(id)", ["mascotLook": ["character": "owl"], "color": "purple", "mascotSkin": "none"]) }
        try api("PATCH", "/api/bots/\(id)", ["mascotLook": ["character": "owl"]])
        let app = launchProfile()
        element("profile-mascot", in: app).tap()
        XCTAssertTrue(app.buttons["Owl"].firstMatch.waitForExistence(timeout: 15), "Owl stays on the row")
        if rewards.contains("character:crab") {
            XCTAssertTrue(app.buttons["Crab"].firstMatch.waitForExistence(timeout: 10), "unlocked crab is on the row")
        } else {
            XCTAssertFalse(app.buttons["Crab"].firstMatch.exists, "locked crab is absent")
        }
    }
```

Task 8 already asserts `displayReward` (surprise, unregistered, `claude-linked` key). This task's failing check is the UITest above: until `defaultCharacters` is owl-only (Task 8) and the card/toast call `displayReward`, Crab still appears on a fixture with empty rewards.

- [ ] **Step 2: Run** `cd ios` then `swift test`: expect PASS (Task 8 tests). The UITest skips when `PARITY_ENDPOINT` is unset (`XCTSkip` in `setUpWithError`). On a fixture whose GET rewards omit `character:crab`, the new test FAIL message is `locked crab is absent` if Crab is still on the row.

- [ ] **Step 3: Implement**

Pass `keys: Set(snapshot.rewards)` into `AchievementCard`. Replace the reward `Text` at 325-327:

```swift
                    if !secret, let reward = definition.rewards.first,
                       let line = AchievementWording.displayReward(reward, language: language, keys: keys) {
                        Text(verbatim: line).lineLimit(1)
                    }
```

`AchievementToastItem.rewardLabel`:

```swift
    func rewardLabel(_ language: String?, keys: Set<String>) -> String? {
        guard let reward = definition.rewards.first else { return nil }
        return AchievementWording.displayReward(reward, language: language, keys: keys, revealing: true)
    }
```

`AchievementToastView` uses that. For `claude-linked`, revealing prints "Character unlocked: Crab". Unregistered `proud` on `first-pinch` prints nothing.

Character editors already filter with `characterLocked`. Removing crab from `defaultCharacters` hides it unless worn. No extra picker work. `CreateBotSheet` uses `CharacterEditor`.

- [ ] **Step 4: Run** `cd ios` then `swift test`: expect PASS. After `cd ios` and `xcodegen generate`:

```
xcodebuild -project Sagax.xcodeproj -scheme Sagax -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -only-testing:SagaxUITests/BotPanelDetailsUITests/testLockedCrabIsAbsentFromTheCharacterRow test
```

Expect SKIP without a fixture, PASS on a fixture whose GET rewards omit `character:crab` (Owl present, Crab absent) and PASS on a fixture that includes `character:crab` (both present).

- [ ] **Step 5: Commit**

```
git add ios/App/Features/Achievements/AchievementsPage.swift ios/App/Features/Achievements/AchievementStore.swift ios/App/Features/Achievements/AchievementToast.swift ios/UITests/BotPanelDetailsUITests.swift
git commit -m "feat(ios): surprise rewards and hide locked crab"
```

---

### Task 10: Parity matrix and AGENTS.md

**Files:**
- Modify: `docs/superpowers/specs/2026-10-03-ios-feature-parity-matrix.md` (BP6 row 285, ST9 row 414)
- Modify: `AGENTS.md` (Achievements 2370-2429, especially 2386-2394)
- Test: none beyond reading the two files; `pnpm exec vitest run shared/achievements-catalog.test.ts` and `cd ios` then `swift test` still pass from Tasks 2 and 8.

**Interfaces:**
- Consumes: behavior from Tasks 6-9
- Produces: BP6 and ST9 notes; AGENTS.md owl-only default and crab-from-Claude

- [ ] **Step 1: Write the failing check** as a grep of the docs (no code test). Confirm AGENTS.md still says "only the owl and its Common skins" without the crab, after the edit. Before the edit, line 2386 says "By default only the owl and its Common skins are usable" already; the next sentences must name the crab.

- [ ] **Step 2: Run** nothing that fails yet; this task is documentation. Re-read BP6 and ST9.

- [ ] **Step 3: Implement**

BP6 iPhone cell currently `PARTIAL (no locks or tiers)`. Change the iPhone note to: `PARTIAL (character row hides locked characters including crab until character:crab; worn stays; skin row still has no tier tabs)`. Placement stays `lock badges in the skin row`. Do not mark DONE.

ST9 stays `MISSING` (screens exist: `AchievementsPage.swift`, `AchievementToast.swift`). Add in the iPhone / notes cell: `category claude, server-side claude.linked, surprise reward copy on cards; do not widen ST9 past those rows in this sub-project`.

AGENTS.md Achievements bullet starting line 2386, replace the default-character sentence with:

```
- By default only the owl and its Common skins are usable. The crab unlocks
  when the person's own Claude account is linked (own `claude auth login` or
  own Anthropic key, recorded as server event `claude.linked`; an organization
  key does not link). Shapes unlocks when a Grok account is linked (the
  person's own sign-in or their own xAI key, reported as `grok.linked`).
  Trombi unlocks only from its hidden command (an easter egg; do not write
  the command down), or on a device that already found it. Locked characters
  are absent from every picker until unlocked. Every skin above Common, and
  Bunbu, is the reward of exactly one achievement. On first use a person keeps
  every character and skin their bots wear (`grandfatheredFromBots`); a later
  one-time `migratedCrab` pass keeps a crab that was already worn. What a bot
  wears now stays in the editor. Locked rewards are hidden in the editor and
  the app icon picker until they unlock. The server never refuses a look.
```

Keep the rest of the Achievements section (privacy, toasts, visibility).

- [ ] **Step 4: Run** `pnpm exec vitest run shared/achievements-catalog.test.ts src/components/crab.test.ts` and `cd ios` then `swift test`: expect PASS. Run `pnpm typecheck` and `pnpm lint`.

- [ ] **Step 5: Commit**

```
git add docs/superpowers/specs/2026-10-03-ios-feature-parity-matrix.md AGENTS.md
git commit -m "docs: crab unlock parity notes and Achievements rules"
```

---

## Self-review

| Spec section | Task |
|---|---|
| Only owl default; crab from `character:crab` | 2, 8 |
| Locked characters absent everywhere | 6, 9 |
| Surprise copy for locked character / crab skin | 7, 9 |
| Grandfather worn crab (`migratedCrab`) | 5 |
| Approach A server-detected link; org key false; GET reconcile | 3 |
| Category `claude`; server events; `modelFamily === "anthropic"` | 2, 4 |
| Reward kinds, registry, hide unregistered | 1, 7, 8 |
| Draft ladder (ids, points, rewards, en/fr) | 2 |
| `eventStreak` / `claw-streak` 20 | 2 |
| Activity hooks turn/subagent/routine/computer/voice; Auto; Fable | 4 |
| Catalog test crab once; invert `crab.test.ts:116` | 2 |
| Desktop gallery / To unlock / grokLinked injection / reward filter | 6 |
| Cards, search, Mastery, toast reveal, fr strings | 7 |
| iOS defaultCharacters, catalog regen, wording, fixtures | 8 |
| iOS cards, toast, editor, UITest | 9 |
| DEBUG gallery keeps crab stills | 8 (explicit non-change) |
| BP6, ST9, AGENTS.md | 10 |
| Unlink keeps crab; POST refuses `claude.linked` | 3 |
| Org-key turns count | 4 |
| `enforced: false` crab pickable | 2 (`characterUnlocked`), 8 (`nothingLocked`) |

Names used in every later task match Task 1-4 produces: `rewardKey`, `rewardLineVisible`, `REWARD_REGISTRY`, `eventStreak`, `claudeTide`, `claudeActivityEvents`, `isClaudeComputerTool`, `claudeAccountLinked`, `ClaudeAccountInput`, `migratedCrabFromBots`, `displayReward`. No TBD, TODO, or "similar to Task N" steps.
