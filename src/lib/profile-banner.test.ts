import { describe, expect, it } from "vitest";
import { contrast } from "./bot-accent-colors";
import { BANNER_MIN_CONTRAST, BANNER_TARGET_CONTRAST, profileBannerColors } from "./profile-banner";
import { mascotDominantColor } from "./mascot-dominant";
import { MAUS_COLORS } from "./mascot";
import { MASCOT_CHARACTERS } from "../../shared/mascot-look";

const hueOf = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};

describe("profile banner kept apart from the mascot", () => {
  it("leaves the wash alone when the mascot already reads", () => {
    const plain = profileBannerColors("#D94B52", null);
    expect(profileBannerColors("#D94B52", "#1b1f27")).toEqual(plain);
  });

  it("darkens the band for a white mascot on a light accent, keeping the hue", () => {
    const plain = profileBannerColors("#F6B897", null);
    expect(contrast(plain.to, "#ffffff")).toBeLessThan(BANNER_MIN_CONTRAST);
    const moved = profileBannerColors("#F6B897", "#ffffff");
    expect(contrast(moved.to, "#ffffff")).toBeGreaterThanOrEqual(BANNER_TARGET_CONTRAST);
    expect(Math.abs(hueOf(moved.to) - hueOf(plain.to))).toBeLessThan(6);
    expect(moved.from).not.toBe(plain.from);
  });

  it("moves a band that has the mascot's own colour", () => {
    for (const name of ["red", "green", "blue", "amber", "pink", "lavender", "blush", "mint"] as const) {
      const hex = MAUS_COLORS[name];
      const moved = profileBannerColors(hex, hex);
      expect(contrast(moved.to, hex), name).toBeGreaterThanOrEqual(BANNER_MIN_CONTRAST);
    }
  });

  it("lightens the band for a dark mascot on a dark accent", () => {
    const plain = profileBannerColors("#1B2448", null);
    const moved = profileBannerColors("#1B2448", "#1B2448");
    expect(contrast(moved.to, "#1B2448")).toBeGreaterThanOrEqual(BANNER_MIN_CONTRAST);
    expect(moved.to.length).toBe(7);
    expect(plain.to).toBeTruthy();
  });

  it("reads clearly for every bot colour with the mascot in that colour", () => {
    for (const [name, hex] of Object.entries(MAUS_COLORS)) {
      const moved = profileBannerColors(hex, hex);
      expect(contrast(moved.to, hex), name).toBeGreaterThanOrEqual(BANNER_MIN_CONTRAST);
    }
  });
});

describe("the mascot's dominant colour", () => {
  it("is a plain colour for every character and skin", () => {
    for (const character of MASCOT_CHARACTERS) {
      expect(mascotDominantColor({ color: "orange", mascotLook: { character } })).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("follows the skin, not only the bot colour", () => {
    expect(mascotDominantColor({ color: "blue", mascotLook: { character: "shiba", skins: { shiba: "white" } } }).toLowerCase()).toBe("#f4eee4");
    expect(mascotDominantColor({ color: "blue", mascotLook: { character: "shape", shape: "circle" } }).toLowerCase()).toBe(MAUS_COLORS.blue.toLowerCase());
  });
});
