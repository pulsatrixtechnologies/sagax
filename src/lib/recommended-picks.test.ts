import { describe, expect, it } from "vitest";

import { buildPluginItems, mainSections, type PluginItem } from "./plugins-model";
import { PICK_KINDS, PICK_WHY, RECOMMENDED_PICKS, recommendedPicks } from "./recommended-picks";
import en from "../locales/en.json" with { type: "json" };

const featured = (id: string, name: string, category = "productivity") => ({
  id, name, description: `${name} tools`, url: `https://mcp.${id}.example.net/mcp`, domain: `mcp.${id}.example.net`, auth: "oauth", category,
});
const plugin = (name: string, installed = false) => ({ name, description: `${name} plugin`, installed, servers: [], skills: [], category: "productivity" });

const items = (): PluginItem[] => buildPluginItems({
  featured: [featured("stripe", "Stripe", "finance"), featured("notion", "Notion"), featured("linear", "Linear"), featured("slack", "Slack", "communication"), featured("zoom", "Zoom", "communication")],
  marketplaces: [{ name: "official", plugins: [plugin("playwright"), plugin("github"), plugin("pdf-tools"), plugin("dropbox")] }],
  tailscale: { description: "Private network", connected: false },
});

const names = (rows: ReturnType<typeof recommendedPicks>) => rows.map((row) => row.item.name);

describe("Recommended for you (#4207)", () => {
  it("keeps the curated order: the work basics first, one per kind, then the others", () => {
    expect(names(recommendedPicks(items(), { names: [] }))).toEqual(["dropbox", "Slack", "github", "playwright", "Linear", "Notion", "Stripe", "Zoom"]);
  });

  it("leaves out what the person already has, by name and by kind", () => {
    // GitHub installed under another source, a chat app on the account, a
    // mail connector that reaches files too
    const rows = recommendedPicks(items(), { names: ["GitHub"], capabilities: ["files", "teams"] });
    expect(names(rows)).toEqual(["playwright", "Linear", "Notion", "Stripe"]);
    // an installed row is never offered
    const installed = items().map((item) => (item.name === "Linear" ? { ...item, installed: true, status: "connected" as const } : item));
    expect(names(recommendedPicks(installed, { names: [] }))).not.toContain("Linear");
  });

  it("leaves out what this person cannot connect here: hidden, never greyed", () => {
    const rows = recommendedPicks(items(), { names: [] }, (item) => item.kind !== "plugin");
    expect(names(rows)).toEqual(["Slack", "Linear", "Notion", "Stripe", "Zoom"]);
    expect(recommendedPicks([], { names: [] })).toEqual([]);
  });

  it("never picks a private network tool or an item off the list", () => {
    const picked = names(recommendedPicks(items(), { names: [] }));
    expect(picked).not.toContain("Tailscale");
    expect(picked).not.toContain("pdf-tools");
  });

  it("the main sections no longer hold a Recommended section of their own, and skip what it shows", () => {
    const all = items();
    const shown = recommendedPicks(all, { names: [] }).slice(0, 6).map((row) => row.item.key);
    const sections = mainSections(all, "", "all", "any", [], [], shown);
    expect(sections.map((section) => section.id)).not.toContain("recommended");
    const keys = sections.flatMap((section) => section.items.map((item) => item.key));
    expect(keys.some((key) => shown.includes(key))).toBe(false);
    // Tailscale still has its place under Other
    expect(keys).toContain("tailscale:tailscale");
  });

  it("every pick has a kind, a why in English and unique keys", () => {
    const keys = RECOMMENDED_PICKS.flatMap((pick) => pick.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const kind of PICK_KINDS) expect((en as Record<string, string>)[PICK_WHY[kind]]).toBeTruthy();
  });
});
