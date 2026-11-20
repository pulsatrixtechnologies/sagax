// Heavy mode (#4901, rebuilt by #5089) end to end through the real server and
// the fake Claude CLI: a person's turn on a Heavy bot asks the leader for its
// team, opens one hidden read-only thread per expert, runs the rounds (the
// fake never agrees: exactly 5 rounds, then the leader decides), keeps the
// whole run on one row of the conversation, hands the leader the team's
// notes, and ends with the leader's ordinary reply. Every expert's engine
// is launched without a write tool, under a restricted MCP configuration.
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
