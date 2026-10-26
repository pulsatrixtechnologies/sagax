import { describe, expect, it } from "vitest";
import { SKIN_IDS } from "../src/lib/skins.ts";
import { FONT_IDS } from "../src/lib/fonts.ts";
import { SKIN_TEXTURES, SKIN_TINT_IDS } from "../src/lib/skin-families.ts";
import { APPEARANCE_FONT_IDS, APPEARANCE_SKIN_IDS, APPEARANCE_TEXTURE_IDS, APPEARANCE_TINT_IDS, DESKTOP_APPEARANCE_KEYS, cleanDesktopAppearance, sameAppearance } from "./desktop-appearance.ts";
import { USER_PREFERENCE_KEYS } from "./user-preferences.ts";

describe("desktop appearance keys", () => {
  it("lists the renderer's skins and fonts, and travels as user preferences do", () => {
    expect([...APPEARANCE_SKIN_IDS]).toEqual([...SKIN_IDS]);
    expect([...APPEARANCE_TINT_IDS]).toEqual([...SKIN_TINT_IDS]);
    expect([...APPEARANCE_TEXTURE_IDS]).toEqual(SKIN_TEXTURES.filter((texture) => texture !== "none"));
    expect([...APPEARANCE_FONT_IDS]).toEqual([...FONT_IDS]);
    for (const key of DESKTOP_APPEARANCE_KEYS) expect(USER_PREFERENCE_KEYS).toContain(key);
  });

  it("keeps valid values of the four keys only", () => {
    expect(cleanDesktopAppearance({
      "omb-skin": "lagoon", "omb-font": "serif", "omb.retro98.on": "1", "omb.retro98.unlocked": "1",
      "omb-language": "fr", "omb-drafts": "{}",
    })).toEqual({ "omb-skin": "lagoon", "omb-font": "serif", "omb.retro98.on": "1", "omb.retro98.unlocked": "1" });
    expect(cleanDesktopAppearance({ "omb-skin": "black", "omb-font": "comic", "omb.retro98.on": "yes", "omb.retro98.unlocked": 1 })).toEqual({});
    expect(cleanDesktopAppearance(["omb-skin"])).toEqual({});
    expect(cleanDesktopAppearance(null)).toEqual({});
    expect(sameAppearance({ "omb-skin": "dusk" }, { "omb-skin": "dusk" })).toBe(true);
    expect(sameAppearance({ "omb-skin": "dusk" }, {})).toBe(false);
  });

  it("carries the colour or Windows edition laid over the skin, and drops an unknown one", () => {
    expect(cleanDesktopAppearance({ "omb-skin": "midnight", "omb-skin-tint": "red" })).toEqual({ "omb-skin": "midnight", "omb-skin-tint": "red" });
    expect(cleanDesktopAppearance({ "omb-skin": "retro98", "omb-skin-tint": "win11" })).toEqual({ "omb-skin": "retro98", "omb-skin-tint": "win11" });
    expect(cleanDesktopAppearance({ "omb-skin": "midnight", "omb-skin-tint": "purple" })).toEqual({ "omb-skin": "midnight" });
    expect(cleanDesktopAppearance({ "omb-skin": "midnight", "omb-skin-tint": "aurore", "omb-skin-depth": "full", "omb-skin-texture": "grain" })).toEqual({
      "omb-skin": "midnight",
      "omb-skin-tint": "aurore",
      "omb-skin-depth": "full",
      "omb-skin-texture": "grain",
    });
    expect(cleanDesktopAppearance({ "omb-skin": "midnight", "omb-skin-depth": "accent", "omb-skin-texture": "none" })).toEqual({ "omb-skin": "midnight" });
  });
});
