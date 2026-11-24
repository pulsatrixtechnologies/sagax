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
  SeatBench, askOnSeats, expertToolScope, heavyUsage, leaderNotes, parseTeamPlan, parseVerdict, planPrompt, proposePrompt, readRefusal, refusalLasts,
  runRounds, sumUsage,
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
    const notes = leaderNotes({ rounds: 2, agreed: true, disagreements: [], unseated: [], finals: [{ n: 1, persona: "Skeptic", modelLabel: "Opus", text: "Do A.", ok: true }] });
    expect(notes).toContain("## Team of Experts (Heavy mode)");
    expect(notes).toContain("### Expert 1, Skeptic (Opus)\nDo A.");
    expect(notes).toContain("carry it out ONCE now, yourself, with your usual tools and approvals");
  });

  it("with nothing usable tells the leader to act alone", () => {
    expect(leaderNotes({ rounds: 1, agreed: false, disagreements: [], unseated: [], finals: [{ n: 1, persona: "x", modelLabel: "m", text: "", ok: false }] }))
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

// M-20261123-040: "Heavy mode does not work": seats on models the provider
// refuses (HTTP 403) counted as experts that failed.
describe("a seat that refuses is replaced by the next one (M-20261123-040)", () => {
  const FORBIDDEN = "Upstream HTTP 403: This model is not available on your plan. No tool calls were seen before it stopped.";
  const pool = [seat("router", "strong", "Router"), seat("router", "coder", "Router"), seat("claude", "opus", "Claude")];

  it("reads the real cause of a refusal: the status, the provider's own words, and what kind it is", () => {
    expect(readRefusal(FORBIDDEN)).toEqual({ cause: "access", status: 403, detail: "This model is not available on your plan" });
    expect(readRefusal("Upstream HTTP 401: Incorrect API key provided")).toMatchObject({ cause: "access", status: 401 });
    expect(readRefusal("Upstream HTTP 402: Payment required")).toMatchObject({ cause: "credits", status: 402 });
    expect(readRefusal("Upstream HTTP 429: Rate limit reached")).toMatchObject({ cause: "limit", status: 429 });
    expect(readRefusal("Upstream HTTP 404: The model `coder` does not exist")).toMatchObject({ cause: "model", status: 404 });
    expect(readRefusal("Upstream HTTP 503: upstream connect error")).toMatchObject({ cause: "unavailable", status: 503 });
    expect(readRefusal("could not open a read-only thread for this expert")).toEqual({ cause: "other", detail: "could not open a read-only thread for this expert" });
    // what another try will not change is remembered; a limit or an outage is not
    expect([FORBIDDEN, "Upstream HTTP 402: Payment required", "Upstream HTTP 429: Rate limit reached", "Upstream HTTP 503: down"].map((text) => refusalLasts(readRefusal(text))))
      .toEqual([true, true, false, false]);
  });

  it("the bench gives the seat the fewest experts hold, never one that refused, the leader's own last", () => {
    const leader = seat("claude", "fable", "Claude");
    const bench = new SeatBench(pool, leader);
    bench.refuse(pool[1]!);
    expect(bench.hasRefused(pool[1]!)).toBe(true);
    // nobody sits yet: the pool's order, strongest first
    expect(bench.next([])).toBe(pool[0]);
    // the free seat before a shared one
    expect(bench.next([pool[0]!])).toBe(pool[2]);
    expect(bench.next([pool[0]!, pool[2]!])).toEqual(leader);
    for (const taken of [pool[0]!, pool[2]!, leader]) bench.refuse(taken);
    expect(bench.next([])).toBeNull();
  });

  it("the expert goes on on the next seat and the refusal costs no wait", async () => {
    const bench = new SeatBench(pool);
    const expert: ExpertSeat = { ...DEFAULT_EXPERTS[0]!, n: 2, seat: pool[1]! };
    const asked: Array<[string, string, boolean]> = [];
    const refusals: unknown[] = [];
    const outcome = await askOnSeats({
      expert, prompt: "round prompt", fresh: () => `fresh for ${expert.seat.model}`, bench, held: () => [pool[0]!],
      ask: async (on, prompt, moved) => {
        asked.push([on.model, prompt, moved]);
        return on.model === "coder" ? { status: "failed", text: FORBIDDEN } : { status: "reply", text: "plan" };
      },
      onRefusal: (from, refusal, to) => refusals.push([from.model, refusal?.cause, to?.model]),
    });
    expect(outcome).toEqual({ status: "reply", text: "plan" });
    // the same round is asked again at once, written for a conversation that starts on the new seat
    expect(asked).toEqual([["coder", "round prompt", false], ["opus", "fresh for opus", true]]);
    expect(refusals).toEqual([["coder", "access", "opus"]]);
    expect(expert.seat).toBe(pool[2]);
    expect(bench.hasRefused(pool[1]!)).toBe(true);
  });

  it("a seat that already refused another expert of the run is not asked again", async () => {
    const bench = new SeatBench(pool);
    bench.refuse(pool[1]!);
    const expert: ExpertSeat = { ...DEFAULT_EXPERTS[0]!, n: 3, seat: pool[1]! };
    const asked: string[] = [];
    await askOnSeats({
      expert, prompt: "p", fresh: () => "f", bench, held: () => [],
      ask: async (on) => { asked.push(on.model); return { status: "reply", text: "plan" }; },
      onRefusal: () => {},
    });
    expect(asked).toEqual(["strong"]);
  });

  it("no answer in time is not a refusal: the expert keeps its seat and fails saying so", async () => {
    const bench = new SeatBench(pool);
    const expert: ExpertSeat = { ...DEFAULT_EXPERTS[0]!, n: 1, seat: pool[0]! };
    const ask = vi.fn(async (): Promise<HeavyAgentOutcome> => ({ status: "timeout", text: "" }));
    expect(await askOnSeats({ expert, prompt: "p", fresh: () => "f", bench, held: () => [], ask, onRefusal: () => { throw new Error("not a refusal"); } })).toEqual({ status: "timeout", text: "" });
    expect(ask).toHaveBeenCalledTimes(1);
    const line = tracker();
    line.setTeam([expert, { ...DEFAULT_EXPERTS[1]!, n: 2, seat: pool[2]! }]);
    await runRounds({ experts: [expert, { ...DEFAULT_EXPERTS[1]!, n: 2, seat: pool[2]! }], tracker: line, request: "x", ask: async (one) => (one.n === 1 ? { status: "timeout", text: "" } : { status: "reply", text: "plan" }) });
    expect(line.line.agents[0]).toMatchObject({ status: "failed", cause: "timeout" });
    expect(line.line.agents[0]!.error).toBeUndefined();
  });

  it("with every seat refused the expert leaves the team: it is not an expert that failed", async () => {
    const team: ExpertSeat[] = [{ ...DEFAULT_EXPERTS[0]!, n: 1, seat: pool[0]! }, { ...DEFAULT_EXPERTS[1]!, n: 2, seat: pool[1]! }, { ...DEFAULT_EXPERTS[2]!, n: 3, seat: pool[2]! }];
    const line = tracker();
    line.setTeam(team);
    const bench = new SeatBench([pool[1]!]);
    const result = await runRounds({
      experts: team, tracker: line, request: "x", maxRounds: 1,
      ask: (expert, prompt, _hooks, fresh) => (expert.n === 2
        ? askOnSeats({ expert, prompt, fresh, bench, held: () => [], ask: async () => ({ status: "failed", text: FORBIDDEN }), onRefusal: (from, refusal, to) => line.refused(expert.n, from, refusal, to) })
        : Promise.resolve({ status: "reply", text: "plan" })),
    });
    expect(line.line.agents.map((agent) => agent.n)).toEqual([1, 3]);
    expect(result.unseated).toEqual([2]);
    expect(result.finals.map((final) => final.n)).toEqual([1, 3]);
    expect(line.line.refusals).toEqual([{ n: 2, persona: "Security", engineLabel: "Router", modelLabel: "coder", cause: "access", status: 403, detail: "This model is not available on your plan" }]);
    // the leader is told the team it really had
    expect(leaderNotes(result)).toContain("2 read-only experts");
    expect(leaderNotes({ rounds: 1, agreed: false, disagreements: [], finals: [], unseated: [1, 2] })).toContain("no expert could run");
  });

  it("the row names who refused, why, and the seat the expert took; a seat is told once", () => {
    const published: HeavyTeamLine[] = [];
    const line = tracker(published);
    line.setTeam(experts(2));
    const refusal = readRefusal(FORBIDDEN);
    line.refused(2, seat("router", "coder", "Router"), refusal, seat("claude", "opus", "Claude"));
    line.refused(1, seat("router", "coder", "Router"), refusal, seat("claude", "opus", "Claude"));
    line.refused(1, seat("router", "coder", "Router"), null, seat("claude", "opus", "Claude"));
    const last = published.at(-1)!;
    expect(last.refusals).toEqual([{ n: 2, persona: "Security", engineLabel: "Router", modelLabel: "coder", cause: "access", status: 403, detail: "This model is not available on your plan", replacedBy: { engineLabel: "Claude", modelLabel: "opus" } }]);
    expect(last.agents.map((agent) => [agent.status, agent.engineLabel, agent.modelLabel])).toEqual([["working", "Claude", "opus"], ["working", "Claude", "opus"]]);
  });

  it("moved in a critique round, the expert is told who it is, the request and its own plan so far", async () => {
    const team: ExpertSeat[] = [{ ...DEFAULT_EXPERTS[0]!, n: 1, seat: pool[0]! }, { ...DEFAULT_EXPERTS[1]!, n: 2, seat: pool[1]! }];
    const line = tracker();
    line.setTeam(team);
    const fresh: string[] = [];
    await runRounds({
      experts: team, tracker: line, request: "Plan the cutover", maxRounds: 2,
      ask: async (expert, _prompt, _hooks, again) => {
        if (expert.n === 2) fresh.push(again());
        return { status: "reply", text: `plan of ${expert.n}\nVERDICT: AGREE` };
      },
    });
    expect(fresh[1]).toContain('You are Expert 2 of 2, "Security"');
    expect(fresh[1]).toContain("Plan the cutover");
    expect(fresh[1]).toContain("Your own plan so far:\nplan of 2");
    expect(fresh[1]).toContain("Round 2 of at most 2");
  });
});
