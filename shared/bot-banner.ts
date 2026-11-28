// The bot page's top banner: default wash, a ready-made preset, or the
// owner's own image, plus optional effects. Stored on the bot so everyone
// who sees the bot sees the same banner (M-20261127-183).
import { z } from "zod";

import {
  AVATAR_FOCUS_CENTER,
  AVATAR_ZOOM_MAX,
  AVATAR_ZOOM_MIN,
  botAvatarUrlSchema,
  clampAvatarFocus,
  clampAvatarZoom,
} from "./bot-avatar.ts";

/** Ready-made backgrounds. `default` is the soft mascot-colour wash. */
export const BOT_BANNER_PRESETS = [
  "default",
  "mascot",
  "mascot-deep",
  "dots",
  "grid",
  "waves",
] as const;
export const botBannerPresetSchema = z.enum(BOT_BANNER_PRESETS);
export type BotBannerPreset = z.infer<typeof botBannerPresetSchema>;

export const BOT_BANNER_EFFECTS = [
  "blur",
  "darken",
  "grain",
  "animatedGradient",
  "parallax",
] as const;
export type BotBannerEffect = (typeof BOT_BANNER_EFFECTS)[number];

export const botBannerEffectsSchema = z.object({
  blur: z.boolean().optional(),
  darken: z.boolean().optional(),
  grain: z.boolean().optional(),
  animatedGradient: z.boolean().optional(),
  parallax: z.boolean().optional(),
});
export type BotBannerEffects = z.infer<typeof botBannerEffectsSchema>;

/** Same attachment rule as the avatar: app-owned PNG/JPEG/GIF/WebP only. */
export const botBannerUrlSchema = botAvatarUrlSchema;

export const BANNER_ZOOM_MIN = AVATAR_ZOOM_MIN;
export const BANNER_ZOOM_MAX = AVATAR_ZOOM_MAX;
export const BANNER_FOCUS_CENTER = AVATAR_FOCUS_CENTER;

export const clampBannerZoom = clampAvatarZoom;
export const clampBannerFocus = clampAvatarFocus;

/** Fields a profile PATCH may write for the banner. */
export const BOT_BANNER_PATCH_FIELDS = [
  "bannerUrl",
  "bannerPreset",
  "bannerZoom",
  "bannerFocusX",
  "bannerFocusY",
  "bannerEffects",
] as const;

export type BotBannerFields = {
  bannerUrl?: string | null;
  bannerPreset?: BotBannerPreset | null;
  bannerZoom?: number;
  bannerFocusX?: number;
  bannerFocusY?: number;
  bannerEffects?: BotBannerEffects | null;
};

/** Runtime-safe view of the banner for drawing. */
export type BotBannerProfile = {
  url?: string;
  preset: BotBannerPreset;
  zoom: number;
  focusX: number;
  focusY: number;
  effects: BotBannerEffects;
};

export function emptyBannerEffects(): BotBannerEffects {
  return {};
}

export function normalizeBannerEffects(value: unknown): BotBannerEffects {
  const parsed = botBannerEffectsSchema.safeParse(value);
  if (!parsed.success) return emptyBannerEffects();
  const next: BotBannerEffects = {};
  for (const key of BOT_BANNER_EFFECTS) {
    if (parsed.data[key] === true) next[key] = true;
  }
  return next;
}

export function bannerEffectsActive(effects: BotBannerEffects): boolean {
  return BOT_BANNER_EFFECTS.some((key) => effects[key] === true);
}

/** True when every banner field is at its default (nothing stored). */
export function isDefaultBanner(fields: BotBannerFields): boolean {
  if (fields.bannerUrl) return false;
  if (fields.bannerPreset && fields.bannerPreset !== "default") return false;
  if (fields.bannerZoom !== undefined && clampBannerZoom(fields.bannerZoom) !== BANNER_ZOOM_MIN) return false;
  if (fields.bannerFocusX !== undefined && clampBannerFocus(fields.bannerFocusX) !== BANNER_FOCUS_CENTER) return false;
  if (fields.bannerFocusY !== undefined && clampBannerFocus(fields.bannerFocusY) !== BANNER_FOCUS_CENTER) return false;
  if (fields.bannerEffects && bannerEffectsActive(normalizeBannerEffects(fields.bannerEffects))) return false;
  return true;
}

/** Patch that clears every banner field back to the default wash. */
export function defaultBannerPatch(): Required<Pick<BotBannerFields, "bannerUrl" | "bannerPreset" | "bannerZoom" | "bannerFocusX" | "bannerFocusY" | "bannerEffects">> {
  return {
    bannerUrl: null,
    bannerPreset: null,
    bannerZoom: BANNER_ZOOM_MIN,
    bannerFocusX: BANNER_FOCUS_CENTER,
    bannerFocusY: BANNER_FOCUS_CENTER,
    bannerEffects: null,
  };
}

export function botBannerProfile(value: BotBannerFields): BotBannerProfile {
  const url = botBannerUrlSchema.safeParse(value.bannerUrl);
  const preset = botBannerPresetSchema.safeParse(value.bannerPreset).data ?? "default";
  return {
    ...(url.success ? { url: url.data } : {}),
    preset: url.success ? "default" : preset,
    zoom: clampBannerZoom(value.bannerZoom ?? BANNER_ZOOM_MIN),
    focusX: clampBannerFocus(value.bannerFocusX ?? BANNER_FOCUS_CENTER),
    focusY: clampBannerFocus(value.bannerFocusY ?? BANNER_FOCUS_CENTER),
    effects: normalizeBannerEffects(value.bannerEffects),
  };
}

/** Zod fields merged into the profile patch schema. */
export const botBannerPatchShape = {
  bannerUrl: z
    .union([botBannerUrlSchema, z.literal(""), z.null()], {
      error: "bannerUrl must be a stored PNG, JPEG, GIF, or WebP attachment",
    })
    .optional(),
  bannerPreset: z
    .union([botBannerPresetSchema, z.null()], {
      error: "bannerPreset must be a known ready-made background",
    })
    .optional(),
  bannerZoom: z
    .number({ error: "bannerZoom must be a number from 1 to 3" })
    .finite()
    .min(BANNER_ZOOM_MIN)
    .max(BANNER_ZOOM_MAX)
    .optional(),
  bannerFocusX: z
    .number({ error: "bannerFocusX must be a number from 0 to 1" })
    .finite()
    .min(0)
    .max(1)
    .optional(),
  bannerFocusY: z
    .number({ error: "bannerFocusY must be a number from 0 to 1" })
    .finite()
    .min(0)
    .max(1)
    .optional(),
  bannerEffects: z
    .union([botBannerEffectsSchema, z.null()], {
      error: "bannerEffects must be an effects object",
    })
    .optional(),
} as const;
