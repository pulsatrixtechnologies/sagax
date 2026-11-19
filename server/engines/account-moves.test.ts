// Where an account's bots go when it is removed or signed out of
// (2026-11-18, owner rule: one confirmation, one click, never a block).
import { describe, expect, it } from "vitest";

import { createAccountMovesHost, ownerReachable, planAccountMoves, type AccountMoveEngine } from "./account-moves.ts";
import { accountUserNames } from "./account-users.ts";

const engines: AccountMoveEngine[] = [
  { instanceId: "claude", defaultModel: "opus", usable: true },
  { instanceId: "claude-work", defaultModel: "opus", usable: true },
  { instanceId: "codex", defaultModel: "gpt", usable: true },
  { instanceId: "grok", defaultModel: "grok-4", usable: false },
];
const noTasks = () => [];
const leaving = new Set(["claude"]);

describe("accountUserNames", () => {
  it("never names an archived temporary agent as a user of an account (the leftover perf-test-061)", () => {
    const bots = [
      { id: "t1", name: "perf-test-061", modelSelection: { instanceId: "claude", model: "opus" }, temporary: { archived: { at: 1 } } },
      { id: "b1", name: "Scout", modelSelection: { instanceId: "claude", model: "opus" } },
      { id: "t2", name: "Helper", modelSelection: { instanceId: "claude", model: "opus" }, temporary: {} },
    ];
    expect(accountUserNames(bots, noTasks, "claude")).toEqual(["Scout", "Helper"]);
  });
});

describe("planAccountMoves", () => {
  it("moves a bot to the person's other account of the same provider, same model and settings", () => {
    const plan = planAccountMoves({
      bots: [{ id: "b1", name: "Scout", modelSelection: { instanceId: "claude", model: "sonnet", effort: "high" } }],
      tasks: noTasks, leaving, sameProvider: ["claude-work"], engines, label: (selection) => `name:${selection.instanceId}`,
    });
    expect(plan).toEqual({
      moves: [{ botId: "b1", name: "Scout", via: "account", to: { instanceId: "claude-work", model: "sonnet", effort: "high" }, engine: "name:claude-work" }],
      noEngine: false,
    });
  });

  it("without another account, takes the bot's next backup that can run, and drops the one on the account", () => {
    const plan = planAccountMoves({
      bots: [{ id: "b1", name: "Scout", modelSelection: { instanceId: "claude", model: "opus" }, fallback: [{ instanceId: "grok", model: "g" }, { instanceId: "codex", model: "gpt" }, { instanceId: "claude", model: "haiku" }] }],
      tasks: noTasks, leaving, sameProvider: [], engines,
    });
    expect(plan.moves[0]).toEqual({ botId: "b1", name: "Scout", via: "fallback", to: { instanceId: "codex", model: "gpt" }, fallback: [{ instanceId: "grok", model: "g" }] });
  });

  it("else the person's default engine, else any engine that can run", () => {
    const bot = { id: "b1", name: "Scout", modelSelection: { instanceId: "claude", model: "opus" } };
    const withDefault = planAccountMoves({ bots: [bot], tasks: noTasks, leaving, sameProvider: [], engines, personDefault: { instanceId: "codex", model: "gpt-mini" } });
    expect(withDefault.moves[0]).toMatchObject({ via: "default", to: { instanceId: "codex", model: "gpt-mini" } });
    const any = planAccountMoves({ bots: [bot], tasks: noTasks, leaving, sameProvider: [], engines, personDefault: { instanceId: "claude", model: "opus" } });
    expect(any.moves[0]).toMatchObject({ via: "default", to: { instanceId: "claude-work", model: "opus" } });
  });

  it("says plainly when no other engine exists: the bot gets none", () => {
    const plan = planAccountMoves({
      bots: [{ id: "b1", name: "Scout", modelSelection: { instanceId: "claude", model: "opus" } }],
      tasks: noTasks, leaving, sameProvider: [], engines: [{ instanceId: "claude", defaultModel: "opus", usable: true }],
    });
    expect(plan).toEqual({ moves: [{ botId: "b1", name: "Scout", via: "none", to: null }], noEngine: true });
  });

  it("a bot that only falls back to the account, or has a conversation on it, keeps its engine", () => {
    const plan = planAccountMoves({
      bots: [
        { id: "b1", name: "Atlas", modelSelection: { instanceId: "codex", model: "gpt" }, fallback: [{ instanceId: "claude", model: "opus" }] },
        { id: "b2", name: "Juniper", modelSelection: { instanceId: "codex", model: "gpt" } },
        { id: "b3", name: "Quiet", modelSelection: { instanceId: "codex", model: "gpt" } },
      ],
      tasks: (botId) => botId === "b2" ? [{ modelSelection: { instanceId: "claude", model: "opus" } }] : [],
      leaving, sameProvider: ["claude-work"], engines,
    });
    expect(plan.moves).toEqual([
      { botId: "b1", name: "Atlas", via: "stays", to: { instanceId: "codex", model: "gpt" }, fallback: [{ instanceId: "claude-work", model: "opus" }] },
      { botId: "b2", name: "Juniper", via: "stays", to: { instanceId: "codex", model: "gpt" } },
    ]);
  });

  it("moves the default model for new bots when asked, and leaves archived temporary agents out", () => {
    const plan = planAccountMoves({
      bots: [{ id: "t1", name: "perf-test-061", modelSelection: { instanceId: "claude", model: "opus" }, temporary: { archived: { at: 1 } } }],
      tasks: noTasks, leaving, sameProvider: [], engines, personDefault: { instanceId: "claude", model: "opus" }, moveDefault: true,
    });
    expect(plan).toEqual({ moves: [], defaultModel: { via: "default", to: { instanceId: "claude-work", model: "opus" } }, noEngine: false });
  });
});

describe("createAccountMovesHost", () => {
  it("applies the plan it showed: the bots, then the default model", async () => {
    const moved: unknown[] = [];
    const defaults: unknown[] = [];
    const host = createAccountMovesHost({
      bots: (person) => person === "pr_1" ? [{ id: "b1", name: "Scout", modelSelection: { instanceId: "claude", model: "opus" } }] : [],
      tasks: () => [],
      engines: async () => engines,
      personDefault: () => ({ instanceId: "claude", model: "opus" }),
      label: (selection) => selection.instanceId,
      moveBots: (ids, moves, forget) => { moved.push([[...ids], moves.map((move) => move.botId), forget]); },
      setDefault: (selection) => { defaults.push(selection); },
    });
    const plan = await host.plan({ person: "pr_1", leaving: ["claude"], sameProvider: ["claude-work"], moveDefault: true });
    expect(plan.moves.map((move) => [move.name, move.via, move.engine])).toEqual([["Scout", "account", "claude-work"]]);
    host.apply(plan, ["claude"], { forget: true, moveDefault: true });
    expect(moved).toEqual([[["claude"], ["b1"], true]]);
    expect(defaults).toEqual([{ instanceId: "claude-work", model: "opus" }]);
  });
});

describe("an organization server: each person's bots stay within their own accounts (2026-11-19)", () => {
  // claude: shared; claude-work: Alex's own; claude-sam: Sam's own; codex: shared
  const owners: Record<string, string> = { "claude-work": "alex@example.com", "claude-sam": "Sam@example.com" };
  const botOwners: Record<string, string> = { mine: "alex@example.com", theirs: "sam@example.com", other: "kim@example.com" };
  const reachable = ownerReachable({ engineOwner: (id) => owners[id], botOwner: (id) => botOwners[id] });
  const all: AccountMoveEngine[] = [...engines, { instanceId: "claude-sam", defaultModel: "opus", usable: true }];

  it("never moves another person's bot onto the remover's own account", () => {
    const plan = planAccountMoves({
      bots: ["mine", "theirs", "other"].map((id) => ({ id, name: id, modelSelection: { instanceId: "claude", model: "sonnet" } })),
      tasks: noTasks, leaving, sameProvider: ["claude-work", "claude-sam"], engines: all, reachable,
    });
    expect(plan.moves.map((move) => [move.botId, move.via, move.to?.instanceId])).toEqual([
      ["mine", "account", "claude-work"],
      ["theirs", "account", "claude-sam"],
      // nobody else's own account: a shared engine
      ["other", "default", "codex"],
    ]);
  });

  it("drops a backup that would land on another person's account, and the default model moves to a shared engine", () => {
    const plan = planAccountMoves({
      bots: [{ id: "theirs", name: "Atlas", modelSelection: { instanceId: "codex", model: "gpt" }, fallback: [{ instanceId: "claude", model: "opus" }] }],
      tasks: noTasks, leaving, sameProvider: ["claude-work"], engines, reachable, personDefault: { instanceId: "claude", model: "opus" }, moveDefault: true,
    });
    expect(plan.moves[0]).toMatchObject({ via: "stays", fallback: [] });
    expect(plan.defaultModel).toMatchObject({ via: "default", to: { instanceId: "codex", model: "gpt" } });
  });

  it("a server of one person: every account is theirs", () => {
    const solo = ownerReachable({});
    expect(solo("anyone", "claude-work")).toBe(true);
    expect(solo(null, "claude-work")).toBe(true);
  });
});
