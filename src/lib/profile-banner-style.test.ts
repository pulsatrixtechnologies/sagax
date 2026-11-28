import { describe, expect, it } from "vitest";

import { botBannerProfile } from "../../shared/bot-banner";
import { bannerLayerStyle, bannerNeedsVeil } from "./profile-banner-style";

describe("profile banner style", () => {
  const wash = { from: "#c6c9ce", to: "#dcdee1" };

  it("draws the default wash without a veil", () => {
    const profile = botBannerProfile({});
    expect(bannerNeedsVeil(profile)).toBe(false);
    const layers = bannerLayerStyle({ profile, wash });
    expect(layers.showImage).toBe(false);
    expect(layers.veil).toBe(false);
    expect(layers.root).toMatchObject({
      "--bot-profile-banner-from": "#c6c9ce",
      "--bot-profile-banner-to": "#dcdee1",
    });
  });

  it("veils a custom image and applies blur and parallax", () => {
    const profile = botBannerProfile({
      bannerUrl: "/api/attachments/cover.webp",
      bannerEffects: { blur: true, parallax: true, darken: true },
    });
    expect(bannerNeedsVeil(profile)).toBe(true);
    const layers = bannerLayerStyle({ profile, wash, scrollY: 40, reduceMotion: false });
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
    const layers = bannerLayerStyle({ profile, wash, scrollY: 80, reduceMotion: true });
    expect(layers.parallaxY).toBe(0);
  });
});
