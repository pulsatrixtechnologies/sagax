import { describe, expect, it } from "vitest";

import { botBannerProfile } from "../../shared/bot-banner";
import { bannerLayerStyle, bannerNeedsVeil, presetWash } from "./profile-banner-style";

describe("profile banner style", () => {
  const wash = { from: "#c6c9ce", to: "#dcdee1" };
  const accent = "#4a8f5c";

  it("draws the default wash without a veil", () => {
    const profile = botBannerProfile({});
    expect(bannerNeedsVeil(profile)).toBe(false);
    const layers = bannerLayerStyle({ profile, wash, accent });
    expect(layers.showImage).toBe(false);
    expect(layers.veil).toBe(false);
    expect(layers.root).toMatchObject({
      "--bot-profile-banner-from": "#c6c9ce",
      "--bot-profile-banner-to": "#dcdee1",
    });
  });

  it("keeps mascot and mascot-deep distinct from the soft default wash", () => {
    const soft = presetWash("default", wash, accent);
    const mascot = presetWash("mascot", wash, accent);
    const deep = presetWash("mascot-deep", wash, accent);
    expect(mascot).not.toEqual(soft);
    expect(deep).not.toEqual(soft);
    expect(deep).not.toEqual(mascot);
    expect(mascot.from.toLowerCase()).not.toBe(soft.from.toLowerCase());
    expect(deep.from.toLowerCase()).not.toBe(soft.from.toLowerCase());
    const mascotLayers = bannerLayerStyle({
      profile: botBannerProfile({ bannerPreset: "mascot" }),
      wash,
      accent,
    });
    const deepLayers = bannerLayerStyle({
      profile: botBannerProfile({ bannerPreset: "mascot-deep" }),
      wash,
      accent,
    });
    expect(mascotLayers.root["--bot-profile-banner-from" as keyof typeof mascotLayers.root]).toBe(mascot.from);
    expect(deepLayers.root["--bot-profile-banner-from" as keyof typeof deepLayers.root]).toBe(deep.from);
    expect(mascotLayers.veil).toBe(true);
    expect(deepLayers.veil).toBe(true);
  });

  it("veils a custom image and applies blur and parallax", () => {
    const profile = botBannerProfile({
      bannerUrl: "/api/attachments/cover.webp",
      bannerEffects: { blur: true, parallax: true, darken: true },
    });
    expect(bannerNeedsVeil(profile)).toBe(true);
    const layers = bannerLayerStyle({ profile, wash, accent, scrollY: 40, reduceMotion: false });
    expect(layers.showImage).toBe(true);
    expect(layers.veil).toBe(true);
    expect(layers.image?.filter).toContain("blur");
    expect(layers.parallaxY).toBeGreaterThan(0);
  });

  it("stills parallax under reduced motion", () => {
    const profile = botBannerProfile({
      bannerUrl: "/api/attachments/cover.webp",
      bannerEffects: { parallax: true, animatedGradient: true },
    });
    const layers = bannerLayerStyle({ profile, wash, accent, scrollY: 80, reduceMotion: true });
    expect(layers.parallaxY).toBe(0);
  });
});
