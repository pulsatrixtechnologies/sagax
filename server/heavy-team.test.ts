// Heavy mode (#4901, rebuilt by #5089): the leader's plan, the seats, the
// rounds (proposals, cross critiques, agreement, 5 rounds at most), the
// leader's notes, the row's state, and the read-only confinement the server
// holds every expert to.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HEAVY_MAX_ROUNDS, heavyIsRunning, heavyThoughtMs } from "../shared/heavy-team.ts";
import type { HeavyTeamLine } from "../shared/heavy-team.ts";
import type { ModeModel } from "../shared/model-mode.ts";
import { allowsTool, narrowToolScope } from "../shared/tool-scope.ts";
import {
  DEFAULT_EXPERTS, HEAVY_EXPERT_REFUSAL, HeavyTeamTracker, assignSeats, conversationContext, createHeavyExpertFence, critiquePrompt,
  expertToolScope, heavyUsage, leaderNotes, parseTeamPlan, parseVerdict, planPrompt, proposePrompt, runRounds, sumUsage,
  type ExpertSeat, type HeavyAgentOutcome,
} from "./heavy-team.ts";

const seat = (instanceId: string, model: string, engineLabel = instanceId): ModeModel => ({ instanceId, model, engineLabel, modelLabel: model });
const experts = (count: number): ExpertSeat[] => DEFAULT_EXPERTS.slice(0, count).map((brief, index) => ({ ...brief, n: index + 1, seat: seat(`acct-${index}`, `model-${index}`) }));

let clock = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
});
afterEach(() => vi.useRealTimers());
const now = () => clock;
const tracker = (published: HeavyTeamLine[] = []) => new HeavyTeamTracker({ engineLabel: "Claude", modelLabel: "Claude Opus 5.5" }, (line) => published.push(line), now, 0);

describe("an expert cannot write: the server holds it read-only (#5089)", () => {
  const scope = expertToolScope();

  it("its conversation's tool scope keeps the reviewed reads and refuses every write tool", () => {
    // reads stay
    expect(allowsTool(scope, { kind: "mcp", server: "agents", name: "list_bots" })).toBe(true);
    expect(allowsTool(scope, { kind: "mcp", server: "agents", name: "session_search" })).toBe(true);
    expect(allowsTool(scope, { kind: "mcp", server: "perspicax", name: "memory_find" })).toBe(true);
    // writes, sends and actions are refused, whatever server offers them
    for (const name of ["send_message", "create_routine", "memory_save", "coordinate_bots", "call_connector", "run_with_engine", "propose_rule"]) {
      expect(allowsTool(scope, { kind: "mcp", server: "agents", name }), name).toBe(false);
    }
    for (const name of ["cw_psa_write", "cw_psa_update_ticket", "memory_save", "send_prompt", "voice_sms"]) {
      expect(allowsTool(scope, { kind: "mcp", server: "perspicax", name }), name).toBe(false);
    }
    expect(allowsTool(scope, { kind: "mcp", server: "computer", name: "click" })).toBe(false);
    expect(allowsTool(scope, { kind: "mcp", server: "mail", name: "send_mail" })).toBe(false);
  });

  it("narrowed on top of the bot's own selection it never widens it", () => {
    const bot = { allow: ["native:*", "mcp:agents:list_bots", "mcp:agents:send_message"] };
    const turn = narrowToolScope(bot, scope);
    expect(allowsTool(turn, { kind: "mcp", server: "agents", name: "list_bots" })).toBe(true);
    expect(allowsTool(turn, { kind: "mcp", server: "agents", name: "send_message" })).toBe(false);
    expect(allowsTool(turn, { kind: "mcp", server: "agents", name: "session_search" })).toBe(false);
  });

  it("a write tool's permission request from an expert is refused by the server, with no card", async () => {
    const respondToRequest = vi.fn(async () => "delivered");
    const decide = vi.fn();
    const fence = createHeavyExpertFence({ confines: (threadId) => threadId === "expert-1", adapter: () => ({ respondToRequest }), decide });
    const bot = { modelSelection: { instanceId: "claude" } };
    const refused = fence.answers({ threadId: "expert-1", requestId: 7, requestType: "permission", tool: "Write", summary: "Write notes.md" }, bot);
    expect(refused).toBe(true);
    expect(respondToRequest).toHaveBeenCalledWith("expert-1", 7, { behavior: "deny", message: HEAVY_EXPERT_REFUSAL });
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ threadId: "expert-1", tool: "Write", decision: "auto-denied", source: "heavy" }));
    // the person's own conversation is never fenced
    expect(fence.answers({ threadId: "person", requestId: 8, requestType: "permission", tool: "Write", summary: "x" }, bot)).toBe(false);
    expect(respondToRequest).toHaveBeenCalledTimes(1);
  });
});

describe("the leader stops at 5 rounds at most (D-20261119-085)", () => {
  const ask = (reply: (expert: ExpertSeat, round: number) => string) => {
    const rounds = new Map<number, number>();
    const fn = vi.fn(async (expert: ExpertSeat): Promise<HeavyAgentOutcome> => {
      const round = (rounds.get(expert.n) ?? 0) + 1;
      rounds.set(expert.n, round);
      return { status: "reply", text: reply(expert, round) };
    });
    return fn;
  };

  it("without agreement it runs exactly 5 rounds, then decides with the points still disputed", async () => {
    const line = tracker();
    const fn = ask((expert, round) => (round === 1 ? `plan of ${expert.persona}` : `critique\nVERDICT: DISAGREE: keep a backup; test first`));
    const result = await runRounds({ experts: experts(3), tracker: line, request: "Migrate the mail server.", ask: fn, maxRounds: 99 });
    expect(result.rounds).toBe(HEAVY_MAX_ROUNDS);
    expect(HEAVY_MAX_ROUNDS).toBe(5);
    expect(result.agreed).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3 * 5);
    expect(result.disagreements).toEqual(["keep a backup", "test first"]);
    expect(line.line.rounds.map((round) => round.kind)).toEqual(["propose", "critique", "critique", "critique", "critique"]);
    line.agentsDone(result);
    expect(line.line.outcome).toBe("decided");
    expect(line.line.disagreements).toEqual(["keep a backup", "test first"]);
    expect(leaderNotes(result)).toContain("you decide. Show the person the points still in dispute beside your plan");
  });

  it("stops at the first round where every expert agrees", async () => {
    const line = tracker();
    const fn = ask((_expert, round) => (round === 1 ? "my plan" : "looks right\nVERDICT: AGREE"));
    const result = await runRounds({ experts: experts(4), tracker: line, request: "Plan the office move.", ask: fn });
    expect(result.rounds).toBe(2);
    expect(result.agreed).toBe(true);
    expect(fn).toHaveBeenCalledTimes(4 * 2);
    expect(line.line.outcome).toBe("agreed");
    expect(line.line.rounds.at(-1)?.agreed).toBe(true);
    expect(leaderNotes(result)).toContain("They agreed on a plan after 2 rounds.");
  });

  it("round 1 proposes, a critique round shows each expert the others' latest words, never its own", async () => {
    const prompts: Array<[number, string]> = [];
    const result = await runRounds({
      experts: experts(3), tracker: tracker(), request: "Pick a backup tool.",
      ask: async (expert, prompt) => {
        prompts.push([expert.n, prompt]);
        return { status: "reply", text: prompt.includes("Round 1") ? `proposal ${expert.n}` : "VERDICT: AGREE" };
      },
    });
    expect(result.rounds).toBe(2);
    const second = prompts.filter(([, prompt]) => prompt.startsWith("Round 2"));
    expect(second).toHaveLength(3);
    const ofExpert1 = second.find(([n]) => n === 1)![1];
    expect(ofExpert1).toContain("proposal 2");
    expect(ofExpert1).toContain("proposal 3");
    expect(ofExpert1).not.toContain("proposal 1");
  });

  it("an expert that fails leaves the team; one left alone ends the rounds", async () => {
    const line = tracker();
    line.setTeam(experts(2));
    const result = await runRounds({
      experts: experts(2), tracker: line, request: "x",
      ask: async (expert) => (expert.n === 2 ? { status: "failed", text: "engine down" } : { status: "reply", text: "plan" }),
    });
    expect(result.rounds).toBe(1);
    expect(line.line.agents.find((agent) => agent.n === 2)).toMatchObject({ status: "failed", error: "engine down" });
    expect(result.finals.find((final) => final.n === 1)).toMatchObject({ ok: true, text: "plan" });
  });

  it("a Stop ends the rounds at once", async () => {
    let stop = false;
    const fn = vi.fn(async (): Promise<HeavyAgentOutcome> => {
      stop = true;
      return { status: "reply", text: "plan" };
    });
    const result = await runRounds({ experts: experts(3), tracker: tracker(), request: "x", ask: fn, cancelled: () => stop });
    expect(result.rounds).toBe(1);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("the leader's plan (D-20261119-084)", () => {
  it("asks for 2 to 5 experts with a persona each, as JSON", () => {
    const prompt = planPrompt({ request: "Audit our firewall rules.", seats: 5 });
    expect(prompt).toContain("2 to 5");
    expect(prompt).toContain("\"persona\"");
    expect(prompt.endsWith("The request:\nAudit our firewall rules.")).toBe(true);
  });

  it("reads the leader's choice, between 2 and 5", () => {
    const four = parseTeamPlan('Sure: {"experts":[{"persona":"Skeptic","focus":"a"},{"persona":"Network","focus":"b"},{"persona":"Cost","focus":"c"},{"persona":"Ops","focus":"d"}]}');
    expect(four.map((brief) => brief.persona)).toEqual(["Skeptic", "Network", "Cost", "Ops"]);
    const seven = parseTeamPlan(JSON.stringify({ experts: Array.from({ length: 7 }, (_, i) => ({ persona: `P${i}`, focus: "" })) }));
    expect(seven).toHaveLength(5);
    const one = parseTeamPlan('{"experts":[{"persona":"Lawyer","focus":"contracts"}]}');
    expect(one.length).toBeGreaterThanOrEqual(2);
    expect(one[0]!.persona).toBe("Lawyer");
  });

  it("falls back on three default personas when the reply does not read", () => {
    expect(parseTeamPlan("hello from fake claude").map((brief) => brief.persona)).toEqual(["Skeptic", "Security", "User's advocate"]);
    expect(parseTeamPlan("{not json}")).toHaveLength(3);
  });
});

describe("the seats: different accounts first, then different models", () => {
  const pool = [seat("claude-a", "opus"), seat("claude-b", "opus"), seat("codex", "gpt"), seat("claude-a", "sonnet"), seat("claude-b", "sonnet")];

  it("gives each expert another account while there is one, then another model", () => {
    expect(assignSeats(pool, 3).map((one) => one.instanceId)).toEqual(["claude-a", "claude-b", "codex"]);
    expect(assignSeats(pool, 5).map((one) => `${one.instanceId}/${one.model}`)).toEqual(["claude-a/opus", "claude-b/opus", "codex/gpt", "claude-a/sonnet", "claude-b/sonnet"]);
  });

  it("shares the seats in turn when there are fewer than experts", () => {
    expect(assignSeats([seat("local", "qwen")], 3).map((one) => one.model)).toEqual(["qwen", "qwen", "qwen"]);
    expect(assignSeats([], 3)).toEqual([]);
  });
});

describe("what an expert is asked and how its verdict reads", () => {
  const [expert] = experts(1);

  it("round 1 names the expert's persona and focus, says it only reads, and carries the request", () => {
    const prompt = proposePrompt({ expert: expert!, count: 3, request: "  Plan the migration.  ", context: "Person: hi" });
    expect(prompt).toContain('Expert 1 of 3, "Skeptic"');
    expect(prompt).toContain("You only read and think");
    expect(prompt).toContain("The conversation so far:\nPerson: hi");
    expect(prompt.endsWith("The request:\nPlan the migration.")).toBe(true);
  });

  it("a critique asks for the verdict on the last line", () => {
    const prompt = critiquePrompt({ round: 3, maxRounds: 5, others: [{ n: 2, persona: "Cost", text: "cheap plan" }] });
    expect(prompt).toContain("Round 3 of at most 5");
    expect(prompt).toContain("### Expert 2 (Cost)\ncheap plan");
    expect(prompt).toContain("VERDICT: AGREE");
  });

  it("reads AGREE and DISAGREE with its points; no verdict is no agreement", () => {
    expect(parseVerdict("Fine.\nVERDICT: AGREE")).toEqual({ agrees: true, points: [], text: "Fine." });
    expect(parseVerdict("No.\n**Verdict:** disagree: rollback plan; cost")).toMatchObject({ agrees: false, points: ["rollback plan", "cost"], text: "No." });
    expect(parseVerdict("just text")).toEqual({ agrees: false, points: [], text: "just text" });
  });

  it("reads the last few text lines of the conversation, clipped", () => {
    const lines = [{ role: "user", kind: "text", text: "old" }, { role: "bot", kind: "activity", text: "a tool row" }, { role: "user", kind: "text", text: "x".repeat(2_000) }];
    const out = conversationContext(lines, 2, 50).split("\n");
    expect(out).toEqual(["Person: old", `Person: ${"x".repeat(49)}…`]);
  });
});

describe("the leader's notes", () => {
  it("tells the leader to act once itself, the experts having taken no action", () => {
    const notes = leaderNotes({ rounds: 2, agreed: true, disagreements: [], finals: [{ n: 1, persona: "Skeptic", modelLabel: "Opus", text: "Do A.", ok: true }] });
    expect(notes).toContain("## Team of Experts (Heavy mode)");
    expect(notes).toContain("### Expert 1, Skeptic (Opus)\nDo A.");
    expect(notes).toContain("carry it out ONCE now, yourself, with your usual tools and approvals");
  });

  it("with nothing usable tells the leader to act alone", () => {
    expect(leaderNotes({ rounds: 1, agreed: false, disagreements: [], finals: [{ n: 1, persona: "x", modelLabel: "m", text: "", ok: false }] }))
      .toContain("none of them came back with anything usable");
  });
});

describe("the row's state", () => {
  it("plans, sets the team, marks who speaks and each verdict, then the leader writes", () => {
    const published: HeavyTeamLine[] = [];
    const line = tracker(published);
    expect(line.line.phase).toBe("planning");
    line.setTeam(experts(2));
    expect(line.line.agents.map((agent) => agent.persona)).toEqual(["Skeptic", "Security"]);
    expect(line.line.leader.steps.map((step) => step.kind)).toEqual(["planned", "sent", "processing"]);
    line.roundStart(1, "propose");
    line.speaking(1, true);
    expect(published.at(-1)!.agents[0]!.speaking).toBe(true);
    line.speaking(1, false);
    line.settle(1, "plan");
    line.settle(1, "plan");
    expect(line.line.agents[0]!.messages).toEqual(["plan"]);
    line.roundEnd(1, false);
    line.verdict(2, true);
    clock += 8_000;
    line.agentsDone({ agreed: true, rounds: 2, disagreements: [] });
    expect(line.line.phase).toBe("leader");
    expect(heavyThoughtMs(line.line, clock, true)).toBe(8_000);
    line.leaderStarted();
    expect(line.line.phase).toBe("done");
    expect(heavyIsRunning(line.line, true)).toBe(false);
  });

  it("a stopped run stops what still works and closes the open round", () => {
    const line = tracker();
    line.setTeam(experts(2));
    line.roundStart(1, "propose");
    line.stop();
    expect(line.line.phase).toBe("stopped");
    expect(line.line.agents.every((agent) => agent.status === "stopped")).toBe(true);
    expect(line.line.rounds[0]!.endedAt).toBeDefined();
  });
});

describe("Heavy's cost reads in the leader's turn", () => {
  it("sums the experts' usage and hands it once to the leader's turn", () => {
    const total = sumUsage([{ input: 100, output: 20, cachedInput: 50, costUsd: 0.5 }, { input: 10, output: 2, costUsd: null }, undefined]);
    expect(total).toEqual({ input: 110, output: 22, cachedInput: 50, costUsd: 0.5 });
    heavyUsage.carry("thread-1", total);
    expect(heavyUsage.take("thread-1")).toEqual(total);
    expect(heavyUsage.take("thread-1")).toBeUndefined();
  });
});
