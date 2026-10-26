// Settings > Appearance > Mascots > "HD mascots": shown while a character has
// HD art, on by default, and a click turns it off (and back on) live.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { hdMascotsEnabled, setHdMascotsEnabled } from "@/lib/hd-mascots-preference";
import { HdMascotsGroup } from "./AppearanceSettings";

afterEach(() => setHdMascotsEnabled(true));

describe("HD mascots setting", () => {
  it("shows a switch, on by default", () => {
    const html = renderToStaticMarkup(createElement(HdMascotsGroup));
    expect(html).toContain('data-settings-card="appearance.mascots-hd"');
    expect(html).toContain("HD mascots");
    expect(html).toMatch(/aria-checked="true"/);
  });

  it("reads off once turned off", () => {
    setHdMascotsEnabled(false);
    expect(hdMascotsEnabled()).toBe(false);
    expect(renderToStaticMarkup(createElement(HdMascotsGroup))).toMatch(/aria-checked="false"/);
  });

  it("is hidden while no character has HD art", () => {
    expect(renderToStaticMarkup(createElement(HdMascotsGroup, { characters: [] }))).toBe("");
  });
});
