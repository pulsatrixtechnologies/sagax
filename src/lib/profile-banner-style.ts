// CSS variables and layers for a bot profile banner: the default wash,
// ready-made presets, a custom image with focus/zoom, and effects.
import type { CSSProperties } from "react";

import {
  type BotBannerEffects,
  type BotBannerPreset,
  type BotBannerProfile,
  bannerEffectsActive,
} from "../../shared/bot-banner";
import { BANNER_BASE } from "./profile-banner";
import { normalizeHex } from "./bot-accent-colors";

export type BannerDrawInput = {
  profile: BotBannerProfile;
  /** Soft wash colours from the mascot accent (profile-banner.ts). */
  wash: { from: string; to: string };
  /** Raw bot accent (before the soft wash). Drives mascot / mascot-deep. */
  accent?: string;
  /** Scroll offset of the page, for parallax (px). */
  scrollY?: number;
  /** System or in-app reduce-motion. */
  reduceMotion?: boolean;
};

function mixAccent(accent: string, share: number): string {
  const hex = normalizeHex(accent) ?? "#8e949e";
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(BANNER_BASE.slice(1), 16);
  const ch = (n: number, shift: number) => Math.round(((n >> shift) & 255) * share + ((b >> shift) & 255) * (1 - share));
  return `#${[ch(a, 16), ch(a, 8), ch(a, 0)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function shadeAccent(accent: string, factor: number): string {
  const hex = normalizeHex(accent) ?? "#8e949e";
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(Math.min(255, Math.max(0, ((n >> shift) & 255) * factor)));
  return `#${[ch(16), ch(8), ch(0)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Ready-made washes. `default` keeps the soft page wash. `mascot` is a
 * stronger mix of the raw accent; `mascot-deep` darkens that accent. Pattern
 * presets keep the soft wash (the pattern layer sits on top).
 */
export function presetWash(
  preset: BotBannerPreset,
  wash: { from: string; to: string },
  accent?: string,
): { from: string; to: string } {
  const raw = normalizeHex(accent) ?? null;
  if (preset === "mascot" && raw) {
    return { from: mixAccent(raw, 0.82), to: mixAccent(raw, 0.55) };
  }
  if (preset === "mascot-deep" && raw) {
    return { from: shadeAccent(raw, 0.42), to: shadeAccent(raw, 0.62) };
  }
  return wash;
}

export function bannerNeedsVeil(profile: BotBannerProfile): boolean {
  if (profile.url) return true;
  if (profile.preset !== "default") return true;
  if (bannerEffectsActive(profile.effects)) return true;
  return false;
}

export function bannerLayerStyle(input: BannerDrawInput): {
  root: CSSProperties;
  image?: CSSProperties;
  effects: BotBannerEffects;
  showImage: boolean;
  showPattern: boolean;
  pattern: BotBannerPreset;
  veil: boolean;
  parallaxY: number;
} {
  const { profile, wash, accent, scrollY = 0, reduceMotion = false } = input;
  const colours = presetWash(profile.preset, wash, accent);
  const showImage = Boolean(profile.url);
  const showPattern = !showImage && (profile.preset === "dots" || profile.preset === "grid" || profile.preset === "waves");
  const parallax = !reduceMotion && profile.effects.parallax === true;
  const parallaxY = parallax ? Math.round(scrollY * 0.18) : 0;
  const root: CSSProperties = {
    "--bot-profile-banner-from": colours.from,
    "--bot-profile-banner-to": colours.to,
  } as CSSProperties;
  const image: CSSProperties | undefined = showImage && profile.url
    ? {
        backgroundImage: `url(${profile.url})`,
        backgroundSize: `${Math.round(profile.zoom * 100)}%`,
        backgroundPosition: `${profile.focusX * 100}% ${profile.focusY * 100}%`,
        backgroundRepeat: "no-repeat",
        filter: profile.effects.blur ? "blur(6px)" : undefined,
        transform: parallaxY ? `translate3d(0, ${parallaxY}px, 0) scale(1.08)` : profile.effects.blur ? "scale(1.04)" : undefined,
      }
    : undefined;
  return {
    root,
    image,
    effects: profile.effects,
    showImage,
    showPattern,
    pattern: profile.preset,
    veil: bannerNeedsVeil(profile) || profile.effects.darken === true,
    parallaxY,
  };
}
