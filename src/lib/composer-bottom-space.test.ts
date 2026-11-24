import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS } from "../../shared/settings-actions";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import { chatComposerShellClass } from "./chat-bubble-width";
import {
  COMPOSER_BOTTOM_SPACE_DEFAULT_PX,
  COMPOSER_BOTTOM_SPACE_KEY,
  COMPOSER_BOTTOM_SPACES,
  composerBottomSpaceChoice,
  composerBottomSpacePx,
  composerBottomSpaceStyle,
  parseComposerBottomSpace,
  setComposerBottomSpace,
} from "./composer-bottom-space";

describe("space under the composer (#5238)", () => {
  afterEach(() => {
    setComposerBottomSpace("standard");
    try {
      globalThis.localStorage?.removeItem(COMPOSER_BOTTOM_SPACE_KEY);
    } catch {
      // jsdom without storage
    }
  });

  it("is one of the person's synced appearance keys, and a setting a bot can change", () => {
    expect(USER_PREFERENCE_KEYS).toContain(COMPOSER_BOTTOM_SPACE_KEY);
    const spec = SETTINGS.find((setting) => setting.key === "appearance.composerBottomSpace");
    expect(spec?.value).toBe("enum:small|standard|large");
    expect(spec?.where).toContain("Conversation");
  });

  it("defaults to today's 48px and persists the three choices", () => {
    expect(COMPOSER_BOTTOM_SPACES).toEqual(["small", "standard", "large"]);
    expect(composerBottomSpaceChoice.get()).toBe("standard");
    expect(composerBottomSpacePx("standard")).toBe(48);
    expect(COMPOSER_BOTTOM_SPACE_DEFAULT_PX).toBe(48);
    expect(parseComposerBottomSpace(null)).toBe("standard");
    expect(parseComposerBottomSpace("nope")).toBe("standard");
    setComposerBottomSpace("small");
    expect(composerBottomSpaceChoice.get()).toBe("small");
    setComposerBottomSpace("large");
    expect(composerBottomSpaceChoice.get()).toBe("large");
    setComposerBottomSpace("standard");
    expect(composerBottomSpaceChoice.get()).toBe("standard");
  });

  it("orders the steps and keeps them on the spacing scale of 4", () => {
    const sizes = COMPOSER_BOTTOM_SPACES.map(composerBottomSpacePx);
    expect(sizes).toEqual([16, 48, 80]);
    for (const size of sizes) expect(size % 4).toBe(0);
  });

  it("hands the choice to the dock through the CSS variable its class reads", () => {
    expect(composerBottomSpaceStyle("small")).toEqual({ "--composer-bottom-space": "16px" });
    expect(composerBottomSpaceStyle("standard")).toEqual({ "--composer-bottom-space": "48px" });
    expect(composerBottomSpaceStyle("large")).toEqual({ "--composer-bottom-space": "80px" });
    for (const width of ["reading", "wide", "full"] as const) {
      expect(chatComposerShellClass(width)).toContain("pb-[var(--composer-bottom-space,48px)]");
    }
    const shell = readFileSync(new URL("../components/Composer.tsx-parts/ComposerShell.tsx", import.meta.url), "utf8");
    expect(shell).toMatch(/className=\{composerShellClass\} style=\{composerBottomSpaceStyle\}/);
  });

  it("has its row in Settings > Appearance > Conversation, beside Chat width", () => {
    const page = readFileSync(new URL("../components/settings/AppearanceSettings.tsx", import.meta.url), "utf8");
    expect(page).toContain('rowId="composerBottomSpace"');
    expect(page).toMatch(/<ChatWidthRow \/>\s*<ComposerBottomSpaceRow \/>/);
  });
});
