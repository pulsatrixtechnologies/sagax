// Real routes, fake engines and temporary data. No installed app or account.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { PluginMarketplaces } from "./plugin-marketplaces.ts";

const key = "isolated-skill-discovery-capability-20261031";
const skillText = (name: string) => `---\nname: ${name}\ndescription: Vérifier les colis.\n---\nRead the synthetic shipping checklist for ${name}.\n`;

it("keeps every scope discoverable with authoring off and revokes stale library aliases", async () => {
  const fixture = await launchVerificationServer({ ...process.env, SAGAX_TEST_INTERNAL_CAPABILITY_KEY: key }, undefined, undefined, undefined, undefined, undefined, ["codex"]);
  const api = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url,
      ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    expect((await api("PATCH", "/api/config", { features: { skillsLibrary: true, skillAuthoring: false } })).status).toBe(200);
    const created = await api("POST", "/api/bots", { name: "Discovery fixture", modelSelection: { instanceId: "codex", model: "gpt-5" } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const bot = created.body.bot;
    const minted = await fetch(fixture.info.url + "/api/testing/internal-capability", { method: "POST",
      headers: { "content-type": "application/json", "x-openmausbot-test-capability": key }, body: JSON.stringify({ botId: bot.id, threadId: bot.threadId, skillAuthoring: false }) });
    expect(minted.status).toBe(201);
    const token = (await minted.json() as any).token;
    for (let i = 0; i < 32; i++) expect((await api("POST", "/api/me/skills-library", { text: skillText(`personal-${i}`) })).status).toBe(201);
    expect((await api("POST", `/api/bots/${bot.id}/skill-template`, { name: "bot-review", description: "Verify the fixture", source: "conversation", text: skillText("bot-review"), enabled: true })).status).toBe(201);
    await api("POST", "/api/skills-library", { text: skillText("library-review") });
    await api("PATCH", "/api/skills-library/library-review", { enabled: true });
    await api("PUT", `/api/bots/${bot.id}/skills-library`, { skills: ["library-review"] });

    const markets = new PluginMarketplaces({ dataDir: fixture.info.dataDir, gitEnvironment: () => ({}), policy: () => undefined });
    const repo = markets.repoPath("fixture");
    for (const directory of [".claude-plugin", "packing/.claude-plugin", "packing/commands", "packing/agents"]) mkdirSync(join(repo, directory), { recursive: true });
    writeFileSync(join(repo, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "fixture", owner: { name: "Example" }, plugins: [{ name: "packing", source: "./packing", version: "1.0.0" }] }));
    writeFileSync(join(repo, "packing/.claude-plugin/plugin.json"), JSON.stringify({ name: "packing" }));
    for (let i = 0; i < 45; i++) {
      const folder = join(repo, "packing/skills", `plugin-${i}`);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "SKILL.md"), skillText(`plugin-${i}`));
    }
    writeFileSync(join(repo, "packing/commands/track.md"), "Track the synthetic parcel.");
    writeFileSync(join(repo, "packing/agents/clerk.md"), "Verify the synthetic label.");
    markets.adopt({ name: "fixture", record: { source: "example/fixture", url: "https://github.com/example/fixture.git", addedAt: 1, updatedAt: 1, visibility: "org" } });
    expect((await api("POST", "/api/me/plugins/install", { marketplace: "fixture", plugin: "packing" })).status).toBe(201);

    const rows: any[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await api("GET", `/api/internal/skills?offset=${offset}`, undefined, token);
      expect(page.status).toBe(200);
      rows.push(...page.body.skills);
      offset = page.body.nextOffset;
    }
    expect(rows).toHaveLength(81); // 32 Me + bot + library + 45 plugin skills + command + agent
    expect(new Set(rows.map((row) => row.id)).size).toBe(81);
    expect(JSON.stringify(rows)).not.toContain(fixture.info.dataDir);
    const preview = (await api("GET", `/api/bots/${bot.id}/system-prompt`)).body;
    const prompt = preview.sections.find((section: any) => section.id === "skills");
    const receipt = (await api("GET", `/api/bots/${bot.id}/capabilities`)).body;
    expect(receipt.promptIndex.bytes).toBe(Buffer.byteLength(prompt.text, "utf8"));
    expect(receipt.promptIndex.bytes).toBeLessThanOrEqual(4000);
    expect(receipt.promptIndex.skills + receipt.promptIndex.omitted).toBe(81);
    expect(prompt.text).toContain("skills_list");
    const omitted = rows.find((row) => row.enabled && !prompt.text.includes(JSON.stringify(row.path)));
    expect(omitted).toBeTruthy();
    expect((await api("GET", `/api/internal/workspace/read?path=${encodeURIComponent(omitted.path)}`, undefined, token)).status).toBe(200);
    expect((await api("GET", "/api/internal/skills?query=track", undefined, token)).body.skills[0].kind).toBe("command");
    for (const bad of ["-1", "NaN", "Infinity", "1.5"]) expect((await api("GET", `/api/internal/skills?offset=${bad}`, undefined, token)).status).toBe(400);
    expect((await api("POST", "/api/internal/skills/stage", { action: "create", source: "conversation", skill_md: skillText("should-not-write") }, token)).status).toBe(403);

    const libraryRead = () => api("GET", "/api/internal/workspace/read?path=skill-library/library-review/SKILL.md", undefined, token);
    expect((await libraryRead()).status).toBe(200);
    await api("PATCH", "/api/skills-library/library-review", { enabled: false });
    expect((await libraryRead()).status).toBe(404);
    await api("PATCH", "/api/skills-library/library-review", { enabled: true });
    await api("PUT", `/api/bots/${bot.id}/skills-library`, { skills: [] });
    expect((await libraryRead()).status).toBe(404);
    await api("PUT", `/api/bots/${bot.id}/skills-library`, { skills: ["library-review"] });
    await api("POST", "/api/me/skills-library", { text: skillText("library-review") });
    expect((await libraryRead()).status).toBe(404); // Me is now the winner
    await api("DELETE", "/api/me/skills-library/library-review");
    expect((await libraryRead()).status).toBe(200);
    writeFileSync(join(fixture.info.dataDir, "skills-library/skills/library-review/SKILL.md"), "Unreviewed changed bytes.");
    expect((await libraryRead()).status).toBe(404);
  } finally { await fixture.close(); }
}, 90_000);
