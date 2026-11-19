// Heavy mode (#4901) end to end through the real server and the fake Claude
// CLI: a person's turn on a Heavy bot opens one hidden thread per agent of the
// Team of Experts (several agents on the strongest model, with one provider),
// keeps the whole run on one row of the conversation, hands the Leader what
// the agents found, and ends with the Leader's ordinary reply.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";

async function fixture() {
  const server = await launchVerificationServer();
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

it("runs the agents in hidden threads, keeps the run on one row, and ends with the Leader's reply", async () => {
  const t = await fixture();
  try {
    const current = (await t.api("GET", "/api/bots")).bots.find((entry: any) => entry.id === t.bot.id).modelSelection;
    await t.api("PATCH", `/api/bots/${t.bot.id}`, { modelSelection: { ...current, auto: true, mode: "heavy" } });
    await t.api("POST", `/api/bots/${t.bot.id}/messages`, { threadId: t.bot.threadId, text: "What should we weigh before the firewall migration?" }, 202);

    // the Leader's reply ends the turn
    await expect.poll(async () => (await t.messages()).some((m) => m.role === "bot" && m.turnTerminal), { timeout: 40_000 }).toBe(true);
    const rows = (await t.messages()).filter((m) => m.kind === "activity" && m.tool?.team);
    expect(rows).toHaveLength(1);
    const team = rows[0].tool.team;
    expect(team.agents).toHaveLength(3);
    expect(team.agents.map((agent: any) => [agent.status, agent.error])).toEqual([["done", undefined], ["done", undefined], ["done", undefined]]);
    for (const agent of team.agents) expect(agent.messages.length).toBeGreaterThan(0);
    expect(team.phase).toBe("done");
    expect(team.thoughtEndedAt).toBeGreaterThanOrEqual(team.startedAt);
    expect(team.leader.steps.map((step: any) => step.kind)).toEqual(["sent", "processing", "writing"]);
    // the row sits before the Leader's reply, after the person's message
    const all = await t.messages();
    const at = (predicate: (m: any) => boolean) => all.findIndex(predicate);
    expect(at((m) => m.role === "user")).toBeLessThan(at((m) => m.tool?.team));
    expect(at((m) => m.tool?.team)).toBeLessThan(at((m) => m.role === "bot" && m.turnTerminal));

    // three agents and the Leader, all on the strongest model; agents a step lighter than the Leader
    const launches = t.launched();
    expect(launches).toHaveLength(4);
    const models = new Set(launches.map((launch) => t.arg(launch.argv, "--model")));
    expect(models.size).toBe(1);
    const efforts = launches.map((launch) => t.arg(launch.argv, "--effort")).toSorted();
    expect(efforts).toEqual(["high", "medium", "medium", "medium"]);
    // the Leader's prompt carries the team's notes; no agent's does
    const prompts = t.prompts();
    expect(prompts).toHaveLength(4);
    const withNotes = prompts.filter((prompt) => prompt.includes("Team of Experts (Heavy mode)"));
    expect(withNotes).toHaveLength(1);
    expect(withNotes[0]).toContain("### Agent 1 (");
    // an agent's own prompt names its angle and takes no outward action
    const agentPrompts = prompts.filter((prompt) => prompt.includes("You are Agent "));
    expect(agentPrompts).toHaveLength(3);
    expect(agentPrompts.every((prompt) => prompt.includes("Do not take outward actions") && prompt.includes("What should we weigh before the firewall migration?"))).toBe(true);

    // the agents' threads are hidden: the person's list of the bot's threads names none
    const bots = (await t.api("GET", "/api/bots")).bots as any[];
    const tasks = bots.find((entry) => entry.id === t.bot.id).tasks as any[];
    expect(tasks.some((task) => /^Agent \d$/.test(task.title))).toBe(false);
  } finally {
    await t.server.close();
  }
}, 120_000);
