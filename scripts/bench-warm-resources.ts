#!/usr/bin/env -S node --experimental-strip-types
/** Isolated 50-person x 3-thread retention load through the production pools.
 * Real fake-CLI children, real MCP mounts, synthetic Perspicax only. No API
 * credentials, network providers, user workspace or visible windows.
 * node --experimental-strip-types scripts/bench-warm-resources.ts [output.json]
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const scratch = mkdtempSync(join(tmpdir(), "sagax-warm-budget-"));
process.env.SAGAX_DATA_DIR = join(scratch, "data");
process.env.SAGAX_WARM_MAX_COUNT = "16";
process.env.SAGAX_WARM_MAX_BYTES = String(1024 * 1024 * 1024);
process.env.SAGAX_WARM_PERSON_MAX_COUNT = "6";
process.env.SAGAX_WARM_PERSON_MAX_BYTES = String(512 * 1024 * 1024);

const { warmResources } = await import("../server/resources/warm-resources.ts");
const { ensureDirs } = await import("../server/config.ts");
const { CodexDriver } = await import("../server/drivers/codex.ts");
const { createAcpDriver } = await import("../server/drivers/acp/core.ts");
const { createWarmToolSessions } = await import("../server/drivers/openai-chat-tools-warm.ts");
const { PerspicaxMcp } = await import("../server/perspicax/perspicax-mcp.ts");
const { recordEvents } = await import("../server/testing/events.ts");
ensureDirs();
const codexHome = join(scratch, "codex"); mkdirSync(codexHome);
const fixture = (name: string) => fileURLToPath(new URL(`../server/testing/${name}`, import.meta.url));
const acpDriver = createAcpDriver({
  driverKind: "warmBudgetFixture", displayName: "Osprey", defaultCli: "fixture",
  nativeSource: "fixture.acp", models: { default: "fixture", options: [{ id: "fixture", label: "Fixture" }] },
  spawnArgs: () => [], pickAuthMethod: () => null, authFailure: "continue", isAuthenticated: () => true,
  loginNote: "Fixture", warmSession: true,
});
const codex = await CodexDriver.create({ instanceId: "fixture-codex", displayName: "Osprey", enabled: true,
  config: CodexDriver.decodeConfig({ cli: fixture("fake-codex-app-server.ts"), managed: { url: "http://127.0.0.1:1/v1", models: ["fixture"] } }),
  environment: { CODEX_HOME: codexHome, SAGAX_COMPANY_API_KEY: "fixture-only", FAKE_CODEX_MODE: "resume" },
});
const acp = await acpDriver.create({ instanceId: "fixture-acp", displayName: "Wren", enabled: true,
  config: { cli: fixture("fake-acp-cli.ts"), fullAuto: false }, environment: { FAKE_ACP_MODE: "simple" },
});
const mounts = createWarmToolSessions();
const records = [recordEvents(codex.adapter), recordEvents(acp.adapter)];
let exchanges = 0, revocations = 0;
const perspicax = new PerspicaxMcp({
  issuer: "https://fixture.example.test", version: "fixture", engineWarm: () => true,
  link: () => ({ profileCatalog: () => [{ id: "fixture", slug: "fixture", name: "Fixture", description: "" }],
    exchangeToken: async () => ({ ok: true, token: `fixture-${++exchanges}`, expiresAt: Date.now() + 900_000 }),
    revokeExchanged: async () => { revocations++; return true; }, mcpEndpoint: () => "https://fixture.example.test/mcp" }),
  subjectOf: id => ({ iss: "https://fixture.example.test", sub: id, disabled: false }),
  subjectToken: async () => ({ ok: true, token: "fixture-subject", expiresAt: Date.now() + 900_000 }),
  botProfiles: () => ["fixture"],
  fetch: (async (_url, init) => {
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const frame = JSON.parse(String(init?.body));
    if (frame.id === undefined) return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: frame.id, result: { tools: [] } }, { headers: { "mcp-session-id": "fixture-session" } });
  }) as typeof fetch,
});
const mcpScript = join(scratch, "mcp.cjs");
writeFileSync(mcpScript, `const r=require('node:readline').createInterface({input:process.stdin});
r.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}}}:m.method==='tools/list'?{tools:[]}:{};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
const samples: Array<{ turn: number; count: number; memoryBytes: number; sampledRssBytes: number; hostRssBytes: number }> = [];
let report: unknown;
const started = Date.now();
try {
  for (let person = 0; person < 50; person++) {
    for (let thread = 0; thread < 3; thread++) {
      const threadId = `fixture-${person}-${thread}`, principalId = `person-${person}`;
      const slot = (person * 3 + thread) % 2;
      const instance = slot === 0 ? codex : acp;
      const input = { threadId, principalId, botId: `bot-${person}`, model: "fixture", cwd: scratch, text: "Fixture reply" };
      const result = await instance.adapter.sendTurn(input);
      const done = await records[slot]!.until(e => e.type === "turn.completed" && e.turnId === result.turnId);
      assert.equal(done.ok, true);
      await mounts.prewarm({ ...input, integrations: { agents: { command: process.execPath, args: [mcpScript], env: {} } } }, { computerUse: false, driverKind: "fixture" });
      await perspicax.prepareTurn({ threadId, generation: "fixture", bot: { id: input.botId, ownerPrincipalId: principalId, perspicax: { profiles: ["fixture"] } }, speakerPrincipalId: principalId, speakerOrigin: "person" });
      await perspicax.relay({ threadId, generation: "fixture", botId: input.botId, profileId: "fixture", frame: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
      await perspicax.endGeneration(threadId, "fixture");
      await warmResources.refresh(); await warmResources.settled();
      const stats = warmResources.stats();
      assert.equal(stats.overBudget, false);
      samples.push({ turn: person * 3 + thread + 1, count: stats.count, memoryBytes: stats.memoryBytes,
        sampledRssBytes: stats.sampledRssBytes, hostRssBytes: process.memoryUsage().rss });
      if (samples.length % 30 === 0) process.stderr.write(`warm budget: ${samples.length}/150, ${stats.count} retained, ${Math.round(stats.memoryBytes / 1024 / 1024)} MiB charged\n`);
    }
  }
  report = { people: 50, threadsPerPerson: 3, turns: 150, elapsedMs: Date.now() - started,
    limits: warmResources.stats().limits, final: warmResources.stats(), exchanges,
    peakRetainedCount: Math.max(...samples.map(s => s.count)), peakChargedBytes: Math.max(...samples.map(s => s.memoryBytes)),
    peakSampledChildRssBytes: Math.max(...samples.map(s => s.sampledRssBytes)), samples,
    scope: "Production Codex/ACP/HTTP MCP/Perspicax pools with fake providers. Settled checkpoints, not a limit on simultaneous active-turn memory." };
} finally {
  await mounts.releaseAll(); await perspicax.endAll();
  await codex.dispose(); await acp.dispose(); records.forEach(r => r.stop());
  // ACP gives EOF a grace period. Reap only descendants of this bench,
  // including any child still retiring, before removing its isolated home.
  const deadline = Date.now() + 15_000;
  while (warmResources.stats().resources && Date.now() < deadline) await delay(25);
  await warmResources.settled();
  assert.equal(warmResources.stats().resources, 0, "every fixture resource must be retired");
  rmSync(scratch, { recursive: true, force: true });
}
const output = JSON.stringify({ ...(report as object), revocations, cleanupResources: warmResources.stats().resources }, null, 2) + "\n";
if (process.argv[2]) writeFileSync(process.argv[2], output); else process.stdout.write(output);
