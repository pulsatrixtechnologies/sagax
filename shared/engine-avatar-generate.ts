/**
 * Generate an open-bot-avatar definition (engine format, version 1) from a
 * short description, for the mascot picker's Generate panel [D-20261127-005]
 * (#5450, follows #5369). The reply is the same JSON Import accepts
 * (parseEngineAvatar / validateAvatar). Offline keyword match falls back to
 * the engine's gallery and examples; when a text model is available the
 * design prompt asks for validated geometry JSON (retry once, then fall back).
 */
import { getExample, validateAvatar } from "open-bot-avatar";
import cat from "../third_party/open-bot-avatar/gallery/cat.json" with { type: "json" };
import cloud from "../third_party/open-bot-avatar/gallery/cloud.json" with { type: "json" };
import rocket from "../third_party/open-bot-avatar/gallery/rocket.json" with { type: "json" };
import ghost from "../third_party/open-bot-avatar/gallery/ghost.json" with { type: "json" };
import { parseEngineAvatar, type EngineAvatarDef } from "./engine-avatar-def.ts";
import { SHAPE_AVATAR_DIRECTION_MAX } from "./shape-avatar-generate.ts";

export { SHAPE_AVATAR_DIRECTION_MAX as ENGINE_AVATAR_DIRECTION_MAX };

/** Marker the fake engine routes on (never call real providers in tests). */
export const ENGINE_AVATAR_PROMPT_MARKER = "You are the OPEN-BOT-AVATAR step.";

/** A simple robot silhouette used when the description asks for one and no model answered. */
const ROBOT: EngineAvatarDef = {
  version: 1,
  id: "robot",
  name: "Robot",
  body: {
    path:
      "M38 18H62A6 6 0 0 1 68 24V36H74A4 4 0 0 1 78 40V70A4 4 0 0 1 74 74H68V86A4 4 0 0 1 64 90H36A4 4 0 0 1 32 86V74H26A4 4 0 0 1 22 70V40A4 4 0 0 1 26 36H32V24A6 6 0 0 1 38 18Z"
      + "M46 10H54A2 2 0 0 1 56 12V18H44V12A2 2 0 0 1 46 10Z",
  },
  eyes: { x: 50, y: 42, spacing: 16, scale: 1.1 },
};

type Fallback = { id: string; words: RegExp; def: EngineAvatarDef };

function asEngine(value: unknown, fallbackId: string): EngineAvatarDef {
  const result = validateAvatar(value);
  if (!result.ok) throw new Error(`engine fallback ${fallbackId} failed validation: ${result.errors[0] ?? "invalid"}`);
  return result.value as EngineAvatarDef;
}

function exampleOr(id: string, fallback: EngineAvatarDef): EngineAvatarDef {
  const found = getExample(id);
  return found ? asEngine(found, id) : fallback;
}

const FALLBACKS: Fallback[] = [
  { id: "cat", words: /\b(cat|chat|kitten|minou|felin|feline)\b/i, def: asEngine(cat, "cat") },
  { id: "mug", words: /\b(cup|mug|tasse|coffee|tea|boisson|verre)\b/i, def: exampleOr("mug", ROBOT) },
  { id: "rocket", words: /\b(rocket|fus[eé]e|ship|space|missile)\b/i, def: asEngine(rocket, "rocket") },
  { id: "cloud", words: /\b(cloud|nuage|sky|ciel)\b/i, def: asEngine(cloud, "cloud") },
  { id: "robot", words: /\b(robot|bot|android|automate|mecha)\b/i, def: asEngine(ROBOT, "robot") },
  { id: "ghost", words: /\b(ghost|fant[oô]me|spirit)\b/i, def: asEngine(ghost, "ghost") },
  { id: "controller", words: /\b(pad|game\s*pad|controller|gamepad|manette|joy\s*pad)\b/i, def: exampleOr("controller", ROBOT) },
  { id: "lightbulb", words: /\b(bulb|light\s*bulb|ampoule|lamp|idea)\b/i, def: exampleOr("lightbulb", ROBOT) },
  { id: "chat", words: /\b(say|speech|bubble|bulle|message|talk)\b/i, def: exampleOr("chat", ROBOT) },
  { id: "sprout", words: /\b(sprout|plant|leaf|plante|flower|pot|pousse)\b/i, def: exampleOr("sprout", ROBOT) },
];

export function matchEngineAvatarFallback(direction: string): EngineAvatarDef {
  const text = direction.trim();
  for (const hint of FALLBACKS) {
    if (hint.words.test(text)) return named(hint.def, text);
  }
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) sum = (sum + text.charCodeAt(i) * (i + 1)) % 997;
  const pick = FALLBACKS[sum % FALLBACKS.length]!;
  return named(pick.def, text);
}

function named(def: EngineAvatarDef, direction: string): EngineAvatarDef {
  const name = direction.replace(/\s+/g, " ").trim().slice(0, 40) || def.name;
  return asEngine({ ...def, name }, def.id);
}

export function generateEngineAvatarDef(direction: string): EngineAvatarDef {
  const bounded = direction.trim().slice(0, SHAPE_AVATAR_DIRECTION_MAX);
  return matchEngineAvatarFallback(bounded || "friendly shape");
}

/** Design prompt: model returns one open-bot-avatar AvatarDefinition JSON object. */
export function engineAvatarGenerationPrompt(direction: string): string {
  const bounded = direction.trim().slice(0, SHAPE_AVATAR_DIRECTION_MAX);
  return [
    ENGINE_AVATAR_PROMPT_MARKER,
    "Return one JSON object for an open-bot-avatar mascot silhouette. Geometry only.",
    'Schema: { "version": 1, "id": "<lowercase-slug>", "name": "<short name>", "body": { "path": "M…Z" }, "eyes": { "x": 0..100, "y": 0..100, "spacing": number, "scale": 0.6..1.6 } }.',
    "Box is 0..100. body.path is one filled SVG path (closed subpaths; holes wind opposite). No colour, fill, palette, script, href, or onClick.",
    "Eyes sit inside the face-bearing mass. Prefer one clear object that reads at 28 to 96 px.",
    "Answer with one JSON object and nothing else.",
    `Visual direction: ${JSON.stringify(bounded || "a friendly clay object")}`,
  ].join("\n");
}

/** Pull JSON from a model answer (fenced or bare), same idea as Import. */
export function parseEngineAvatarModelText(text: string): string {
  const trimmed = text.trim();
  const fence = /```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/.exec(trimmed);
  if (fence) return fence[1]!.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  return first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
}

export type EngineTextEngine = {
  generateText: (prompt: string, options?: { signal?: AbortSignal; noThinking?: boolean }) => Promise<string>;
};

/**
 * Ask the model for an engine definition; validate with the same path as
 * Import; retry once on invalid; fall back to the gallery mapping when the
 * engine is missing or keeps failing.
 */
export async function generateEngineAvatarDefWithModel(
  direction: string,
  engine: EngineTextEngine | null | undefined,
  options?: { signal?: AbortSignal },
): Promise<{ def: EngineAvatarDef; source: "model" | "fallback" }> {
  const bounded = direction.trim().slice(0, SHAPE_AVATAR_DIRECTION_MAX);
  if (!engine?.generateText) {
    return { def: generateEngineAvatarDef(bounded || "friendly shape"), source: "fallback" };
  }
  const prompt = engineAvatarGenerationPrompt(bounded || "friendly shape");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await engine.generateText(prompt, { signal: options?.signal, noThinking: true });
      const parsed = parseEngineAvatar(parseEngineAvatarModelText(text));
      if (parsed.ok) return { def: parsed.def, source: "model" };
    } catch {
      // retry or fall back
    }
  }
  return { def: generateEngineAvatarDef(bounded || "friendly shape"), source: "fallback" };
}
