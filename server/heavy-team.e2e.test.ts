// Heavy mode (#4901, rebuilt by #5089) end to end through the real server and
// the fake Claude CLI: a person's turn on a Heavy bot asks the leader for its
// team, opens one hidden read-only thread per expert, runs the rounds (the
// fake never agrees: exactly 5 rounds, then the leader decides), keeps the
// whole run on one row of the conversation, hands the leader the team's
// notes, and ends with the leader's ordinary reply. Every expert's engine
// is launched without a write tool, under a restricted MCP configuration.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";

async function fixture(prepareDataDir?: (dataDir: string) => void) {
  const server = prepareDataDir
    ? await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, { prepareDataDir })
    : await launchVerificationServer();
  const { url, dataDir } = server.info;
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const launches = join(dataDir, "launches.jsonl");
  mkdirSync(join(dataDir, "gates"), { recursive: true });
  const wrapper = join(dataDir, "team-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { appendFileSync, readFileSync } from "node:fs";',
    'const at = process.argv.indexOf("--append-system-prompt-file");',
    'let system = ""; try { system = at >= 0 ? readFileSync(process.argv[at + 1], "utf8") : ""; } catch {}',
    `if (process.argv.includes("--input-format")) appendFileSync(${JSON.stringify(launches)}, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), system }) + "\\n");`,
    `process.env.FAKE_CLAUDE_PROMPTS = ${JSON.stringify(join(dataDir, "received.jsonl"))};`,
    'process.stdin.on("end", () => process.exit(0));',
    `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("./testing/fake-claude-cli.ts", import.meta.url))).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli: wrapper });
  const bot = (await api("POST", "/api/bots", { name: "Quasar" }, 201)).bot;
  const lines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  const launched = () => lines(launches) as Array<{ pid: number; argv: string[]; system: string }>;
  const prompts = () => (lines(join(dataDir, "received.jsonl")) as unknown[]).map((entry: any) => {
    const content = entry?.message?.content ?? entry;
    return typeof content === "string" ? content : JSON.stringify(content);
  });
  const messages = async () => (await api("GET", `/api/threads/${bot.threadId}/messages?limit=200`)).messages as any[];
  const arg = (argv: string[], flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  return { server, api, bot, launched, prompts, messages, arg };
}

it("runs read-only experts for 5 rounds at most, keeps the run on one row, and ends with the leader's reply", async () => {
  const t = await fixture();
  try {
    const current = (await t.api("GET", "/api/bots")).bots.find((entry: any) => entry.id === t.bot.id).modelSelection;
    await t.api("PATCH", `/api/bots/${t.bot.id}`, { modelSelection: { ...current, auto: true, mode: "heavy" } });
    await t.api("POST", `/api/bots/${t.bot.id}/messages`, { threadId: t.bot.threadId, text: "What should we weigh before the firewall migration?" }, 202);

    // the leader's reply ends the turn
    await expect.poll(async () => (await t.messages()).some((m) => m.role === "bot" && m.turnTerminal), { timeout: 90_000 }).toBe(true);
    const rows = (await t.messages()).filter((m) => m.kind === "activity" && m.tool?.team);
    expect(rows).toHaveLength(1);
    const team = rows[0].tool.team;
    // the fake leader's plan does not read: three default personas
    expect(team.agents.map((agent: any) => agent.persona)).toEqual(["Skeptic", "Security", "User's advocate"]);
    expect(team.agents.map((agent: any) => [agent.status, agent.error])).toEqual([["done", undefined], ["done", undefined], ["done", undefined]]);
    // the fake never writes a verdict: no agreement, exactly 5 rounds, then the leader decides
    expect(team.rounds.map((round: any) => round.kind)).toEqual(["propose", "critique", "critique", "critique", "critique"]);
    expect(team.outcome).toBe("decided");
    for (const agent of team.agents) expect(agent.messages.length).toBe(5);
    expect(team.phase).toBe("done");
    expect(team.leader.steps.map((step: any) => step.kind)).toEqual(["planned", "sent", "processing", "decided", "writing"]);
    // the row sits before the leader's reply, after the person's message
    const all = await t.messages();
    const at = (predicate: (m: any) => boolean) => all.findIndex(predicate);
    expect(at((m) => m.role === "user")).toBeLessThan(at((m) => m.tool?.team));
    expect(at((m) => m.tool?.team)).toBeLessThan(at((m) => m.role === "bot" && m.turnTerminal));

    // the leader's prompt carries the team's notes; no expert's does
    const prompts = t.prompts();
    const withNotes = prompts.filter((prompt) => prompt.includes("Team of Experts (Heavy mode)"));
    expect(withNotes).toHaveLength(1);
    expect(withNotes[0]).toContain("### Expert 1, Skeptic (");
    expect(withNotes[0]).toContain("you decide");
    const proposals = prompts.filter((prompt) => prompt.includes("Round 1: propose"));
    expect(proposals).toHaveLength(3);
    expect(proposals.every((prompt) => prompt.includes("You only read and think") && prompt.includes("What should we weigh before the firewall migration?"))).toBe(true);

    // every expert's engine runs without a write tool, under a restricted MCP configuration; the leader keeps its own
    const launches = t.launched();
    // the plan and the three experts first, the leader's own turn last
    const helpers = launches.slice(0, -1);
    const leader = launches.at(-1)!;
    expect(helpers).toHaveLength(4);
    for (const launch of helpers) {
      const denied = String(t.arg(launch.argv, "--disallowedTools") ?? "").split(",");
      for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "WebFetch"]) expect(denied, tool).toContain(tool);
      expect(t.arg(launch.argv, "--permission-mode")).toBe("default");
      expect(launch.argv).toContain("--strict-mcp-config");
    }
    // the leader acts with the bot's own tools and level
    expect(String(t.arg(leader.argv, "--disallowedTools") ?? "").split(",")).not.toContain("Write");
    // seats: one account here, so its two strongest models
    expect(new Set(helpers.slice(1).map((launch) => t.arg(launch.argv, "--model"))).size).toBe(2);

    // the experts' threads are hidden: the person's list of the bot's threads names none
    const bots = (await t.api("GET", "/api/bots")).bots as any[];
    const tasks = bots.find((entry) => entry.id === t.bot.id).tasks as any[];
    expect(tasks.some((task) => /^Expert \d$|^Heavy plan$/.test(task.title))).toBe(false);
  } finally {
    await t.server.close();
  }
}, 180_000);

// M-20261123-040: "Heavy mode does not work". An expert's seat sat on a model
// its provider refuses (HTTP 403): the expert counted as one of the team,
// read "failed (HTTP 403)" and "Did not finish", and the person got less than
// the team they asked for. A refused seat is replaced by the next one, the
// refusal is told with its real cause, and it costs no wait.
it("a seat whose provider refuses (HTTP 403) is replaced, and the person reads the real cause", async () => {
  // an aggregator account: several vendors' models behind one key, as on the owner's capture
  const MODELS = ["nvidia/nemotron-3-ultra-550b-a55b", "qwen/qwen3-coder"];
  const refusing = new Set<string>();
  const asked: Array<{ model: string; status: number }> = [];
  const provider = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const headers: Record<string, string> = { connection: "close" };
      if (req.url === "/v1/models") {
        res.writeHead(200, { ...headers, "content-type": "application/json" }).end(JSON.stringify({ data: MODELS.map((id) => ({ id })) }));
        return;
      }
      if (req.url !== "/v1/chat/completions") { res.writeHead(404, headers).end(); return; }
      let model = "";
      try { model = String(JSON.parse(Buffer.concat(chunks).toString("utf8")).model ?? ""); } catch {}
      if (refusing.has(model)) {
        asked.push({ model, status: 403 });
        res.writeHead(403, { ...headers, "content-type": "application/json" }).end(JSON.stringify({ error: { message: "This model is not available on your plan." } }));
        return;
      }
      asked.push({ model, status: 200 });
      res.writeHead(200, { ...headers, "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `a plan from ${model}` }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  provider.keepAliveTimeout = 1;
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("fixture provider has no port");
  const t = await fixture((dataDir) => {
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.openrouter = { key: "synthetic-fixture-key" };
    config.instances = {
      ...config.instances,
      openrouter: { driver: "openai-compat", displayName: "OpenRouter", access: "api", config: { url: `http://127.0.0.1:${address.port}/v1`, key: "synthetic-fixture-key", managedModels: MODELS } },
    };
    writeFileSync(configPath, JSON.stringify(config));
  });
  try {
    await t.api("PATCH", `/api/bots/${t.bot.id}`, { modelSelection: { instanceId: "openrouter", model: MODELS[0], auto: true, mode: "heavy" } });
    // the seats Heavy offers this person: the account's strongest model leads, its second sits beside it
    const heavy = async () => (await t.api("GET", `/api/bots/${t.bot.id}/auto-model`)).modes.heavy as { pick: { model: string } | null; team?: Array<{ model: string; modelLabel: string }> };
    const offered = (await heavy()).team ?? [];
    const leader = (await heavy()).pick!.model;
    expect(offered.map((seat) => seat.model).toSorted()).toEqual(MODELS.toSorted());
    // the provider refuses every model but the leader's, as an aggregator does for models the plan does not include
    const refusedSeats = offered.filter((seat) => seat.model !== leader);
    for (const seat of refusedSeats) refusing.add(seat.model);
    const startedAt = Date.now();
    await t.api("POST", `/api/bots/${t.bot.id}/messages`, { threadId: t.bot.threadId, text: "What should we weigh before the firewall migration?" }, 202);
    await expect.poll(async () => (await t.messages()).some((m) => m.role === "bot" && m.turnTerminal), { timeout: 120_000 }).toBe(true);
    const elapsed = Date.now() - startedAt;
    const team = (await t.messages()).find((m) => m.kind === "activity" && m.tool?.team).tool.team;

    // the refusing model was really asked: the seat was offered and refused
    expect(asked.some((entry) => entry.status === 403)).toBe(true);
    // every expert of the team answered: a refused seat was replaced, never counted as an expert
    expect(team.agents.map((agent: any) => [agent.status, agent.error])).toEqual([["done", undefined], ["done", undefined], ["done", undefined]]);
    expect(team.agents.every((agent: any) => agent.messages.length > 0)).toBe(true);
    expect(team.agents.some((agent: any) => refusedSeats.some((seat) => seat.modelLabel === agent.modelLabel))).toBe(false);
    // the person reads who refused and why, as a cause their language words (never "Did not finish")
    expect(team.refusals.map((refusal: any) => refusal.modelLabel).toSorted()).toEqual(refusedSeats.map((seat) => seat.modelLabel).toSorted());
    for (const refusal of team.refusals) {
      expect(refusal).toMatchObject({ cause: "access", status: 403, engineLabel: "OpenRouter" });
      expect(refusal.detail).toContain("not available on your plan");
    }
    // each refused model was asked once: no second expert was sent to it
    expect(asked.filter((entry) => entry.status === 403)).toHaveLength(refusedSeats.length);
    // and Heavy no longer offers them to this person
    expect(((await heavy()).team ?? []).map((seat) => seat.model)).toEqual([leader]);
    // a refusal that came at once costs no wait
    expect(elapsed).toBeLessThan(60_000);
  } finally {
    await t.server.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
}, 180_000);
