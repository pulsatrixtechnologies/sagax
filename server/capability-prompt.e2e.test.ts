// A real chat-only turn must receive whole instructions, not host paths.
// The receipt and preview use the exact same per-capability budget.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { fixtureApi } from "../scripts/testing/preview-fixture.ts";
import { seedMarketplaceBeforeBoot } from "./testing/seed-marketplace.ts";

it("sends whole personal and plugin instructions to an API with the same visible per-capability budget", async () => {
  const requests: unknown[] = [];
  const provider = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json", connection: "close" });
        res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      } else if (req.url === "/v1/chat/completions") {
        requests.push(JSON.parse(body));
        res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "fixture reply" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      } else res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("fixture provider has no port");
  const fixture = await launchVerificationServer({ ...process.env, SAGAX_LIMIT_FAILOVER: "0" }, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, {
    prepareDataDir(dataDir) {
      const markets = seedMarketplaceBeforeBoot(dataDir, {
        name: "catalog",
        record: { source: "example/catalog", url: "https://github.com/example/catalog.git", addedAt: 1, updatedAt: 1, visibility: "org" },
      });
      const repo = markets.repoPath("catalog");
      for (const folder of [".claude-plugin", "packing/.claude-plugin"]) mkdirSync(join(repo, folder), { recursive: true });
      writeFileSync(join(repo, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "catalog", owner: { name: "Example" }, plugins: [{ name: "packing", source: "./packing", version: "1.0.0" }] }));
      writeFileSync(join(repo, "packing/.claude-plugin/plugin.json"), JSON.stringify({ name: "packing" }));
      const skill = (name: string, text: string) => {
        const folder = join(repo, "packing/skills", name);
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "SKILL.md"), `---\nname: ${name}\ndescription: Fixture\n---\n${text}\n`);
      };
      skill("a-big", "OVERSIZED_MUST_STAY_WHOLE_".repeat(300));
      for (let i = 0; i < 35; i++) skill(`s${String(i).padStart(2, "0")}`, `WIRE_${String(i).padStart(2, "0")}_COMPLETE.`);
    },
  });
  const api = fixtureApi(fixture.info.url);
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  try {
    await api("PUT", "/api/config", {
      openaiCompat: { url: `http://127.0.0.1:${address.port}/v1`, key: "fixture-only", model: "fixture-model" },
      instances: { openaiCompat: { driver: "openai-compat" } },
    });
    await api("POST", "/api/me/skills-library", { text: "---\nname: packing-list\ndescription: Verify packages\n---\nPERSONAL_WHOLE_INSTRUCTION: verify the destination, then the label.\n" });
    await api("POST", "/api/me/plugins/install", { marketplace: "catalog", plugin: "packing" });
    const { bot } = await control(["new-bot", "--name", "API capability fixture"]);
    await control(["set-model", "--bot", bot.id, "--instance", "openaiCompat", "--model", "fixture-model"]);
    const receipt = await api("GET", `/api/bots/${bot.id}/capabilities`);
    // Each whole file is named by its workspace_read alias, so the 4,000-byte
    // budget is reached before the 30-file cap: what fits is reported.
    const packing = receipt.items.find((item: { key: string }) => item.key === "plugin:me:packing@catalog");
    expect(packing).toMatchObject({ state: "on", promptIndex: { maxBytes: 4_000, maxSkills: 30 } });
    const { skills: shown, omitted } = packing.promptIndex as { skills: number; omitted: number };
    expect(shown).toBeGreaterThan(20);
    expect(shown).toBeLessThanOrEqual(30);
    expect(shown + omitted).toBe(36);
    const wire = (i: number) => `WIRE_${String(i).padStart(2, "0")}_COMPLETE.`;
    expect(receipt.items.find((item: { key: string }) => item.key === "skill:me:packing-list")).toMatchObject({ state: "on", promptIndex: { skills: 1, omitted: 0 } });
    const preview = JSON.stringify(await api("GET", `/api/bots/${bot.id}/system-prompt`));
    await control(["send", "--bot", bot.id, "--text", "Reply briefly."]);
    expect((await control(["wait", "--bot", bot.id, "--timeout", "30"])).status).toBe("settled");
    expect(requests.length).toBeGreaterThan(0);
    const sent = JSON.stringify(requests);
    for (const prompt of [sent, preview]) {
      expect(prompt).toContain("PERSONAL_WHOLE_INSTRUCTION: verify the destination, then the label.");
      expect(prompt).toContain(wire(0));
      expect(prompt).toContain(wire(shown - 1));
      expect(prompt).not.toContain(wire(shown));
      expect(prompt).not.toContain("OVERSIZED_MUST_STAY_WHOLE_");
      expect(prompt).toContain(`${omitted} omitted.`);
      expect(prompt).not.toContain(`${fixture.info.dataDir}/principals/`);
    }
  } finally {
    await fixture.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
}, 60_000);
