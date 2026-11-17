// Every built-in plugin, connector and skill the app ships has an icon the
// app ships too (#4503): this fails the day one is added without one.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BUILTIN_PLUGINS } from "../../shared/builtin-plugins";
import { GROK_CLOUD_CONNECTORS } from "../../shared/grok-cloud-connectors";
import { MAC_APP_SETUP_IDS } from "../../shared/mac-apps-setup";
import { BUILTIN_GLYPHS, builtinGlyph } from "./builtin-icons";

const root = join(__dirname, "..", "..");
const catalog = JSON.parse(readFileSync(join(root, "shared", "plugin-catalog.json"), "utf8")) as { plugins: Array<{ id: string }> };
const shippedSkills = readdirSync(join(root, "skills")).filter((name) => statSync(join(root, "skills", name)).isDirectory());

/** every built-in item, by the key its row carries */
const BUILTIN_ITEMS: ReadonlyArray<{ family: string; id: string; row: { key: string; kind?: string; id?: string } }> = [
  ...catalog.plugins.map((plugin) => ({ family: "app", id: plugin.id, row: { key: `featured:${plugin.id}`, kind: "featured", id: plugin.id } })),
  ...BUILTIN_PLUGINS.map((plugin) => ({ family: "plugin", id: plugin.id, row: { key: plugin.key, kind: "plugin" } })),
  ...GROK_CLOUD_CONNECTORS.map((connector) => ({ family: "grok", id: connector.id, row: { key: `grok:${connector.id}`, kind: "mcp" } })),
  ...MAC_APP_SETUP_IDS.map((id) => ({ family: "mac", id, row: { key: `mac-${id}`, kind: "mcp" } })),
  ...shippedSkills.map((id) => ({ family: "skill", id, row: { key: `skill:${id}`, kind: "skill", id } })),
  { family: "special", id: "tailscale", row: { key: "tailscale", kind: "mcp" } },
];

describe("built-in items have a shipped icon", () => {
  it("lists the catalog, the built-in plugins, the Grok connectors, the Mac apps, the shipped skills and Tailscale", () => {
    expect(BUILTIN_ITEMS.length).toBeGreaterThanOrEqual(18 + 1 + 8 + 6 + 3 + 1);
  });

  it.each(BUILTIN_ITEMS.map((item) => [`${item.family}:${item.id}`, item] as const))("%s has an icon", (key, item) => {
    expect(BUILTIN_GLYPHS[key], `${key} has no icon: add one to src/lib/builtin-icons.ts`).toBeDefined();
    expect(builtinGlyph(item.row), `${key} is not found from its row`).toBe(BUILTIN_GLYPHS[key]);
  });

  it("keeps no icon for an item that is not shipped (a stale entry is dead weight)", () => {
    const known = new Set(BUILTIN_ITEMS.map((item) => `${item.family}:${item.id}`));
    expect(Object.keys(BUILTIN_GLYPHS).filter((key) => !known.has(key))).toEqual([]);
  });

  it("gives an item the app does not ship no glyph (it falls to the one neutral tile)", () => {
    expect(builtinGlyph({ key: "featured:someone-else", kind: "featured", id: "someone-else" })).toBeUndefined();
  });
});
