// A real chat-only turn gets an index, then reads whole instructions on demand.
// The receipt and preview use the exact same per-capability budget.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { fixtureApi } from "../../scripts/testing/preview-fixture.ts";
import { seedMarketplaceBeforeBoot } from "../testing/seed-marketplace.ts";

it("indexes personal and plugin references, then loads exact scoped instructions on an API turn", async () => {
  const requests: Array<{ messages: Array<{ role: string; content?: string }>; tools?: Array<{ function: { name: string } }> }> = [];
  const provider = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json", connection: "close" });
        res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      } else if (req.url === "/v1/chat/completions") {
        const request = JSON.parse(body) as typeof requests[number];
        requests.push(request);
        res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
        const results = request.messages.filter(message => message.role === "tool");
        const tool = results.length === 0 ? "skills_list" : "workspace_read";
        const name = request.tools?.find(row => row.function.name.endsWith(tool))?.function.name;
        const listing = results[0]?.content ? JSON.parse(results[0].content) as { result?: string } : undefined;
        const path = listing?.result?.match(/Read "([^"]+)"/)?.[1];
        const delta = name && results.length < 2 ? { tool_calls: [{ index: 0, id: `read-${results.length}`, type: "function", function: { name,
          arguments: JSON.stringify(results.length ? { path } : { query: "packing-list" }) } }] } : { content: "fixture reply" };
        res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: "tool_calls" in delta ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
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
    // Bodies, including oversized ones, no longer consume the index budget.
    const packing = receipt.items.find((item: { key: string }) => item.key === "plugin:me:packing@catalog");
    expect(packing).toMatchObject({ state: "on", promptIndex: { maxBytes: 4_000, maxSkills: 30 } });
    const { skills: shown, omitted } = packing.promptIndex as { skills: number; omitted: number };
    expect(shown).toBeGreaterThan(20);
    expect(shown).toBeLessThanOrEqual(30);
    expect(shown + omitted).toBe(36);
    expect(receipt.items.find((item: { key: string }) => item.key === "skill:me:packing-list")).toMatchObject({ state: "on", promptIndex: { skills: 1, omitted: 0 } });
    const preview = JSON.stringify(await api("GET", `/api/bots/${bot.id}/system-prompt`));
    await control(["send", "--bot", bot.id, "--text", "Reply briefly."]);
    expect((await control(["wait", "--bot", bot.id, "--timeout", "30"])).status).toBe("settled");
    expect(requests.length).toBeGreaterThan(0);
    const sent = JSON.stringify(requests[0]);
    for (const prompt of [sent, preview]) {
      expect(prompt).toContain("packing-list: Verify packages");
      expect(prompt).toContain("a-big: Fixture");
      expect(prompt).not.toContain("PERSONAL_WHOLE_INSTRUCTION");
      expect(prompt).not.toContain("WIRE_");
      expect(prompt).not.toContain("OVERSIZED_MUST_STAY_WHOLE_");
      expect(prompt).toContain(`${omitted} omitted.`);
      expect(prompt).not.toContain(`${fixture.info.dataDir}/principals/`);
    }
    const toolResults = requests.flatMap(request => request.messages.filter(message => message.role === "tool"));
    expect(toolResults.some(message => message.content?.includes("capability-skills/me/skills/packing-list/SKILL.md"))).toBe(true);
    expect(toolResults.some(message => message.content?.includes("PERSONAL_WHOLE_INSTRUCTION: verify the destination, then the label."))).toBe(true);
  } finally {
    await fixture.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
}, 60_000);
