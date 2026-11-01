// Real server routes: one personal skill reaches two bots and an entire
// plugin has the same file contents in Me, This bot and Organization.
import { expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { seedMarketplaceBeforeBoot } from "./testing/seed-marketplace.ts";
it("serves the three scopes through the real routes and keeps personal references shared", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, {
    prepareDataDir(dataDir) {
      const markets = seedMarketplaceBeforeBoot(dataDir, {
        name: "catalog",
        record: { source: "example/catalog", url: "https://github.com/example/catalog.git", addedAt: 1, updatedAt: 1, visibility: "org" },
      });
      const repo = markets.repoPath("catalog");
      for (const folder of [".claude-plugin", "packing/.claude-plugin", "packing/skills/ship", "packing/agents", "packing/commands"]) mkdirSync(join(repo, folder), { recursive: true });
      writeFileSync(join(repo, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "catalog", owner: { name: "Example" }, plugins: [{ name: "packing", source: "./packing", version: "1.0.0" }] }));
      writeFileSync(join(repo, "packing/.claude-plugin/plugin.json"), JSON.stringify({ name: "packing" }));
      writeFileSync(join(repo, "packing/skills/ship/SKILL.md"), "---\nname: ship\ndescription: Verify shipping\n---\nVerify the package.\n");
      writeFileSync(join(repo, "packing/agents/clerk.md"), "Check the label.");
      writeFileSync(join(repo, "packing/commands/track.md"), "Track the package.");
    },
  });
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBeLessThan(400);
    return result;
  };
  try {
    const first = (await api("POST", "/api/bots", { name: "First" })).bot;
    const second = (await api("POST", "/api/bots", { name: "Second" })).bot;
    await api("POST", "/api/me/skills-library", { text: "---\nname: packing-list\ndescription: Verify packages\n---\nCheck the destination.\n" });
    for (const bot of [first, second]) {
      const receipt = await api("GET", `/api/bots/${bot.id}/capabilities`);
      expect(receipt.items).toContainEqual(expect.objectContaining({ key: "skill:me:packing-list", state: "on" }));
      expect(JSON.stringify(await api("GET", `/api/bots/${bot.id}/system-prompt`))).toContain("packing-list/SKILL.md");
    }
    const plugin = { marketplace: "catalog", plugin: "packing" };
    await api("POST", `/api/bots/${first.id}/plugins/install`, plugin);
    await api("POST", "/api/me/plugins/install", plugin);
    let receipt = await api("GET", `/api/bots/${first.id}/capabilities`);
    expect(receipt.items).toContainEqual(expect.objectContaining({ key: "plugin:me:packing@catalog", state: "on" }));
    expect(receipt.items).toContainEqual(expect.objectContaining({ key: "plugin:bot:packing@catalog", state: "off", reason: "name_taken" }));
    await api("POST", "/api/marketplaces/catalog/plugins/packing", {});
    await api("POST", "/api/marketplaces/catalog/plugins/packing", {}); // same update operation, no 409
    receipt = await api("GET", `/api/bots/${first.id}/capabilities`);
    expect(receipt.items).toContainEqual(expect.objectContaining({ key: "plugin:installation:packing@catalog", state: "on", brings: { skills: ["ship"], commands: ["track"], agents: ["clerk"], mcpServers: [] } }));
    expect(receipt.items).toContainEqual(expect.objectContaining({ key: "plugin:me:packing@catalog", state: "off", reason: "name_taken" }));
    await api("PATCH", "/api/me/skills-library/packing-list", { enabled: false });
    expect(JSON.stringify(await api("GET", `/api/bots/${second.id}/system-prompt`))).not.toContain("packing-list/SKILL.md");
  } finally { await fixture.close(); }
}, 90_000);
