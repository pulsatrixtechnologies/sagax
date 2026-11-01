/**
 * Build a Shape avatar definition from a short description. Offline keyword
 * match is the fallback; when a text engine is available the design prompt
 * asks for validated geometry JSON (retry once, then fall back).
 */
import {
  OBJECT_SHAPE_BY_ID,
  OBJECT_SHAPE_IDS,
  type ObjectShapeId,
} from "./shape-avatar-presets.ts";
import {
  compileShapeAvatar,
  defaultPillEyes,
  SHAPE_AVATAR_LIMITS,
  SHAPE_AVATAR_SCHEMA_VERSION,
  validateShapeAvatarDef,
  type ShapeAvatarDef,
} from "./shape-avatar-def.ts";
import { botMascotLook, type MascotLook } from "./mascot-look.ts";

export const SHAPE_AVATAR_DIRECTION_MAX = 400;

/** Marker the fake engine routes on (never call real providers in tests). */
export const SHAPE_AVATAR_PROMPT_MARKER = "You are the SHAPE AVATAR step.";

const HINTS: Array<{ id: ObjectShapeId; words: RegExp }> = [
  { id: "pad", words: /\b(pad|game\s*pad|controller|gamepad|manette|joy\s*pad)\b/i },
  { id: "cup", words: /\b(cup|mug|tasse|coffee|tea|boisson)\b/i },
  { id: "bulb", words: /\b(bulb|light\s*bulb|ampoule|lamp|idea)\b/i },
  { id: "say", words: /\b(say|speech|bubble|chat|bulle|message|talk)\b/i },
  { id: "sprout", words: /\b(sprout|plant|leaf|plante|flower|pot|pousse)\b/i },
  { id: "tin", words: /\b(tin|can|soda|canette|drink)\b/i },
  { id: "tome", words: /\b(tome|book|livre|manual|novel)\b/i },
  { id: "ship", words: /\b(ship|rocket|fus[eé]e|space|missile)\b/i },
];

export function matchObjectShapePreset(direction: string): ObjectShapeId {
  const text = direction.trim();
  for (const hint of HINTS) {
    if (hint.words.test(text)) return hint.id;
  }
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) sum = (sum + text.charCodeAt(i) * (i + 1)) % 997;
  return OBJECT_SHAPE_IDS[sum % OBJECT_SHAPE_IDS.length]!;
}

export function generateShapeAvatarDef(direction: string): ShapeAvatarDef {
  const bounded = direction.trim().slice(0, SHAPE_AVATAR_DIRECTION_MAX);
  const id = matchObjectShapePreset(bounded || "friendly shape");
  const preset = OBJECT_SHAPE_BY_ID[id];
  const name = bounded ? bounded.replace(/\s+/g, " ").slice(0, 60) : preset.name ?? id;
  const def: ShapeAvatarDef = {
    ...preset,
    id,
    name,
    schemaVersion: SHAPE_AVATAR_SCHEMA_VERSION,
    eyes: preset.eyes ?? defaultPillEyes(),
  };
  const checked = validateShapeAvatarDef(def);
  if (!checked.ok) throw new Error(`generated definition failed validation: ${checked.error}`);
  return checked.def;
}

/** Design prompt: model returns one ShapeAvatarDef JSON object, geometry only. */
export function shapeAvatarGenerationPrompt(direction: string): string {
  const bounded = direction.trim().slice(0, SHAPE_AVATAR_DIRECTION_MAX);
  return [
    SHAPE_AVATAR_PROMPT_MARKER,
    "Return one JSON object for a Sagax Shape mascot silhouette. Geometry only.",
    "Schema version 1. Box is 0..100. Body is a closed SVG path (M…Z) or parts of ellipse/circle/rect/path.",
    "Include eyes: { anchor:[x,y], size:{w,h}, shape:\"pill\", gap }. Optional id (lowercase slug, not a GUID) and name.",
    `Path at most ${SHAPE_AVATAR_LIMITS.pathChars} chars and ${SHAPE_AVATAR_LIMITS.pathCommands} commands.`,
    "No colour, fill, palette, script, href, or onClick. No text in the silhouette.",
    "Prefer one clear object with appendages that read at 28 to 96 px (handle, base, tail, fins, grips).",
    "Answer with one JSON object and nothing else.",
    `Visual direction: ${JSON.stringify(bounded || "a friendly clay object")}`,
  ].join("\n");
}

/** Pull JSON from a model answer (fenced or bare). */
export function parseShapeAvatarModelText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const starts = ["{"].map((c) => candidate.indexOf(c)).filter((i) => i >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const end = candidate.lastIndexOf("}");
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type ShapeTextEngine = {
  generateText: (prompt: string, options?: { signal?: AbortSignal; noThinking?: boolean }) => Promise<string>;
};

/**
 * Ask the model for a definition; validate; retry once on invalid; fall back
 * to the preset mapping when the engine is missing or keeps failing.
 */
export async function generateShapeAvatarDefWithModel(
  direction: string,
  engine: ShapeTextEngine | null | undefined,
  options?: { signal?: AbortSignal },
): Promise<{ def: ShapeAvatarDef; source: "model" | "fallback" }> {
  const bounded = direction.trim().slice(0, SHAPE_AVATAR_DIRECTION_MAX);
  if (!engine?.generateText) {
    return { def: generateShapeAvatarDef(bounded || "friendly shape"), source: "fallback" };
  }
  const prompt = shapeAvatarGenerationPrompt(bounded || "friendly shape");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const text = await engine.generateText(prompt, { signal: options?.signal, noThinking: true });
      const parsed = parseShapeAvatarModelText(text);
      const checked = validateShapeAvatarDef(parsed);
      if (checked.ok) return { def: checked.def, source: "model" };
    } catch {
      // retry or fall back
    }
  }
  return { def: generateShapeAvatarDef(bounded || "friendly shape"), source: "fallback" };
}

export function lookWithShapeAvatarDef(look: unknown, def: ShapeAvatarDef): MascotLook {
  const base = botMascotLook(look);
  const shapeId = def.id && (OBJECT_SHAPE_IDS as readonly string[]).includes(def.id)
    ? (def.id as MascotLook["shape"])
    : base.shape ?? "circle";
  return botMascotLook({
    ...base,
    character: "shape",
    shape: shapeId,
    avatarDef: def,
  });
}

export function describeShapeAvatarDef(def: ShapeAvatarDef): string {
  const compiled = compileShapeAvatar(def);
  const body =
    def.body.kind === "radii"
      ? `radii(${def.body.radii.length})`
      : def.body.kind === "path"
        ? "path"
        : `parts(${def.body.parts.length})`;
  return [
    `id=${def.id ?? "(custom)"}`,
    `name=${JSON.stringify(def.name ?? "")}`,
    `body=${body}`,
    `eyes=${compiled.eye.shape}@${compiled.face.join(",")}`,
    `accessories=${compiled.accessories.length}`,
  ].join(" ");
}

export type GenerateShapeAvatarArgs = {
  direction?: string;
  apply?: boolean;
  definition?: unknown;
};

export type GenerateShapeAvatarResult =
  | { ok: true; def: ShapeAvatarDef; applied: boolean; look?: MascotLook; summary: string }
  | { ok: false; error: string };

export function runGenerateShapeAvatar(args: GenerateShapeAvatarArgs, currentLook: unknown): GenerateShapeAvatarResult {
  let def: ShapeAvatarDef;
  if (args.definition !== undefined) {
    const checked = validateShapeAvatarDef(args.definition);
    if (!checked.ok) return { ok: false, error: checked.error };
    def = checked.def;
  } else {
    const direction = (args.direction ?? "").trim();
    if (!direction) return { ok: false, error: "direction or definition is required" };
    def = generateShapeAvatarDef(direction);
  }
  const apply = args.apply !== false;
  if (!apply) return { ok: true, def, applied: false, summary: describeShapeAvatarDef(def) };
  const look = lookWithShapeAvatarDef(currentLook, def);
  return { ok: true, def, applied: true, look, summary: describeShapeAvatarDef(def) };
}

export async function runGenerateShapeAvatarAsync(
  args: GenerateShapeAvatarArgs,
  currentLook: unknown,
  engine?: ShapeTextEngine | null,
  options?: { signal?: AbortSignal },
): Promise<GenerateShapeAvatarResult & { source?: "model" | "fallback" | "definition" }> {
  if (args.definition !== undefined) {
    const result = runGenerateShapeAvatar(args, currentLook);
    return result.ok ? { ...result, source: "definition" } : result;
  }
  const direction = (args.direction ?? "").trim();
  if (!direction) return { ok: false, error: "direction or definition is required" };
  const generated = await generateShapeAvatarDefWithModel(direction, engine, options);
  const apply = args.apply !== false;
  if (!apply) {
    return { ok: true, def: generated.def, applied: false, summary: describeShapeAvatarDef(generated.def), source: generated.source };
  }
  const look = lookWithShapeAvatarDef(currentLook, generated.def);
  return {
    ok: true,
    def: generated.def,
    applied: true,
    look,
    summary: describeShapeAvatarDef(generated.def),
    source: generated.source,
  };
}
