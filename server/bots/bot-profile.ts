import { z } from "zod";

import {
  AVATAR_ZOOM_MAX,
  AVATAR_ZOOM_MIN,
  BOT_AVATAR_CROPS,
  botAvatarCropSchema,
  botAvatarUrlSchema,
} from "../../shared/bot-avatar.ts";
import { BOT_PROFILE_LIMITS, fitsOnOneLine } from "../../shared/bot-profile.ts";
import { MASCOT_BODY_IDS, mascotBodySchema } from "../../shared/mascot-bodies.ts";
import { MASCOT_SKIN_IDS, mascotSkinSchema } from "../../shared/mascot-skins.ts";
import { MASCOT_CHARACTERS, mascotLookSchema } from "../../shared/mascot-look.ts";
import { VOICE_MODE_MAX_SPEED, VOICE_MODE_MIN_SPEED, isVoiceModeLanguage } from "../../shared/voice-mode.ts";
import type { WireBot } from "../../shared/wire.ts";

import { FINISH_UNTIL_MAX, finishUntilText } from "../finish-until.ts";
import { FINISH_UNTIL_MAX_ROUNDS } from "../../shared/finish-until-line.ts";

// Shared with the package format, which checks the same rule on names it
// carries; re-exported under its historical path.
export { fitsOnOneLine } from "../../shared/bot-profile.ts";

export const BOT_PROFILE_PATCH_FIELDS = [
  "name",
  "title",
  "description",
  "soul",
  "notifications",
  "avatarUrl",
  "avatarCrop",
  "avatarZoom",
  "avatarFocusX",
  "avatarFocusY",
  "mascotBody",
  "mascotSkin",
  "mascotLook",
  "voice",
  "voiceSpeed",
  "voiceLanguage",
  "speakReplies",
  "finishUntil",
  "finishUntilMaxRounds",
] as const;

export const profilePatchSchema = z.object({
  name: z
    .string({ error: "name must be a string" })
    .max(BOT_PROFILE_LIMITS.name, { error: "name must be at most 100 characters" })
    .refine((value) => Boolean(value.trim()), { error: "name must not be empty" })
    .refine(fitsOnOneLine, { error: "name must fit on one line" })
    .optional(),
  title: z
    .string({ error: "title must be a string" })
    .max(BOT_PROFILE_LIMITS.title, { error: "title must be at most 200 characters" })
    .refine(fitsOnOneLine, { error: "title must fit on one line" })
    .optional(),
  description: z
    .string({ error: "description must be a string" })
    .max(BOT_PROFILE_LIMITS.description, { error: "description must be at most 4000 characters" })
    .optional(),
  soul: z
    .string({ error: "soul must be a string" })
    .refine((value) => Buffer.byteLength(value, "utf8") <= BOT_PROFILE_LIMITS.soul, {
      error: "standing instructions must be at most 24000 bytes",
    })
    .optional(),
  notifications: z.boolean({ error: "notifications must be true or false" }).optional(),
  avatarUrl: z
    .union([botAvatarUrlSchema, z.literal(""), z.null()], {
      error: "avatarUrl must be a stored PNG, JPEG, GIF, or WebP attachment",
    })
    .optional(),
  avatarCrop: botAvatarCropSchema.optional(),
  avatarZoom: z.number({ error: "avatarZoom must be a number from 1 to 3" }).finite().min(AVATAR_ZOOM_MIN).max(AVATAR_ZOOM_MAX).optional(),
  avatarFocusX: z.number({ error: "avatarFocusX must be a number from 0 to 1" }).finite().min(0).max(1).optional(),
  avatarFocusY: z.number({ error: "avatarFocusY must be a number from 0 to 1" }).finite().min(0).max(1).optional(),
  mascotBody: mascotBodySchema.optional(),
  mascotSkin: mascotSkinSchema.optional(),
  mascotLook: mascotLookSchema.optional(),
  voice: z
    .string({ error: "voice must be a string" })
    .max(BOT_PROFILE_LIMITS.voice, { error: "voice must be at most 200 characters" })
    .optional(),
  // #2125: the bot's voice chat speed and language, applied to its spoken replies.
  voiceSpeed: z
    .number({ error: `voiceSpeed must be a number from ${VOICE_MODE_MIN_SPEED} to ${VOICE_MODE_MAX_SPEED}` })
    .finite()
    .min(VOICE_MODE_MIN_SPEED)
    .max(VOICE_MODE_MAX_SPEED)
    .optional(),
  voiceLanguage: z
    .string({ error: "voiceLanguage must be a language code or auto" })
    .refine(isVoiceModeLanguage, { error: "voiceLanguage must be a language code or auto" })
    .optional(),
  speakReplies: z.boolean({ error: "speakReplies must be true or false" }).optional(),
  finishUntil: z.union([
    z.string({ error: "finishUntil must be one sentence" })
      .max(FINISH_UNTIL_MAX, { error: `finishUntil must be at most ${FINISH_UNTIL_MAX} characters` })
      .refine((value) => !/[\r\n]/.test(value), { error: "finishUntil is one sentence, not a list" }),
    z.literal(""),
    z.null(),
  ]).optional(),
  finishUntilMaxRounds: z.union([
    z.number({ error: `finishUntilMaxRounds must be a whole number from 1 to ${FINISH_UNTIL_MAX_ROUNDS}` })
      .int({ error: `finishUntilMaxRounds must be a whole number from 1 to ${FINISH_UNTIL_MAX_ROUNDS}` })
      .min(1, { error: `finishUntilMaxRounds must be a whole number from 1 to ${FINISH_UNTIL_MAX_ROUNDS}` })
      .max(FINISH_UNTIL_MAX_ROUNDS, { error: `finishUntilMaxRounds must be a whole number from 1 to ${FINISH_UNTIL_MAX_ROUNDS}` }),
    z.null(),
  ]).optional(),
});

export type BotProfilePatchInput = z.input<typeof profilePatchSchema>;

// WireBot, not BotRecord: the record type lives in store.ts, and that import
// cycled through config and new-bot-defaults. avatarUrl is optional on the
// record (absent clears); on the wire it is always string | null.
export type BotProfilePatch = Partial<
  Omit<
    Pick<
      WireBot,
      | "name"
      | "title"
      | "description"
      | "soul"
      | "notifications"
      | "avatarUrl"
      | "avatarCrop"
      | "avatarZoom"
      | "avatarFocusX"
      | "avatarFocusY"
      | "mascotBody"
      | "mascotSkin"
      | "mascotLook"
      | "voice"
      | "voiceSpeed"
      | "voiceLanguage"
      | "speakReplies"
      | "finishUntil"
      | "finishUntilMaxRounds"
    >,
    "avatarUrl"
  > & { avatarUrl?: string }
>;

export type BotProfilePatchResult =
  | { ok: true; patch: BotProfilePatch }
  | { ok: false; error: string };

/**
 * The shared validation boundary for profile fields. The desktop's broad bot
 * PATCH passes strict=false; paired clients use strict=true so a future bot
 * field cannot silently become remotely writable.
 *
 * avatarUrl deliberately uses `undefined` as the normalized clear value.
 * Store persistence already omits undefined fields, while wireBot sends null
 * back to clients so Codable and object-spread clients both clear stale data.
 */
export function parseBotProfilePatch(input: BotProfilePatchInput, strict = false): BotProfilePatchResult {
  const parsed = (strict ? profilePatchSchema.strict() : profilePatchSchema).safeParse(input);
  if (!parsed.success) {
    const unsupported = parsed.error.issues.find((issue) => issue.code === "unrecognized_keys");
    if (unsupported?.code === "unrecognized_keys") {
      return { ok: false, error: `unsupported profile field: ${unsupported.keys[0] ?? "unknown"}` };
    }
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "avatarCrop") {
      const options = `${BOT_AVATAR_CROPS.slice(0, -1).join(", ")}, or ${BOT_AVATAR_CROPS.at(-1)}`;
      return { ok: false, error: `avatarCrop must be ${options}` };
    }
    if (issue?.path[0] === "mascotBody") {
      const options = `${MASCOT_BODY_IDS.slice(0, -1).join(", ")}, or ${MASCOT_BODY_IDS.at(-1)}`;
      return { ok: false, error: `mascotBody must be ${options}` };
    }
    if (issue?.path[0] === "mascotLook") {
      const names = MASCOT_CHARACTERS;
      const options = names.length <= 1 ? names[0] : `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
      return { ok: false, error: `mascotLook must be { character: ${options}, style, shape, skins }` };
    }
    if (issue?.path[0] === "mascotSkin") {
      const options = `${MASCOT_SKIN_IDS.slice(0, -1).join(", ")}, or ${MASCOT_SKIN_IDS.at(-1)}`;
      return { ok: false, error: `mascotSkin must be ${options}` };
    }
    return { ok: false, error: issue?.message ?? "invalid profile patch" };
  }

  const { avatarUrl, finishUntil, finishUntilMaxRounds, ...fields } = parsed.data;
  const patch: BotProfilePatch = fields;
  // null clears the bound back to the default (absent on the record).
  if (finishUntilMaxRounds !== undefined) patch.finishUntilMaxRounds = finishUntilMaxRounds ?? undefined;
  if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl || undefined;
  if (finishUntil !== undefined) {
    const text = finishUntilText(finishUntil);
    patch.finishUntil = text || undefined;
  }
  return { ok: true, patch };
}
