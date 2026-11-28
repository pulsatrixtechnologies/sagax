import { describe, expect, it } from "vitest";

import {
  botBannerProfile,
  defaultBannerPatch,
  isDefaultBanner,
  normalizeBannerEffects,
  bannerEffectsActive,
} from "./bot-banner.ts";

describe("bot banner profile", () => {
  it("defaults to the wash with no image", () => {
    expect(botBannerProfile({})).toEqual({
      preset: "default",
      zoom: 1,
      focusX: 0.5,
      focusY: 0.5,
      effects: {},
    });
  });

  it("keeps a stored image and ignores the preset while it is set", () => {
    const profile = botBannerProfile({
      bannerUrl: "/api/attachments/banner.webp",
      bannerPreset: "waves",
      bannerZoom: 1.5,
      bannerFocusX: 0.2,
      bannerFocusY: 0.8,
      bannerEffects: { blur: true, grain: false },
    });
    expect(profile.url).toBe("/api/attachments/banner.webp");
    expect(profile.preset).toBe("default");
    expect(profile.zoom).toBe(1.5);
    expect(profile.focusX).toBe(0.2);
    expect(profile.focusY).toBe(0.8);
    expect(profile.effects).toEqual({ blur: true });
  });

  it("rejects an external image URL", () => {
    expect(botBannerProfile({ bannerUrl: "https://evil.test/x.png" }).url).toBeUndefined();
  });

  it("clears every field in the default patch", () => {
    expect(isDefaultBanner(defaultBannerPatch())).toBe(true);
    expect(bannerEffectsActive(normalizeBannerEffects({ blur: true, darken: true }))).toBe(true);
    expect(bannerEffectsActive(normalizeBannerEffects({}))).toBe(false);
  });
});
