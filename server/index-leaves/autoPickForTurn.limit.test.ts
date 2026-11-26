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
function world(spent: readonly string[], modeModels: ModeModels = {}) {
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
    },
    autoCatalogLookup: (_driver: string, id: string) => FACTS[bareModelId(id)],
    autoModeModelsFor: () => modeModels,
    attachmentsInText: (text: string) => ({ text, attachments: [] }),
    parsedQuickTask: (text: string) => ({ text, attachments: [] }),
    effortAcceptedByEngine: () => true,
    store: { taskByThread: () => undefined },
    autoRecordUsable: () => false,
  };
  const pickFor = createAutoPickForTurn(() => host);
  const turn = (mode?: "fast" | "expert" | "heavy", withModes = false) => pickFor({
    bot: { id: "b1", title: "", soul: "", modelSelection: { instanceId: "grok", model: "grok-4.7", auto: true as const, ...(mode ? { mode } : {}) } },
    threadId: "t1", speaker: { origin: "person" }, role: "orchestration", text: withModes ? "" : "hello there", withModes,
  });
  return { turn, asked };
}
const CLAUDE = ["claude", "claude-2"];
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

  it("with every account at its limit the pick keeps its list, as before (the limit says when)", () => {
    const w = world(["claude", "claude-2", "grok"]);
    expect(w.turn("expert")?.pick).toMatchObject({ mode: "expert", selection: { model: "claude-opus-5-5" } });
  });
});
