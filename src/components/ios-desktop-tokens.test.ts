// The iPad's desktop shell wears this app's own sidebar tokens
// (ios/App/Desktop/DesktopTheme.swift, `extras`): each skin's sidebar colours
// and its chat glow must be the values of its [data-skin] block in
// src/styles.css. 2026-11-03: Pulsatrix had drifted (navy sidebar and a glow
// the desktop dropped), so this pins every skin the two share.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const css = readFileSync(join(root, "src", "styles.css"), "utf8");
const swift = readFileSync(join(root, "ios", "App", "Desktop", "DesktopTheme.swift"), "utf8");

const SKINS: Record<string, string> = {
  pulsatrix: "pulsatrix", pulsatrixLight: "pulsatrix-light", midnight: "midnight", atelier: "atelier",
  foundry: "foundry", lagoon: "lagoon", graphite: "graphite", linen: "linen", dusk: "dusk",
  daylight: "daylight", retro98: "retro98",
};

const FIELDS: Record<string, string> = {
  sidebar: "--color-sidebar", sidebarInk: "--color-sidebar-ink", sidebarInkSecondary: "--color-sidebar-ink-secondary",
  sidebarHover: "--color-sidebar-hover", sidebarSelected: "--color-sidebar-selected", sidebarHairline: "--color-sidebar-hairline",
};

function skinBlock(id: string): string {
  const match = css.match(new RegExp(`\\[data-skin="${id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`no [data-skin="${id}"] block`);
  return match[1]!;
}

function extra(swiftId: string): string {
  const match = swift.match(new RegExp(`\\.${swiftId}: Extra\\(([\\s\\S]*?)face: \\.\\w+\\)`));
  if (!match) throw new Error(`no .${swiftId} Extra`);
  return match[1]!;
}

describe("iPad desktop shell tokens", () => {
  for (const [swiftId, cssId] of Object.entries(SKINS)) {
    it(`${cssId}: sidebar colours and glow match styles.css`, () => {
      const block = skinBlock(cssId);
      const entry = extra(swiftId);
      for (const [field, property] of Object.entries(FIELDS)) {
        const want = block.match(new RegExp(`${property}:\\s*([^;]+);`))?.[1]?.trim().toLowerCase();
        const got = entry.match(new RegExp(`${field}: "([^"]+)"`))?.[1]?.toLowerCase();
        expect(got, `${cssId} ${property}`).toBe(want);
      }
      const glowOff = /--app-glow:\s*none/.test(block);
      expect(/glow: \(/.test(entry), `${cssId} --app-glow`).toBe(!glowOff);
    });
  }
});

const switchCss = readFileSync(join(root, "src", "styles", "skin-switch.css"), "utf8");
const kit = readFileSync(join(root, "ios", "App", "Desktop", "DesktopSettingsKit.swift"), "utf8");

describe("iPad desktop switches", () => {
  for (const cssId of Object.values(SKINS)) {
    it(`${cssId}: the switch tracks match skin-switch.css`, () => {
      const block = switchCss.match(new RegExp(`\\[data-skin="${cssId}"\\]\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
      const on = block.match(/--color-switch-on:\s*(?:var\([^,]+,\s*)?(#[0-9a-f]+)/i)?.[1]?.toLowerCase();
      const off = block.match(/--color-switch-off:\s*(#[0-9a-f]+)/i)?.[1]?.toLowerCase();
      const row = kit.match(new RegExp(`"${cssId}": \\("(#[0-9a-f]+)", "(#[0-9a-f]+)"\\)`, "i"));
      expect([row?.[1], row?.[2]], cssId).toEqual([on, off]);
    });
  }
});
