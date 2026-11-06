// The Mastery tier on the server (achievements-mastery.ts and the store in
// achievements.ts): what frames and requests mean, the facts counted once
// and only from the server, the nightly pass, and a locked look refused.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAchievementStore } from "./achievements.ts";
import {
  integrationOfTool,
  lockedLookChange,
  masteryDelegationFacts,
  masteryFrameFacts,
  masteryRequestFacts,
  masterySendFacts,
  modelFamily,
  skillOfTool,
  threadCensus,
  toolWrites,
  type FrameLookups,
} from "./achievements-mastery.ts";
import { masteryKey } from "../../shared/mascot-unlocks.ts";
import { ACHIEVEMENTS, achievementById } from "../../shared/achievements-catalog.ts";
import { newlyEarned, ruleStatus } from "../../shared/achievements.ts";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";
const DAY = 86_400_000;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-mastery-"));
  let clock = Date.parse("2026-10-01T15:00:00Z");
  const store = createAchievementStore({ dataDir: dir, now: () => clock, persistDelayMs: 0 });
  return { dir, store, tick: (ms: number) => (clock += ms) };
}

const lookups: FrameLookups = {
  threadPerson: (threadId) => (threadId.startsWith("t") ? ADA : null),
  threadBot: () => "b1",
  threadModel: () => "claude-sonnet-4-5",
  autoCheaper: (threadId) => (threadId === "t-auto" ? true : null),
  routine: (_id, run) => ({ person: typeof run.runAs === "string" ? run.runAs : ADA, botId: "b1", continuity: true }),
};

describe("what the server's frames mean", () => {
  it("reads a routine run that ended, and only one that ended", () => {
    expect(masteryFrameFacts({ kind: "routine.run", run: { id: "run1", routineId: "r1", status: "running" } }, lookups)).toEqual([]);
    expect(masteryFrameFacts({ kind: "routine.run", run: { id: "run1", routineId: "r1", status: "completed", runAs: BOB } }, lookups)).toEqual([
      { person: BOB, id: "run:run1", fact: { kind: "routine.outcome", routineId: "r1", ok: true, continuity: true, botId: "b1" } },
    ]);
    expect(masteryFrameFacts({ kind: "routine.run", run: { id: "run2", routineId: "r1", status: "missed" } }, lookups)[0]!.fact).toMatchObject({ ok: false });
  });

  it("reads turns from the runtime events, with the model family and Auto's pick", () => {
    expect(masteryFrameFacts({ kind: "runtime", event: { type: "turn.started", threadId: "t1" } }, lookups)).toEqual([{ person: ADA, fact: { kind: "turn.started", threadId: "t1", botId: "b1" } }]);
    expect(masteryFrameFacts({ kind: "runtime", event: { type: "turn.completed", threadId: "t-auto", ok: true, provider: "codex" } }, lookups)).toEqual([
      { person: ADA, fact: { kind: "turn.done", threadId: "t-auto", botId: "b1", ok: true, provider: "anthropic", auto: { cheaper: true } } },
    ]);
    // nobody's thread: nothing
    expect(masteryFrameFacts({ kind: "runtime", event: { type: "turn.completed", threadId: "x1", ok: true } }, lookups)).toEqual([]);
  });

  it("reads approvals asked and answered, with whether the tool writes", () => {
    const asked = masteryFrameFacts({ kind: "message", threadId: "t1", message: { card: { requestId: "q1", requestType: "permission", tool: "mcp__perspicax_example__cw_psa_write" } } }, lookups);
    expect(asked).toEqual([{ person: ADA, id: "asked:q1", fact: { kind: "approval.requested" } }]);
    const denied = masteryFrameFacts({ kind: "message.patch", threadId: "t1", message: { card: { requestId: "q1", requestType: "permission", tool: "mcp__perspicax_example__cw_psa_write", answered: "deny" } } }, lookups);
    expect(denied).toEqual([{ person: ADA, id: "answered:q1", fact: { kind: "approval.answered", threadId: "t1", allow: false, write: true } }]);
    // settled by someone else (dismissed) or a question: not an answer of theirs
    expect(masteryFrameFacts({ kind: "message.patch", threadId: "t1", message: { card: { requestId: "q2", answered: "allow", dismissed: true } } }, lookups)).toEqual([]);
    expect(masteryFrameFacts({ kind: "message", threadId: "t1", message: { card: { requestId: "q3", requestType: "question" } } }, lookups)).toEqual([]);
    // a tool marked read-only by its server is never a write
    expect(masteryFrameFacts({ kind: "message.patch", threadId: "t1", message: { card: { requestId: "q4", tool: "Bash", toolHints: { readOnly: true }, answered: "deny" } } }, lookups)[0]!.fact).toMatchObject({ write: false });
  });

  it("reads tool lines: a sub-agent, an integration, a skill", () => {
    const facts = masteryFrameFacts({ kind: "message", threadId: "t1", message: { kind: "activity", tool: { name: "mcp__perspicax_example__endpoint__query", parentItemId: "agent-1" } } }, lookups);
    expect(facts).toEqual([{ person: ADA, fact: { kind: "tool.used", threadId: "t1", subagent: "agent-1", integration: "perspicax:endpoint" } }]);
    expect(masteryFrameFacts({ kind: "message", threadId: "t1", message: { kind: "activity", tool: { name: "Skill", input: "{\n  \"skill\": \"Deploy\"\n}" } } }, lookups)).toEqual([
      { person: ADA, fact: { kind: "tool.used", threadId: "t1", skill: "deploy" } },
    ]);
    expect(masteryFrameFacts({ kind: "message", threadId: "t1", message: { kind: "activity", tool: { name: "Read" } } }, lookups)).toEqual([]);
  });

  it("reads a bot's final answer for its language, rooms aside", () => {
    expect(masteryFrameFacts({ kind: "message.patch", threadId: "t1", message: { role: "bot", kind: "text", turnTerminal: true, text: "The report is ready and the numbers are up." } }, lookups)).toEqual([
      { person: ADA, fact: { kind: "reply", threadId: "t1", french: false } },
    ]);
    expect(masteryFrameFacts({ kind: "message.patch", threadId: "t1", message: { role: "bot", kind: "text", turnTerminal: true, from: "b2", text: "hello there friend" } }, lookups)).toEqual([]);
  });
});

describe("what the server's requests mean", () => {
  const facts = (method: string, path: string, status = 200) => masteryRequestFacts({ method, path, status }, ADA, { catalogPublisher: (id) => (id === "pub" ? BOB : id === "mine" ? ADA : null), census: () => ({ open: 3, folders: 1, stale: 0 }) });

  it("reads routine edits, stops, memory written, imports and conversations tidied", () => {
    expect(facts("PATCH", "/api/routines/r1")).toEqual([{ person: ADA, fact: { kind: "routine.edited", routineId: "r1" } }]);
    expect(facts("POST", "/api/bots/b1/interrupt")).toEqual([{ person: ADA, fact: { kind: "bot.stopped", botId: "b1" } }]);
    expect(facts("PUT", "/api/bots/b1/memory/file")).toEqual([{ person: ADA, fact: { kind: "memory.written", botId: "b1" } }]);
    // an import counts for the publisher, never for importing one's own bot
    expect(facts("POST", "/api/bot-catalog/pub/import", 201)).toEqual([{ person: BOB, fact: { kind: "catalog.imported", botId: "pub", importer: ADA } }]);
    expect(facts("POST", "/api/bot-catalog/mine/import", 201)).toEqual([]);
    expect(facts("PATCH", "/api/bots/b1/tasks/t1")).toEqual([{ person: ADA, fact: { kind: "threads.census", open: 3, folders: 1, stale: 0 } }]);
    // a refused request means nothing
    expect(facts("PATCH", "/api/routines/r1", 403)).toEqual([]);
  });

  it("reads a sent message's language and whether it steered the running turn", () => {
    expect(masterySendFacts({ threadId: "t1", text: "Arrête, utilise plutôt la liste des clients de cette semaine.", steered: true }, ADA)).toEqual([
      { person: ADA, fact: { kind: "message.sent", threadId: "t1", french: true, steered: true } },
    ]);
  });

  it("reads a delegation that came back across model families", () => {
    const [fact] = masteryDelegationFacts({ person: ADA, sourceThreadId: "t1", toBotId: "b2", ok: true, sourceModel: "claude-opus-4", workerModel: "gpt-5.4", id: "d1" });
    expect(fact).toEqual({ person: ADA, id: "delegation:d1", fact: { kind: "delegation.done", threadId: "t1", toBotId: "b2", ok: true, crossModel: true } });
    expect(masteryDelegationFacts({ person: ADA, sourceThreadId: "t1", toBotId: "b2", ok: true, sourceModel: "claude-opus-4", workerModel: "claude-haiku-4", id: "d2" })[0]!.fact).toMatchObject({ crossModel: false });
    expect(masteryDelegationFacts({ person: null, sourceThreadId: "t1", toBotId: "b2", ok: true, sourceModel: null, workerModel: null, id: "d3" })).toEqual([]);
  });

  it("knows integrations, skills, writes and families by name", () => {
    expect(integrationOfTool("mcp__agents__ask_bot")).toBeNull();
    expect(integrationOfTool("mcp__github__create_issue")).toBe("github");
    expect(skillOfTool("skill_view", { name: "Report" })).toBe("report");
    expect(skillOfTool("Bash", { skill: "x" })).toBeNull();
    expect(toolWrites("mcp__perspicax_example__cw_psa_query")).toBe(false);
    expect(toolWrites("mcp__github__create_issue")).toBe(true);
    expect(toolWrites("Read")).toBe(false);
    expect(modelFamily("grok-4-fast")).toBe("xai");
    expect(modelFamily("gemini-3.8-flash")).toBe("google");
    expect(modelFamily("kimi-k3")).toBe("moonshot");
  });

  it("counts open conversations in folders and the ones left untouched for 30 days", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    const census = threadCensus([
      { threadId: "main", projectId: "p1", updatedAt: now - 90 * DAY },
      { threadId: "a", projectId: "p1", updatedAt: now },
      { threadId: "b", projectId: "p2", updatedAt: now - DAY },
      { threadId: "c", updatedAt: now - 31 * DAY },
      { threadId: "d", projectId: "p3", archivedAt: now, updatedAt: now - 90 * DAY },
    ], new Set(["main"]), now);
    expect(census).toEqual({ open: 2, folders: 2, stale: 1 });
  });
});

describe("Mastery in the store", () => {
  it("counts a fact once by its id, never from the app, and unlocks with a toast-ready unlock", () => {
    const { store, tick } = setup();
    expect(store.record(ADA, [{ type: "mastery", fact: { kind: "routine.outcome", routineId: "r1", ok: true } }], "client").accepted).toBe(0);
    let unlocked: string[] = [];
    for (let n = 0; n < 10; n += 1) {
      tick(1_000);
      const result = store.record(ADA, [{ type: "mastery", id: `run:${n}`, fact: { kind: "routine.outcome", routineId: "r1", ok: true, botId: "b1" } }], "server");
      unlocked = unlocked.concat(result.unlocked.map((item) => item.id));
      // replaying the same run changes nothing
      store.record(ADA, [{ type: "mastery", id: `run:${n}`, fact: { kind: "routine.outcome", routineId: "r1", ok: true, botId: "b1" } }], "server");
    }
    // once, and its 100 points count toward the points tiers like any others
    expect(unlocked).toEqual(["hands-off", "bronze"]);
    const snapshot = store.snapshot(ADA);
    expect(snapshot.items.find((item) => item.id === "hands-off")?.unlockedAt).toBeTypeOf("number");
    expect(snapshot.items.find((item) => item.id === "common-thread")).toMatchObject({ current: 0, target: 14 });
    // the reward: the character, its key, its title
    expect(snapshot.rewards).toEqual(expect.arrayContaining(["character:shiba", masteryKey("hands-off"), "title:hands-off"]));
    // a Mastery fact is not activity: no streak from a routine that ran at night
    expect(snapshot.streak).toBe(0);
    // Bob's progress is his own
    expect(store.snapshot(BOB).items.find((item) => item.id === "hands-off")?.unlockedAt).toBeUndefined();
  });

  it("keeps the measures across a restart", () => {
    const { dir, store, tick } = setup();
    for (let n = 0; n < 4; n += 1) {
      tick(1_000);
      store.record(ADA, [{ type: "mastery", id: `run:${n}`, fact: { kind: "routine.outcome", routineId: "r1", ok: true } }], "server");
    }
    store.flush();
    const again = createAchievementStore({ dataDir: dir, persistDelayMs: 0 });
    expect(again.snapshot(ADA).items.find((item) => item.id === "hands-off")).toMatchObject({ current: 4, target: 10 });
  });

  it("closes the windows that span days in the nightly pass, and looks at the conversations", () => {
    const { store, tick } = setup();
    for (let n = 0; n < 30; n += 1) {
      store.record(ADA, [{ type: "mastery", id: `run:${n}`, fact: { kind: "routine.outcome", routineId: "r1", ok: true } }], "server");
      tick(DAY);
    }
    // day 29 was not over when its run came in
    expect(store.snapshot(ADA).items.find((item) => item.id === "quiet-nights")).toMatchObject({ current: 29, target: 30 });
    expect(store.people()).toEqual([ADA]);
    expect(store.localDay(ADA)).toBe("2026-10-31");
    const unlocked = store.reconcile(ADA, [{ kind: "threads.census", open: 10, folders: 5, stale: 0 }]).map((item) => item.id);
    expect(unlocked).toEqual(expect.arrayContaining(["quiet-nights", "ten-hands"]));
    // the nightly pass is idempotent
    expect(store.reconcile(ADA)).toEqual([]);
  });

  it("unlocks the capstone from 20 other Mastery achievements, not from the rest of the catalog", () => {
    const master = achievementById("sagax-master")!;
    const mastery = ACHIEVEMENTS.filter((item) => item.category === "mastery" && item.id !== "sagax-master").map((item) => item.id);
    const others = ACHIEVEMENTS.filter((item) => item.category !== "mastery").map((item) => item.id);
    const progress = (ids: string[]) => ({ counters: {}, maxima: {}, keys: {}, days: {}, activeDays: [], grandfathered: [], unlocked: Object.fromEntries(ids.map((id) => [id, 1])) });
    expect(ruleStatus(master, progress([...others, ...mastery.slice(0, 19)]), ACHIEVEMENTS)).toEqual({ current: 19, target: 20, done: false });
    expect(ruleStatus(master, progress(mastery.slice(0, 20)), ACHIEVEMENTS).done).toBe(true);
    expect(newlyEarned(progress(mastery.slice(0, 20)), ACHIEVEMENTS)).toContain("sagax-master");
  });
});

describe("a locked look cannot be saved", () => {
  const none = new Set<string>();
  const shiba = new Set(["character:shiba", masteryKey("hands-off")]);

  it("refuses a Mastery character not unlocked, naming the achievement", () => {
    expect(lockedLookChange({ character: "owl" }, { character: "shiba" }, none)).toEqual({
      error: 'This look is locked until the achievement "hands-off" is unlocked.',
      code: "look_locked",
      achievement: "hands-off",
      character: "shiba",
    });
    expect(lockedLookChange({ character: "owl" }, { character: "shiba" }, shiba)).toBeNull();
  });

  it("refuses a locked skin, even on a character not worn, and allows the base skin", () => {
    expect(lockedLookChange({ character: "shiba" }, { character: "shiba", skins: { shiba: "white" } }, shiba)).toMatchObject({ achievement: "quiet-nights", skin: "white" });
    expect(lockedLookChange({ character: "owl" }, { character: "owl", skins: { frog: "holo" } }, none)).toMatchObject({ achievement: "sagax-master", character: "frog", skin: "holo" });
    expect(lockedLookChange({ character: "shiba" }, { character: "shiba", skins: { shiba: "plain", shape: "gold" } }, shiba)).toBeNull();
  });

  it("saves a character worn in a skin its person earned before the character itself", () => {
    const coat = new Set([masteryKey("second-wind")]);
    expect(lockedLookChange({ character: "owl" }, { character: "shiba", skins: { shiba: "cream" } }, coat)).toBeNull();
    expect(lockedLookChange({ character: "owl" }, { character: "shiba", skins: { shiba: "white" } }, coat)).toMatchObject({ achievement: "quiet-nights", skin: "white" });
  });

  it("never takes back what a bot already wears, and leaves the older characters to their own locks", () => {
    expect(lockedLookChange({ character: "shiba", skins: { shiba: "white" } }, { character: "shiba", skins: { shiba: "white" } }, none)).toBeNull();
    expect(lockedLookChange({ character: "owl" }, { character: "trombi", skins: { trombi: "holo" } }, none)).toBeNull();
    expect(lockedLookChange({ character: "owl" }, undefined, none)).toBeNull();
  });
});
