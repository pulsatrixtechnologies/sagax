// CSS variables and layers for a bot profile banner: the default wash,
// ready-made presets, a custom image with focus/zoom, and effects.
import type { CSSProperties } from "react";

import {
  type BotBannerEffects,
  type BotBannerPreset,
  type BotBannerProfile,
  bannerEffectsActive,
} from "../../shared/bot-banner";
import { profileBannerColors } from "./profile-banner";

export type BannerDrawInput = {
  profile: BotBannerProfile;
  /** Soft wash colours from the mascot accent (profile-banner.ts). */
  wash: { from: string; to: string };
  /** Scroll offset of the page, for parallax (px). */
  scrollY?: number;
  /** System or in-app reduce-motion. */
  reduceMotion?: boolean;
};

/** Stronger / patterned washes for ready-made presets. */
export function presetWash(preset: BotBannerPreset, wash: { from: string; to: string }): { from: string; to: string } {
  if (preset === "mascot") {
    return profileBannerColors(wash.from, null);
  }
  if (preset === "mascot-deep") {
    return { from: wash.from, to: wash.to };
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
  const { profile, wash, scrollY = 0, reduceMotion = false } = input;
  const colours = presetWash(profile.preset, wash);
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
