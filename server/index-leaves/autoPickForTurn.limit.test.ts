// M-20261126-101 (#5403): a mode never picks a model the person cannot be served now.
// An account whose 5-hour or weekly window the person's usage report shows
// used up is out of the turn's pick and of the menu's preview (one list, the
// usage-limit failover's verdict), and the next available model takes its place.
import { describe, expect, it } from "vitest";

import type { AutoEngine, CatalogFacts } from "../models/model-auto.ts";
import { bareModelId } from "../models/model-auto.ts";
import { createAutoPickForTurn } from "./autoPickForTurn.ts";

const FACTS: Record<string, CatalogFacts> = {
  "claude-opus-5-5": { name: "Claude Opus 5.5", reasoning: true, vision: true, context: 1_000_000, costInput: 4, costOutput: 20, releaseDate: "2026-09-22" },
  "claude-haiku-4-5": { name: "Claude Haiku 4.5", reasoning: true, vision: true, context: 200_000, costInput: 1, costOutput: 5, releaseDate: "2025-10-16" },
  "grok-4.7": { name: "Grok 4.7", reasoning: true, vision: true, context: 500_000, costInput: 2, costOutput: 6, releaseDate: "2026-09-21" },
  "grok-4-fast": { name: "Grok 4 Fast", reasoning: true, vision: true, context: 2_000_000, costInput: 0.2, costOutput: 0.5, releaseDate: "2025-09-23" },
};
const claudeAccount = (instanceId: string, displayName: string): AutoEngine => ({
  instanceId, driverKind: "claudeAgent", displayName, effortLevels: ["low", "medium", "high"],
  models: { default: "claude-opus-5-5", options: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }, { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }] },
});
const first = claudeAccount("claude", "Claude Code");
const second = claudeAccount("claude-2", "Claude Code 2");
const grok: AutoEngine = {
  instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", effortLevels: ["low", "medium", "high"],
  models: { default: "grok-4.7", options: [{ id: "grok-4.7", label: "Grok 4.7" }, { id: "grok-4-fast", label: "Grok 4 Fast" }] },
};

type ModeModels = Record<string, unknown>;
/** `spent`: the accounts the person's usage report shows at their limit. No
 * turn was refused yet, so only a pick that reads the report knows of them. */
function world(spent: readonly string[], modeModels: ModeModels = {}, last?: Record<string, unknown>) {
  const asked: Array<string | undefined> = [];
  const host = {
    autoPayerKey: () => "me",
    autoRefusalsFor: () => [],
    autoEnginesFor: () => [first, second, grok],
    limitFailover: {
      autoExcluded: (_payer: string, engines: readonly AutoEngine[], pick?: string) => {
        asked.push(pick);
        return new Set(pick === "report" ? engines.map((engine) => engine.instanceId).filter((id) => spent.includes(id)) : []);
      },
      limitedUntil: (_payer: string, engines: readonly AutoEngine[]) => engines.some((engine) => spent.includes(engine.instanceId)) ? BACK_AT : null,
    },
    autoCatalogLookup: (_driver: string, id: string) => FACTS[bareModelId(id)],
    autoModeModelsFor: () => modeModels,
    attachmentsInText: (text: string) => ({ text, attachments: [] }),
    parsedQuickTask: (text: string) => ({ text, attachments: [] }),
    effortAcceptedByEngine: () => true,
    // the conversation's last pick (WireTask.autoModel), and server/index.ts's rule for keeping it
    store: { taskByThread: () => last ? { autoModel: last } : undefined },
    autoRecordUsable: (record: { instanceId: string; model: string }, engines: readonly AutoEngine[]) =>
      engines.some((engine) => engine.instanceId === record.instanceId && engine.models.options.some((option) => option.id === record.model)),
  };
  const pickFor = createAutoPickForTurn(() => host);
  const turn = (mode?: "fast" | "expert" | "heavy", withModes = false, role: "orchestration" | "worker" | "continue" = "orchestration", speaker: Record<string, unknown> = { origin: "person" }) => pickFor({
    bot: { id: "b1", title: "", soul: "", modelSelection: { instanceId: "grok", model: "grok-4.7", auto: true as const, ...(mode ? { mode } : {}) } },
    threadId: "t1", speaker, role, text: withModes ? "" : "hello there", withModes,
  });
  return { turn, asked };
}
const CLAUDE = ["claude", "claude-2"];
const ALL = [...CLAUDE, "grok"];
/** When the first account at its limit is expected back. */
const BACK_AT = Date.parse("2026-11-26T20:40:00Z");
const onClaude = (instanceId: string | undefined) => CLAUDE.includes(instanceId ?? "");

describe("M-20261126-101: a mode skips a model whose accounts are at their limit", () => {
  it("reads the person's usage report, as Sagax's quick pick does", () => {
    const w = world(CLAUDE);
    w.turn("expert");
    expect(w.asked).toEqual(["report"]);
  });

  it("Expert, Fast, Heavy and Auto take the next available model", () => {
    const w = world(CLAUDE);
    expect(w.turn("expert")?.pick).toMatchObject({ mode: "expert", selection: { instanceId: "grok", model: "grok-4.7" } });
    expect(w.turn("fast")?.pick).toMatchObject({ mode: "fast", selection: { instanceId: "grok", model: "grok-4-fast" } });
    const heavy = w.turn("heavy")?.pick;
    expect(heavy?.selection.instanceId).toBe("grok");
    // a smaller team rather than a seat on a blocked account
    expect(heavy?.team?.map((seat: { modelLabel: string }) => seat.modelLabel)).toEqual(["Grok 4.7"]);
    const auto = w.turn(undefined)?.pick;
    expect(onClaude(auto?.selection.instanceId)).toBe(false);
    for (const pick of [heavy, auto]) expect(pick?.chain.some((entry: { instanceId: string }) => onClaude(entry.instanceId))).toBe(false);
  });

  it("a model stays available while one of its accounts is", () => {
    const w = world(["claude"]);
    expect(w.turn("expert")?.pick).toMatchObject({ mode: "expert", selection: { instanceId: "claude-2", model: "claude-opus-5-5" } });
    expect(w.turn("heavy")?.pick.team?.map((seat: { instanceId: string }) => seat.instanceId)).not.toContain("claude");
  });

  it("the menu's preview names only what the turn would run", () => {
    const modes = world(CLAUDE).turn(undefined, true)?.modes;
    expect(modes?.expert.pick?.modelLabel).toBe("Grok 4.7");
    expect(modes?.fast.pick?.modelLabel).toBe("Grok 4 Fast");
    expect(modes?.heavy.team?.map((seat: { modelLabel: string }) => seat.modelLabel)).toEqual(["Grok 4.7"]);
  });

  it("the person's own model for a mode is skipped the same way, and their setting is kept", () => {
    const chosen = {
      expert: { instanceId: "claude", model: "claude-opus-5-5" },
      fast: { instanceId: "claude-2", model: "claude-haiku-4-5" },
      heavy: [{ instanceId: "claude", model: "claude-opus-5-5" }, { instanceId: "grok", model: "grok-4-fast" }],
    };
    const kept = structuredClone(chosen);
    const blocked = world(CLAUDE, chosen);
    expect(blocked.turn("expert")?.pick.selection).toMatchObject({ instanceId: "grok", model: "grok-4.7" });
    expect(blocked.turn("fast")?.pick.selection).toMatchObject({ instanceId: "grok", model: "grok-4-fast" });
    expect(blocked.turn("heavy")?.pick.team?.map((seat: { modelLabel: string }) => seat.modelLabel)).toEqual(["Grok 4 Fast"]);
    expect(chosen).toEqual(kept);
    // the limit resets: the same setting runs again
    const open = world([], chosen);
    expect(open.turn("expert")?.pick.selection).toMatchObject({ instanceId: "claude", model: "claude-opus-5-5" });
    expect(open.turn("heavy")?.pick.team?.map((seat: { modelLabel: string }) => seat.modelLabel)).toEqual(["Claude Opus 5.5", "Grok 4 Fast"]);
  });

  it("with every account at its limit the turn's pick keeps its list, as before (the limit says when)", () => {
    const w = world(ALL);
    expect(w.turn("expert")?.pick).toMatchObject({ mode: "expert", selection: { model: "claude-opus-5-5" } });
    expect(w.turn("heavy")?.pick.team?.length).toBeGreaterThan(0);
    expect(w.turn(undefined)?.pick.selection.model).toBeTruthy();
  });

  // review M1: the preview then names no model at all, and says when one is back
  it("with every account at its limit the menu's preview names no model and says when one is back", () => {
    const modes = world(ALL).turn(undefined, true)?.modes;
    for (const mode of ["auto", "fast", "expert", "heavy"] as const) {
      expect(modes?.[mode]).toMatchObject({ mode, pick: null, limited: { until: BACK_AT } });
      expect(modes?.[mode].team).toBeUndefined();
    }
    expect(JSON.stringify(modes)).not.toMatch(/Claude|Grok/);
    // one account with room: models are named again, and nothing reads as limited
    const open = world(CLAUDE).turn(undefined, true)?.modes;
    expect(open?.expert.pick?.modelLabel).toBe("Grok 4.7");
    expect(open?.expert.limited).toBeUndefined();
  });
});

// review M2: every turn Sagax starts takes its model from this one function
// (a routine's run: server/index.ts routineReadinessBot and the routine's
// startTurn, role "worker"; a bot talking to another bot and every started
// turn: server/turns/start-turn-prepare-validate.ts; a group room:
// server/turns/group-member-turn-prepare.ts), so each skips a flagged account.
describe("M-20261126-101: routines, workers and continued conversations skip a flagged account too", () => {
  const routine = { origin: "routine", routineId: "r1" };

  it("a routine's run (a worker turn) takes the next available model", () => {
    const pick = world(CLAUDE).turn(undefined, false, "worker", routine)?.pick;
    expect(pick?.selection.instanceId).toBe("grok");
    expect(pick?.chain.some((entry: { instanceId: string }) => onClaude(entry.instanceId))).toBe(false);
    // with room on one Claude account the worker may run there, never on the flagged one
    const one = world(["claude"]).turn(undefined, false, "worker", routine)?.pick;
    expect(one?.selection.instanceId).not.toBe("claude");
    expect(one?.chain.some((entry: { instanceId: string }) => entry.instanceId === "claude")).toBe(false);
  });

  it("a continued conversation leaves its earlier pick when that account is flagged, and keeps it otherwise", () => {
    const last = { instanceId: "claude", model: "claude-opus-5-5", engineLabel: "Claude Code", modelLabel: "Claude Opus 5.5", role: "orchestration", tier: "top", reason: "strongest-other", at: 1 };
    expect(world([], {}, last).turn(undefined, false, "continue")?.pick.selection).toMatchObject({ instanceId: "claude", model: "claude-opus-5-5" });
    const moved = world(["claude"], {}, last).turn(undefined, false, "continue")?.pick;
    expect(moved?.selection.instanceId).not.toBe("claude");
    expect(moved?.chain.some((entry: { instanceId: string }) => entry.instanceId === "claude")).toBe(false);
  });
});
