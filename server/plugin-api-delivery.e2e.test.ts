// API engines receive plugin skills/commands/agents through managed tools.
// Real turns go through the dispatcher against a mock OpenAI-compatible
// upstream. Synthetic fixtures only; no live provider account.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { seedMarketplaceBeforeBoot } from "./testing/seed-marketplace.ts";
import { recoveryCapabilityError } from "./automatic-recovery.ts";

const skillText = (name: string) => `---\nname: ${name}\ndescription: Verify the synthetic ${name}.\n---\nRead the checklist for ${name}.\nUnique bytes ${name}.\n`;

type ChatMessage = { role: string; content?: string; tool_call_id?: string; tool_calls?: Array<{ id: string; function?: { name: string; arguments: string } }> };
type ChatRequest = {
  messages: ChatMessage[];
  tools?: Array<{ function: { name: string; description?: string } }>;
};

function delivered(request: ChatRequest) {
  const system = request.messages.find((message) => message.role === "system")?.content ?? "";
  const turn = request.messages.findLast((message) => message.role === "user")?.content ?? "";
  return { system, turn, all: `${system}\n${turn}` };
}

function toolName(tools: ChatRequest["tools"], match: RegExp): string | undefined {
  return tools?.find((tool) => match.test(tool.function.name) || match.test(tool.function.description ?? ""))?.function.name;
}

it("delivers plugin skills on an API turn with tools, preserves bytes across switch, and revokes on disable", async () => {
  const requests: ChatRequest[] = [];
  let scenario: "list" | "read" | "plain" | "denied" = "plain";
  const upstream = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer synthetic-fixture-key") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
      return;
    }
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body) as ChatRequest;
    requests.push(request);
    const frame = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const toolResult = request.messages.find((message) => message.role === "tool");
    if (toolResult) {
      res.end(frame({ content: "Plugin bytes delivered through the managed tool." }, "stop") + "data: [DONE]\n\n");
      return;
    }
    if (scenario === "list") {
      const name = toolName(request.tools, /skills_list/) ?? "agents_skills_list";
      const call = { index: 0, id: "plugin-list", type: "function", function: { name, arguments: "{}" } };
      res.end(frame({ tool_calls: [call] }, "tool_calls") + "data: [DONE]\n\n");
      return;
    }
    if (scenario === "read") {
      const name = toolName(request.tools, /workspace_read/) ?? "agents_workspace_read";
      const call = {
        index: 0,
        id: "plugin-read",
        type: "function",
        function: { name, arguments: JSON.stringify({ path: "plugins/packing/skills/plugin-ship/SKILL.md" }) },
      };
      res.end(frame({ tool_calls: [call] }, "tool_calls") + "data: [DONE]\n\n");
      return;
    }
    res.end(frame({ content: scenario === "denied" ? "No plugin tools on this turn." : "Hello from the plugin fixture." }, "stop") + "data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("fixture provider address missing");

  const fixture = await launchVerificationServer(
    { ...process.env, SAGAX_LIMIT_FAILOVER: "0" },
    undefined, undefined, undefined, undefined, undefined, [], undefined, undefined,
    {
      prepareDataDir(dataDir) {
        const markets = seedMarketplaceBeforeBoot(dataDir, {
          name: "fixture",
          record: { source: "example/fixture", url: "https://github.com/example/fixture.git", addedAt: 1, updatedAt: 1, visibility: "org" },
        });
        const repo = markets.repoPath("fixture");
        for (const directory of [".claude-plugin", "packing/.claude-plugin", "packing/skills/plugin-ship", "packing/commands", "packing/agents"]) {
          mkdirSync(join(repo, directory), { recursive: true });
        }
        writeFileSync(join(repo, ".claude-plugin/marketplace.json"), JSON.stringify({
          name: "fixture", owner: { name: "Example" },
          plugins: [{ name: "packing", source: "./packing", version: "1.0.0" }],
        }));
        writeFileSync(join(repo, "packing/.claude-plugin/plugin.json"), JSON.stringify({
          name: "packing",
          mcpServers: { "packing-track": { command: process.execPath, args: ["-e", "process.stdin.resume()"] } },
        }));
        writeFileSync(join(repo, "packing/skills/plugin-ship/SKILL.md"), skillText("plugin-ship"));
        writeFileSync(join(repo, "packing/commands/track.md"), "Track the synthetic parcel.");
        writeFileSync(join(repo, "packing/agents/clerk.md"), "---\nname: clerk\n---\nVerify the synthetic label.");
      },
    },
  ).catch(async (error) => {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    throw error;
  });
  const control = async (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  const api = async (method: string, path: string, body?: unknown, expectedStatus?: number) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    if (expectedStatus !== undefined) expect(response.status, JSON.stringify(result)).toBe(expectedStatus);
    else expect(response.ok, JSON.stringify(result)).toBe(true);
    return result;
  };

  try {
    await api("PATCH", "/api/config", {
      features: { skillsLibrary: true, skillAuthoring: false },
      openaiCompat: { key: "synthetic-fixture-key", url: `http://127.0.0.1:${address.port}/v1`, model: "fixture-model" },
      instances: { openaiCompat: { driver: "openai-compat", displayName: "API fixture" } },
    });
    expect(await api("POST", "/api/keys/test", { provider: "openaiCompat" })).toMatchObject({ ok: true });
    await api("POST", "/api/instances/openaiCompat/refresh-models", {});

    const { bot } = await control(["new-bot", "--name", "API plugin delivery"]);
    await control(["set-model", "--bot", bot.id, "--instance", "openaiCompat", "--model", "fixture-model"]);
    await api("PATCH", `/api/bots/${bot.id}`, {
      description: "Plugin delivery fixture",
      soul: "Use managed skills tools when asked to list or read a plugin skill.",
      approvalMode: "auto",
    });
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.activeTaskId}`, { approvalMode: "auto" });

    await api("POST", "/api/me/skills-library", { text: skillText("personal-review") });
    await api("POST", `/api/bots/${bot.id}/skill-template`, {
      name: "bot-review", description: "Verify the fixture", source: "conversation", text: skillText("bot-review"), enabled: true,
    });
    await api("POST", "/api/skills-library", { text: skillText("library-review") });
    await api("PATCH", "/api/skills-library/library-review", { enabled: true });
    await api("PUT", `/api/bots/${bot.id}/skills-library`, { skills: ["library-review"] });

    expect((await api("POST", "/api/me/plugins/install", { marketplace: "fixture", plugin: "packing" }, 201)).plugin ?? true).toBeTruthy();

    const receipt = await api("GET", `/api/bots/${bot.id}/capabilities`);
    expect(receipt.engine.kind).toBe("openai-compat");
    const pluginRow = receipt.items.find((item: any) => item.form === "plugin" && /packing/i.test(String(item.name)));
    expect(pluginRow).toMatchObject({
      state: "on",
      engine: { skills: "prompt", commands: "prompt", agents: "prompt", nothing: false },
    });
    expect(pluginRow.brings?.mcpServers?.length ?? pluginRow.mounts?.length ?? 0).toBeGreaterThan(0);
    expect(receipt.items.filter((item: any) => item.form === "flow").every((item: any) => item.engine?.nothing !== false || item.state === "not_served" || item.state === "off")).toBe(true);
    expect(receipt.promptIndex?.skills + (receipt.promptIndex?.omitted ?? 0)).toBeGreaterThan(0);

    // Actual turn: prompt carries plugin refs and agents tools; connectors claim packing.
    scenario = "plain";
    const beforePlain = requests.length;
    expect((await control(["send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Confirm the packing plugin is available."])).success).toBe(true);
    expect((await control(["wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "20"])).status).toBe("settled");
    const plain = requests[beforePlain]!;
    const first = delivered(plain);
    expect(first.all).toContain("plugins/packing/skills/plugin-ship/SKILL.md");
    expect(first.all).toMatch(/plugin-ship|packing/);
    expect(first.all).toContain("packing-track");
    expect(JSON.stringify(plain.tools?.map((tool) => tool.function.name) ?? [])).toMatch(/skills_list/);
    expect(JSON.stringify(plain.tools?.map((tool) => tool.function.name) ?? [])).toMatch(/workspace_read/);
    // Plugin discovery aliases stay managed paths; never host plugin folders.
    const skillsStart = first.all.indexOf("Enabled skills and plugin references:");
    const skillsEnd = first.all.indexOf("\nContext from Sagax", skillsStart);
    const skillsBlock = first.all.slice(skillsStart, skillsEnd > skillsStart ? skillsEnd : undefined);
    expect(skillsBlock).toContain("plugins/packing/");
    expect(skillsBlock).toContain("capability-skills/me/skills/personal-review/SKILL.md");
    expect(skillsBlock).not.toMatch(/capability-plugins|bot-plugins|\/var\/folders|openmausbot-verify-data/);

    const afterPlain = await api("GET", "/api/bots");
    const liveBot = afterPlain.bots.find((item: any) => item.id === bot.id);
    const task = liveBot?.tasks?.find((item: any) => item.id === bot.activeTaskId)
      ?? liveBot?.tasks?.find((item: any) => item.id === liveBot.activeTaskId)
      ?? liveBot?.task;
    const connectors = task?.connectors?.connectors ?? [];
    expect(connectors.some((row: any) => row.source === "plugin" && /packing/i.test(String(row.name))), JSON.stringify(task?.connectors)).toBe(true);

    // Tool delivery: model lists then reads the managed plugin alias.
    scenario = "list";
    const beforeList = requests.length;
    expect((await control(["send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "List available plugin skills."])).success).toBe(true);
    expect((await control(["wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "20"])).status).toBe("settled");
    expect(requests.length).toBeGreaterThan(beforeList + 1);
    const listTool = requests[beforeList + 1]!.messages.find((message) => message.role === "tool");
    expect(String(listTool?.content ?? "")).toMatch(/plugin-ship/);

    scenario = "read";
    const beforeRead = requests.length;
    expect((await control(["send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Read the packing plugin skill."])).success).toBe(true);
    expect((await control(["wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "20"])).status).toBe("settled");
    expect(requests.length).toBeGreaterThan(beforeRead + 1);
    const readTool = requests[beforeRead + 1]!.messages.find((message) => message.role === "tool");
    expect(String(readTool?.content ?? "")).toContain("Unique bytes plugin-ship");
    const beforeBytes = String(readTool?.content ?? "");

    // Room turn also receives the same managed plugin index.
    scenario = "plain";
    const { group } = await api("POST", "/api/groups", {
      name: "API plugin room",
      memberIds: [bot.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } },
    });
    const beforeRoom = requests.length;
    await control(["send-channel", "--channel", group.id, "--text", "Greet this room with packing available."]);
    expect((await control(["wait", "--channel", group.id, "--timeout", "20"])).status).toBe("settled");
    expect(delivered(requests[beforeRoom]!).all).toContain("plugins/packing/skills/plugin-ship/SKILL.md");

    // Denied skills_list (Q8 C): the whole files still reach the prompt by
    // name within the per-capability budget; no managed alias is offered.
    scenario = "denied";
    await api("PATCH", `/api/bots/${bot.id}`, {
      toolScope: { deny: ["mcp:agents:skills_list"] },
    });
    const beforeDenied = requests.length;
    expect((await control(["send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Try again without skills list."])).success).toBe(true);
    expect((await control(["wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "20"])).status).toBe("settled");
    const deniedReq = requests[beforeDenied]!;
    expect(JSON.stringify(deniedReq.tools?.map((tool) => tool.function.name) ?? [])).not.toMatch(/skills_list/);
    expect(delivered(deniedReq).all).toContain("Unique bytes plugin-ship.");
    expect(delivered(deniedReq).all).not.toContain("plugins/packing/skills/plugin-ship/SKILL.md");
    expect(delivered(deniedReq).all).toMatch(/Prompt budget: \d+\/\d+ files, at most 30 files and 4000 bytes per capability/);
    const deniedReceipt = await api("GET", `/api/bots/${bot.id}/capabilities`);
    expect(deniedReceipt.items.find((item: any) => item.form === "plugin" && /packing/i.test(String(item.name)))?.engine.skills).toBe("prompt");
    expect(Boolean(deniedReceipt.promptIndex)).toBe(true);
    const deniedBot = (await api("GET", "/api/bots")).bots.find((item: any) => item.id === bot.id);
    const deniedTask = deniedBot?.tasks?.find((item: any) => item.threadId === bot.activeTaskId) ?? deniedBot?.task;
    const deniedConnectors = deniedTask?.connectors?.connectors ?? [];
    expect(deniedConnectors.some((row: any) => row.source === "plugin" && /packing/i.test(String(row.name))), JSON.stringify(deniedTask?.connectors)).toBe(true);

    // Restore tools and switch engines: same selected bytes.
    await api("PATCH", `/api/bots/${bot.id}`, { toolScope: null });
    const previewClaude = await api("GET", `/api/bots/${bot.id}/capabilities?engine=claude`);
    expect(previewClaude.items.find((item: any) => item.form === "plugin" && /packing/i.test(String(item.name)))?.engine.skills).toBe("native");

    const switched = await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
    expect(switched.bot.modelSelection.instanceId).toBe("claude");

    // A second API bot of the same person reads the same Me plugin bytes.
    // The same-bot engine switch and an actual limit failover are exercised
    // in plugin-engine-continuity.e2e.test.ts.
    const { bot: apiBot } = await control(["new-bot", "--name", "API plugin switch"]);
    await control(["set-model", "--bot", apiBot.id, "--instance", "openaiCompat", "--model", "fixture-model"]);
    await api("PATCH", `/api/bots/${apiBot.id}`, { approvalMode: "auto" });
    await api("PATCH", `/api/bots/${apiBot.id}/tasks/${apiBot.activeTaskId}`, { approvalMode: "auto" });
    expect((await api("POST", "/api/me/plugins/install", { marketplace: "fixture", plugin: "packing" }, 201)).plugin ?? true).toBeTruthy();
    // Personal plugin already installed; ensure the new bot sees it through me scope.
    scenario = "read";
    const beforeSwitchRead = requests.length;
    expect((await control(["send", "--bot", apiBot.id, "--task", apiBot.activeTaskId, "--text", "Read packing again."])).success).toBe(true);
    expect((await control(["wait", "--bot", apiBot.id, "--task", apiBot.activeTaskId, "--timeout", "20"])).status).toBe("settled");
    const switchRead = requests[beforeSwitchRead + 1]?.messages.find((message) => message.role === "tool");
    expect(String(switchRead?.content ?? "")).toContain("Unique bytes plugin-ship");
    expect(String(switchRead?.content ?? "")).toContain(beforeBytes.includes("Unique bytes plugin-ship") ? "Unique bytes plugin-ship" : "plugin-ship");

    expect(recoveryCapabilityError(
      { driverKind: "grok", capabilities: { agentsMcp: true, customMcp: true } as any },
      { driverKind: "openai-compat", capabilities: { agentsMcp: true, customMcp: true } as any },
    )).toBeUndefined();
    expect(recoveryCapabilityError(
      { driverKind: "grok", capabilities: { agentsMcp: true } as any },
      { driverKind: "claudeAgent", capabilities: { agentsMcp: true } as any },
    )).toMatch(/workspace/i);

    // Disable and integrity-style revoke: alias disappears.
    expect((await api("PATCH", "/api/me/plugins/packing@fixture", { enabled: false })).plugin?.enabled ?? false).toBe(false);
    scenario = "read";
    const beforeDisabled = requests.length;
    expect((await control(["send", "--bot", apiBot.id, "--task", apiBot.activeTaskId, "--text", "Read packing while disabled."])).success).toBe(true);
    expect((await control(["wait", "--bot", apiBot.id, "--task", apiBot.activeTaskId, "--timeout", "20"])).status).toBe("settled");
    const disabledTool = requests[beforeDisabled + 1]?.messages.find((message) => message.role === "tool");
    expect(String(disabledTool?.content ?? "")).toMatch(/no such file|not found|missing|404|unable|cannot|denied|unavailable/i);

    // Library unassign still gates library paths (Lot 1 continuity).
    await api("PATCH", "/api/me/plugins/packing@fixture", { enabled: true });
    await api("PUT", `/api/bots/${apiBot.id}/skills-library`, { skills: ["library-review"] });
    const assigned = await api("GET", `/api/bots/${apiBot.id}/capabilities`);
    expect(assigned.items.some((item: any) => /library-review/.test(String(item.key)) && item.state === "on")).toBe(true);
    await api("PUT", `/api/bots/${apiBot.id}/skills-library`, { skills: [] });
    const unassignedReceipt = await api("GET", `/api/bots/${apiBot.id}/capabilities`);
    expect(unassignedReceipt.items.some((item: any) => /library-review/.test(String(item.key)) && item.state === "on")).toBe(false);
  } finally {
    await fixture.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
}, 180_000);
