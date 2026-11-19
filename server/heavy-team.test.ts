// Heavy mode (#4901): the team's prompts, the Leader's notes and the row's state.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HeavyTeamLine } from "../shared/heavy-team.ts";
import { heavyIsRunning, heavyThoughtMs } from "../shared/heavy-team.ts";
import type { ModeModel } from "../shared/model-mode.ts";
import {
  HEAVY_ANGLES, HeavyTeamTracker, agentPrompt, angleOf, conversationContext, leaderNotes, runAgents,
  type HeavyAgentOutcome,
} from "./heavy-team.ts";

const model = (engineLabel: string, modelLabel: string): ModeModel => ({ instanceId: engineLabel.toLowerCase(), model: modelLabel, engineLabel, modelLabel });
const team = [model("OpenAI", "GPT-6 Astra"), model("Claude", "Claude Opus 5.5"), model("Grok", "Grok 4.7")];

let clock = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
});
afterEach(() => vi.useRealTimers());
const now = () => clock;

describe("what an agent is asked", () => {
  it("gives each agent its own angle, cycling when the team is larger than the list", () => {
    expect(new Set([1, 2, 3, 4, 5].map(angleOf)).size).toBe(HEAVY_ANGLES.length);
    expect(angleOf(HEAVY_ANGLES.length + 1)).toBe(angleOf(1));
  });

  it("is the bot's own words to the Leader, takes no outward action, and carries the request and the conversation", () => {
    const prompt = agentPrompt({ n: 2, count: 3, modelLabel: "Claude Opus 5.5", request: "  Plan the migration.  ", context: "Person: hi\nYou: hello" });
    expect(prompt).toContain("Agent 2 of 3");
    expect(prompt).toContain("on Claude Opus 5.5");
    expect(prompt).toContain(angleOf(2));
    expect(prompt).toContain("Do not take outward actions");
    expect(prompt).toContain("Address the Leader, not the person.");
    expect(prompt).toContain("The conversation so far:\nPerson: hi\nYou: hello");
    expect(prompt.endsWith("The request:\nPlan the migration.")).toBe(true);
    expect(agentPrompt({ n: 1, count: 3, modelLabel: "x", request: "q" })).not.toContain("The conversation so far");
  });

  it("reads the last few text lines of the conversation, clipped", () => {
    const lines = [
      { role: "user", kind: "text", text: "old" },
      ...Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? "bot" : "user", kind: "text", text: `line ${i}` })),
      { role: "bot", kind: "activity", text: "a tool row" },
      { role: "user", kind: "text", text: "x".repeat(2_000) },
    ];
    const out = conversationContext(lines, 3, 50).split("\n");
    expect(out).toHaveLength(3);
    expect(out.slice(0, 2)).toEqual(["Person: line 6", "You: line 7"]);
    expect(out[2]).toMatch(/^Person: x{49}…$/);
    expect(out.join("\n")).not.toContain("tool row");
  });
});

describe("the Leader's notes", () => {
  const done = (n: number, text: string) => ({ n, modelLabel: team[n - 1]!.modelLabel, status: "done" as const, text });

  it("hands the Leader every agent's findings, labelled, and what is left to it", () => {
    const notes = leaderNotes([done(1, "Do A."), done(2, "Do B."), done(3, "Do C.")]);
    expect(notes).toContain("## Team of Experts (Heavy mode)");
    expect(notes).toContain("3 agents worked on their request in parallel");
    expect(notes).toContain("### Agent 1 (GPT-6 Astra)\nDo A.");
    expect(notes).toContain("### Agent 3 (Grok 4.7)\nDo C.");
    expect(notes).toContain("ONE final answer");
    expect(notes).toContain("The agents took no action");
  });

  it("leaves a failed agent out and says how many did not finish", () => {
    const notes = leaderNotes([done(1, "Do A."), { n: 2, modelLabel: "Claude Opus 5.5", status: "failed", text: "boom" }, done(3, "")]);
    expect(notes).toContain("### Agent 1");
    expect(notes).not.toContain("### Agent 2");
    expect(notes).not.toContain("boom");
    expect(notes).toContain("2 of them did not finish.");
  });

  it("with nothing usable tells the Leader to answer alone", () => {
    const notes = leaderNotes([{ n: 1, modelLabel: "x", status: "failed", text: "e" }, { n: 2, modelLabel: "y", status: "stopped", text: "" }]);
    expect(notes).toContain("none of them came back with anything usable");
    expect(notes).toContain("Answer the request yourself");
    expect(notes).not.toContain("###");
  });

  it("keeps the notes inside a budget however long the agents wrote", () => {
    const notes = leaderNotes([1, 2, 3, 4, 5].map((n) => ({ n, modelLabel: "m", status: "done" as const, text: "y".repeat(50_000) })));
    expect(notes.length).toBeLessThan(26_000);
  });
});

describe("the row's state", () => {
  const make = () => {
    const published: HeavyTeamLine[] = [];
    const tracker = new HeavyTeamTracker(team, team[0]!, (line) => published.push(line), now, 400);
    return { tracker, published };
  };

  it("starts with every agent working and the Leader's first two steps", () => {
    const { tracker } = make();
    expect(tracker.line.phase).toBe("agents");
    expect(tracker.line.agents.map((agent) => [agent.n, agent.status, agent.modelLabel])).toEqual([[1, "working", "GPT-6 Astra"], [2, "working", "Claude Opus 5.5"], [3, "working", "Grok 4.7"]]);
    expect(tracker.line.leader.steps.map((step) => step.kind)).toEqual(["sent", "processing"]);
    expect(tracker.line.leader.modelLabel).toBe("GPT-6 Astra");
  });

  it("folds a streaming message into the agent's messages when it ends, and keeps the order", () => {
    const { tracker } = make();
    tracker.delta(1, "Thin");
    tracker.delta(1, "king…");
    expect(tracker.line.agents[0]).toMatchObject({ live: "Thinking…", messages: [] });
    tracker.message(1, "First finding.");
    expect(tracker.line.agents[0]!.live).toBeUndefined();
    tracker.message(1, "Second finding.");
    expect(tracker.line.agents[0]!.messages).toEqual(["First finding.", "Second finding."]);
    tracker.message(1, "   ");
    expect(tracker.line.agents[0]!.messages).toHaveLength(2);
  });

  it("keeps the record small: a long message is clipped and an agent keeps a bounded number", () => {
    const { tracker } = make();
    for (let i = 0; i < 30; i++) tracker.message(2, `m${i} ${"z".repeat(9_000)}`);
    expect(tracker.line.agents[1]!.messages).toHaveLength(12);
    expect(tracker.line.agents[1]!.messages[0]!.length).toBeLessThanOrEqual(4_000);
  });

  it("publishes at most every 400 ms while text streams, the last state always", () => {
    const { tracker, published } = make();
    tracker.delta(1, "a");
    expect(published).toHaveLength(1);
    clock += 100;
    tracker.delta(1, "b");
    tracker.delta(1, "c");
    expect(published).toHaveLength(1);
    clock += 300;
    vi.advanceTimersByTime(300);
    expect(published).toHaveLength(2);
    expect(published.at(-1)!.agents[0]!.live).toBe("abc");
  });

  it("agentsDone moves to the Leader's phase, stamps the thought time and adds the writing step", () => {
    const { tracker, published } = make();
    clock += 6_000;
    for (const n of [1, 2, 3]) tracker.finish(n, "done");
    tracker.agentsDone();
    expect(published.at(-1)).toMatchObject({ phase: "leader", thoughtEndedAt: 1_006_000 });
    expect(published.at(-1)!.leader.steps.map((step) => step.kind)).toEqual(["sent", "processing", "writing"]);
    expect(heavyThoughtMs(published.at(-1)!, clock + 99_000, true)).toBe(6_000);
    tracker.leaderStarted();
    expect(published.at(-1)!.phase).toBe("done");
  });

  it("a stopped run stops what still works and never reads as done", () => {
    const { tracker, published } = make();
    tracker.finish(1, "done");
    tracker.stop();
    expect(published.at(-1)!.agents.map((agent) => agent.status)).toEqual(["done", "stopped", "stopped"]);
    expect(published.at(-1)!.phase).toBe("stopped");
    tracker.leaderStarted();
    expect(tracker.line.phase).toBe("stopped");
  });

  it("reads as running only while the chat's turn works and the run is not over", () => {
    const { tracker } = make();
    expect(heavyIsRunning(tracker.line, true)).toBe(true);
    expect(heavyIsRunning(tracker.line, false)).toBe(false);
    tracker.agentsDone();
    expect(heavyIsRunning(tracker.line, true)).toBe(true);
    tracker.leaderStarted();
    expect(heavyIsRunning(tracker.line, true)).toBe(false);
  });
});

describe("running the agents", () => {
  const ok = (text: string): HeavyAgentOutcome => ({ status: "reply", text });

  it("runs every agent at once, not one after the other", async () => {
    const tracker = new HeavyTeamTracker(team, team[0]!, () => {}, now);
    const started: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const running = runAgents({ team, tracker, runAgent: async (_agent, n) => { started.push(n); await gate; return ok(`found ${n}`); } });
    await Promise.resolve();
    expect(started).toEqual([1, 2, 3]);
    release();
    expect((await running).map((result) => result.text)).toEqual(["found 1", "found 2", "found 3"]);
    expect(tracker.line.agents.map((agent) => agent.status)).toEqual(["done", "done", "done"]);
  });

  it("an agent that fails or throws is a failed agent, the others finish", async () => {
    const tracker = new HeavyTeamTracker(team, team[0]!, () => {}, now);
    const results = await runAgents({
      team, tracker,
      runAgent: async (_agent, n) => {
        if (n === 2) throw new Error("engine refused");
        if (n === 3) return { status: "timeout", text: "partial" };
        return ok("fine");
      },
    });
    expect(results.map((result) => result.status)).toEqual(["done", "failed", "failed"]);
    expect(tracker.line.agents.map((agent) => [agent.status, agent.error])).toEqual([["done", undefined], ["failed", "engine refused"], ["failed", "partial"]]);
  });

  it("shows the reply of an engine that only reports it when the turn ends, and the live messages of one that streams", async () => {
    const tracker = new HeavyTeamTracker(team, team[0]!, () => {}, now);
    await runAgents({
      team: team.slice(0, 2), tracker,
      runAgent: async (_agent, n, hooks) => {
        if (n === 1) { hooks.onDelta("wri"); hooks.onMessage("Streamed finding."); return ok("Streamed finding."); }
        return ok("Reply at the end.");
      },
    });
    expect(tracker.line.agents[0]!.messages).toEqual(["Streamed finding."]);
    expect(tracker.line.agents[1]!.messages).toEqual(["Reply at the end."]);
  });
});
