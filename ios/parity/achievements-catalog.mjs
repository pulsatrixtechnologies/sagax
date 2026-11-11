#!/usr/bin/env node
// Writes ios/Sources/CompanionCore/AchievementCatalog.swift from the
// desktop's catalog (shared/achievements-catalog.ts), the one source of the
// names, descriptions, hints, icons, points and rewards: the server sends
// only each achievement's state (GET /api/me/achievements). Reward names
// (characters, skins) come from the renderer's locale files, as
// src/lib/achievements.ts `rewardLabel` reads them. RewardRegistry is emitted
// from shared/achievements.ts REWARD_REGISTRY so the four base crab emotes
// cannot drift.
//
//   node ios/parity/achievements-catalog.mjs        # rewrite the Swift file
//   node ios/parity/achievements-catalog.mjs --check # fail when it is stale
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "ios", "Sources", "CompanionCore", "AchievementCatalog.swift");
const { ACHIEVEMENTS } = await import(join(ROOT, "shared", "achievements-catalog.ts"));
const { REWARD_REGISTRY } = await import(join(ROOT, "shared", "achievements.ts"));
// The Mastery characters (shared/mascot-unlocks.ts) may not be in the locales
// yet: their names and their skins' come from the registry until they are.
const { isMasteryCharacter, masteryCharacterName, masterySkinName } = await import(join(ROOT, "shared", "mascot-unlocks.ts"));
const locale = (name) => JSON.parse(readFileSync(join(ROOT, "src", "locales", `${name}.json`), "utf8"));
const LOCALES = { en: locale("en"), fr: locale("fr"), ptBR: locale("pt-br") };

const CHARACTER_KEY = { owl: "floatingBots.mascot.owl", shape: "floatingBots.mascot.body", trombi: "floatingBots.mascot.trombi", bunbu: "floatingBots.mascot.bunbu" };
const skinKey = (character, skin) => character === "owl"
  ? `mascot.skin.${skin === "none" ? "classic" : skin}`
  : `mascot.${character === "shape" ? "shapeSkin" : `${character}Skin`}.${skin}`;
const has = (key) => LOCALES.en[key] !== undefined;
// a Mastery character's locale keys win once its branch lands; a language they
// do not cover yet keeps the registry's name
const withRegistry = (key, registry) => {
  if (!has(key)) return registry;
  const text = pick(key);
  return { ...text, ptBR: LOCALES.ptBR[key] ?? registry.ptBR ?? text.ptBR };
};
const characterText = (character) => {
  const key = CHARACTER_KEY[character] ?? `floatingBots.mascot.${character}`;
  return isMasteryCharacter(character) ? withRegistry(key, masteryCharacterName(character)) : pick(key);
};
const skinText = (character, skin) => {
  const key = skinKey(character, skin);
  return isMasteryCharacter(character) ? withRegistry(key, masterySkinName(character, skin)) : pick(key);
};
const pick = (key) => {
  const en = LOCALES.en[key];
  if (en === undefined) throw new Error(`missing locale key ${key}`);
  return { en, fr: LOCALES.fr[key] ?? en, ptBR: LOCALES.ptBR[key] ?? en };
};
const s = (text) => JSON.stringify(text);
const text = (t) => (t ? `AchievementText(en: ${s(t.en)}, fr: ${s(t.fr ?? t.en)}, ptBR: ${s(t.ptBR ?? t.en)})` : "nil");

function reward(r) {
  switch (r.kind) {
    case "character": return `.character(id: ${s(r.character)}, name: ${text(characterText(r.character))})`;
    case "skin": return `.skin(character: ${s(r.character)}, skin: ${s(r.skin)}, name: ${text(skinText(r.character, r.skin))}, characterName: ${text(characterText(r.character))})`;
    case "appIcon": return `.appIcon(id: ${s(r.id)})`;
    case "title": return `.title(id: ${s(r.id)}, name: ${text(r.name)})`;
    case "emote": return `.emote(character: ${s(r.character)}, id: ${s(r.id)})`;
    case "move": return `.move(character: ${s(r.character)}, id: ${s(r.id)})`;
    case "accessory": return `.accessory(id: ${s(r.id)})`;
    case "effect": return `.effect(id: ${s(r.id)})`;
    default: throw new Error(`unknown reward ${r.kind}`);
  }
}

function swiftStringSet(ids) {
  const list = Array.isArray(ids) ? [...ids] : [];
  if (list.length === 0) return "[]";
  return `[${list.map(s).join(", ")}]`;
}

function swiftDictOfSets(map) {
  const keys = Object.keys(map ?? {}).sort();
  if (keys.length === 0) return "[:]";
  return `[${keys.map((key) => `${s(key)}: ${swiftStringSet(map[key])}`).join(", ")}]`;
}

const registrySwift = `public enum RewardRegistry {
    public static let emotes: [String: Set<String>] = ${swiftDictOfSets(REWARD_REGISTRY.emotes)}
    public static let moves: [String: Set<String>] = ${swiftDictOfSets(REWARD_REGISTRY.moves)}
    public static let accessories: Set<String> = ${swiftStringSet(REWARD_REGISTRY.accessories)}
    public static let effects: Set<String> = ${swiftStringSet(REWARD_REGISTRY.effects)}

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
`;

// One append statement per achievement: a single array literal of every
// entry is one expression, slow for older Swift type checkers (#3702).
const entries = ACHIEVEMENTS.map((a) => [
  "        catalog.append(AchievementDefinition(",
  `            id: ${s(a.id)}, category: .${a.category}, icon: ${s(a.icon)}, points: ${a.points}, hidden: ${a.hidden === true},`,
  `            name: ${text(a.name)},`,
  `            description: ${text(a.description)},`,
  `            hint: ${text(a.hint)},`,
  `            rewards: [${(a.rewards ?? []).map(reward).join(", ")}]`,
  "        ))",
].join("\n"));

const swift = `// Generated by ios/parity/achievements-catalog.mjs from
// shared/achievements-catalog.ts, shared/achievements.ts (REWARD_REGISTRY)
// and src/locales: do not edit by hand.
// The catalog has English and French (and Portuguese for the Mastery
// tier); Portuguese falls back to English elsewhere, except for the reward
// names, which the renderer's locales carry.
import Foundation

public extension AchievementDefinition {
    static let catalog: [AchievementDefinition] = {
        var catalog: [AchievementDefinition] = []
        catalog.reserveCapacity(${ACHIEVEMENTS.length})
${entries.join("\n")}
        return catalog
    }()
}

${registrySwift}`;

if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== swift) { console.error("AchievementCatalog.swift is stale: run node ios/parity/achievements-catalog.mjs"); process.exit(1); }
} else {
  writeFileSync(OUT, swift);
  console.log(`${ACHIEVEMENTS.length} achievements -> ${OUT}`);
}
