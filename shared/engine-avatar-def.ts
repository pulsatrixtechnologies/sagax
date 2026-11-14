/**
 * A person's own shape as an open-bot-avatar definition (MIT, see NOTICE;
 * #4160): the engine's JSON (one body path in a 0 0 100 100 box and the eyes),
 * pasted in Appearance > Shape, checked with the engine's own validateAvatar
 * and stored on the bot's look in mascotLook.avatarDef, beside the older
 * portable format (shared/shape-avatar-def.ts) that field already holds.
 */
import { validateAvatar, type AvatarDefinition } from "open-bot-avatar";
import { z } from "zod";

/** The engine's AvatarDefinition as a plain object type (it is stored as JSON with the bot). */
export type EngineAvatarDef = {
  version: 1;
  id: string;
  name: string;
  body: { path: string };
  eyes: { x: number; y: number; spacing: number; scale: number };
};
const asStored = (def: AvatarDefinition): EngineAvatarDef => def;

/** An engine definition, told apart from the older portable format by its `version` (the older one has `schemaVersion`). */
export function isEngineAvatarDef(value: unknown): value is EngineAvatarDef {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "version" in value && !("schemaVersion" in value));
}

/** The schema of a stored engine definition: what validateAvatar accepts, normalized as it returns it. */
export const engineAvatarDefSchema = z.unknown().transform((value, ctx): EngineAvatarDef => {
  const result = validateAvatar(value);
  if (result.ok) return asStored(result.value);
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.errors[0] ?? "invalid open-bot-avatar definition" });
  return z.NEVER;
});

/**
 * Why a pasted definition can't be used, as a few reasons a person can read in
 * their language: the engine's own errors are English developer text (with
 * ranges such as "63..40"), so each one is sorted into one of these.
 */
export const ENGINE_AVATAR_REASONS = ["json", "fields", "path", "outside", "small", "eyesOutside", "eyesSize"] as const;
export type EngineAvatarReason = (typeof ENGINE_AVATAR_REASONS)[number];

/** The reason one engine error (validateAvatar) stands for. */
export function engineAvatarReason(error: string): EngineAvatarReason {
  if (error.startsWith("definition must be a JSON object")) return "json";
  if (error.startsWith("eyes.scale ") || error.startsWith("eyes.spacing ")) return "eyesSize";
  if (error.startsWith("eyes must sit inside")) return "eyesOutside";
  if (error.startsWith("body.path leaves")) return "outside";
  if (error.startsWith("body is too small") || error.startsWith("body fill area")) return "small";
  if (error.startsWith("body.path: ")) return "path";
  return "fields";
}

export type EngineAvatarParse = { ok: true; def: EngineAvatarDef } | { ok: false; reasons: EngineAvatarReason[] };

/** A pasted definition (the JSON text the engine's editor or its prompt gives), checked by the engine. */
export function parseEngineAvatar(text: string): EngineAvatarParse {
  const raw = text.trim();
  if (!raw) return { ok: false, reasons: ["json"] };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reasons: ["json"] };
  }
  const result = validateAvatar(value);
  if (result.ok) return { ok: true, def: asStored(result.value) };
  const found = new Set(result.errors.map(engineAvatarReason));
  return { ok: false, reasons: ENGINE_AVATAR_REASONS.filter((reason) => found.has(reason)) };
}
