import { describe, expect, it } from "vitest";
import githubLight from "shiki/themes/github-light-default.mjs";
import githubDark from "shiki/themes/github-dark-default.mjs";

import { contrastRatio } from "../lib/color-contrast";
import { LIGHT_CODE_GROUND, readableLightTheme, readableLightToken } from "./chat-code-highlight";

const HEX6 = /^#[0-9a-f]{6}$/i;

describe("the light code theme (#3035)", () => {
  it("lifts every token colour to 4.5:1 on the darkest light inset", () => {
    const theme = readableLightTheme(githubLight);
    const colors = (theme.tokenColors ?? []).map((rule) => rule.settings?.foreground).filter((c): c is string => Boolean(c && HEX6.test(c)));
    expect(colors.length).toBeGreaterThan(5);
    for (const color of colors) expect(contrastRatio(color, LIGHT_CODE_GROUND)).toBeGreaterThanOrEqual(4.5);
    // Pulsatrix Light's block (#dfe6f2) and the darkest light inset (#d5e8e5)
    for (const ground of ["#dfe6f2", "#d5e8e5", "#ffdbde", "#ffffff"]) {
      for (const color of colors) expect(contrastRatio(color, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the hue and leaves colours that already read", () => {
    // github's keyword red measured 4.0:1 on Pulsatrix Light's block
    expect(contrastRatio("#cf222e", "#dfe6f2")).toBeLessThan(4.5);
    const red = readableLightToken("#cf222e");
    expect(red).not.toBe("#cf222e");
    expect(red).toMatch(/^#[a-f0-9]{2}[0-3][0-9a-f][0-3][0-9a-f]$/); // still a red
    expect(readableLightToken("#0a3069")).toBe("#0a3069");
    expect(readableLightToken("inherit")).toBe("inherit");
  });

  it("keeps the theme's name, so the highlighter still finds it", () => {
    expect(readableLightTheme(githubLight).name).toBe("github-light-default");
    // the dark theme is registered as shipped: its tokens read on dark insets
    expect(githubDark.name).toBe("github-dark-default");
  });
});
