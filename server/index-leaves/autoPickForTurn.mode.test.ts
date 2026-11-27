// Composer modes (#4900) in the turn's pick: a typed turn and a call turn both
// go through autoPickForTurn, so the mode applies to both; a call turn keeps
// the rule of #4888 (the bot's own engine unless the person's mode, or Auto,
// moves it), and work a bot hands out is Auto's, whatever the mode.
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
const claude: AutoEngine = {
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude Code", effortLevels: ["low", "medium", "high"],
  models: { default: "claude-opus-5-5", options: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }, { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }] },
};
const grok: AutoEngine = {
  instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", effortLevels: ["low", "medium", "high"],
  models: { default: "grok-4.7", options: [{ id: "grok-4.7", label: "Grok 4.7" }, { id: "grok-4-fast", label: "Grok 4 Fast" }] },
};

const host = {
  autoPayerKey: () => "me",
  autoRefusalsFor: () => [],
  autoEnginesFor: () => [claude, grok],
  limitFailover: { autoExcluded: () => new Set<string>() },
  autoCatalogLookup: (_driver: string, id: string) => FACTS[bareModelId(id)],
  attachmentsInText: (text: string) => ({ text, attachments: [] }),
  parsedQuickTask: (text: string) => ({ text, attachments: [] }),
  effortAcceptedByEngine: () => true,
  store: { taskByThread: () => undefined },
  autoRecordUsable: () => false,
};
const pickFor = createAutoPickForTurn(() => host);
const bot = (mode?: "fast" | "expert" | "heavy" | "build") => ({
  id: "b1", title: "", soul: "",
  modelSelection: { instanceId: "grok", model: "grok-4.7", auto: true as const, ...(mode ? { mode } : {}) },
});
const speaker = { origin: "person" };
const turn = (mode: "fast" | "expert" | "heavy" | "build" | undefined, role: "orchestration" | "worker" | "continue" = "orchestration") =>
  pickFor({ bot: bot(mode), threadId: "t1", speaker, role, text: "hello there" });

describe("a mode in the turn's pick", () => {
  it("runs the mode's rule over the engines the person can use", () => {
    expect(turn("expert")?.pick).toMatchObject({ reason: "mode", mode: "expert", selection: { instanceId: "claude", model: "claude-opus-5-5", effort: "high" } });
    expect(turn("fast")?.pick).toMatchObject({ mode: "fast", selection: { instanceId: "grok", model: "grok-4-fast", effort: "low" } });
    // Heavy's seats: each account's strongest model first (#5089)
    expect(turn("heavy")?.pick.team?.slice(0, 2).map((agent: { modelLabel: string }) => agent.modelLabel)).toEqual(["Claude Opus 5.5", "Grok 4.7"]);
  });

  it("M-20261125-074: the turn runs the model the bot's owner chose for the mode, each owner their own", () => {
    const owners: Record<string, object> = { ada: { fast: { instanceId: "claude", model: "claude-haiku-4-5", effort: "medium" } } };
    const mine = createAutoPickForTurn(() => ({ ...host, autoModeModelsFor: (record: { ownerUserId?: string }) => owners[record.ownerUserId ?? ""] ?? {} }));
    const ask = (ownerUserId: string) => mine({ bot: { ...bot("fast"), ownerUserId }, threadId: "t1", speaker, role: "orchestration", text: "hello there" })?.pick;
    expect(ask("ada")).toMatchObject({ mode: "fast", selection: { instanceId: "claude", model: "claude-haiku-4-5", effort: "medium" } });
    // another person's bots keep what the mode resolves by itself
    expect(ask("grace")?.selection).toEqual(turn("fast")?.pick.selection);
  });

  it("M-20261125-073: a bot still set on Build runs as Auto, the request read as for a plain Auto bot", () => {
    const pick = turn("build")?.pick;
    expect(pick?.mode).toBeUndefined();
    expect(pick?.reason).not.toBe("mode");
    expect(pick?.selection).toEqual(turn(undefined)?.pick.selection);
  });

  it("D-20261126-005: Auto never takes Build, whatever the request asks for", () => {
    const ask = (text: string, role: "orchestration" | "worker" | "continue" = "orchestration") => pickFor({ bot: bot(undefined), threadId: "t1", speaker, role, text })?.pick;
    for (const text of ["Fix the failing unit tests in this TypeScript codebase.", "Corrige le bogue dans le code source et lance le build.", "Refactor src/main.rs and open a pull request."]) {
      for (const role of ["orchestration", "worker", "continue"] as const) {
        const pick = ask(text, role);
        expect(pick?.mode).not.toBe("build");
        expect(pick?.reason).not.toBe("mode");
      }
    }
  });

  it("a plain Auto bot still reads the request, as before", () => {
    const pick = turn(undefined)?.pick;
    expect(pick?.mode).toBeUndefined();
    expect(pick?.reason).not.toBe("mode");
  });

  it("plain Auto takes Heavy on its own for a risky or big request, and says why (D-20261119-086)", () => {
    const ask = (text: string) => pickFor({ bot: bot(undefined), threadId: "t1", speaker, role: "orchestration", text })?.pick;
    expect(ask("Delete the old mailboxes and migrate the rest to the new tenant.")).toMatchObject({ mode: "heavy", autoHeavy: "risky" });
    expect(ask("Supprime les vieux comptes en production.")).toMatchObject({ mode: "heavy", autoHeavy: "risky" });
    const steps = Array.from({ length: 7 }, (_, i) => `- step ${i + 1}: check the item`).join("\n");
    expect(ask(`Plan this:\n${steps}`)).toMatchObject({ mode: "heavy", autoHeavy: "big" });
    // an ordinary request stays Auto's
    expect(ask("What time is it in Paris?")?.autoHeavy).toBeUndefined();
    // a chosen mode is never overridden
    expect(pickFor({ bot: bot("fast"), threadId: "t1", speaker, role: "orchestration", text: "Delete the production database." })?.pick).toMatchObject({ mode: "fast" });
    // work a bot hands out is never escalated
    expect(pickFor({ bot: bot(undefined), threadId: "t1", speaker, role: "worker", text: "Delete the production database." })?.pick.autoHeavy).toBeUndefined();
  });

  describe("D-20261126-017: under Auto the Effort level the person chose is used on every turn", () => {
    const RISKY = "Delete the old mailboxes and migrate the rest to the new tenant.";
    const HARD = "Design the migration of our billing system to the new ledger, compare three architectures in depth and justify the trade-offs of each one.";
    const texts = ["hello there", "What time is it in Paris?", HARD, RISKY];
    const real = createAutoPickForTurn(() => ({ ...host, effortAcceptedByEngine: (level: string, offered: readonly string[]) => offered.includes(level) }));
    const ask = (text: string, effort?: "low" | "medium" | "high" | "max", mode?: "fast" | "expert" | "heavy", role: "orchestration" | "continue" = "orchestration") =>
      real({ bot: { ...bot(mode), modelSelection: { ...bot(mode).modelSelection, ...(effort ? { effort } : {}) } }, threadId: "t1", speaker, role, text })?.pick;

    it("nothing clicked: Auto decides, turn by turn (no level of the person's is added)", () => {
      // a turn Auto hands to Heavy runs at Heavy's level, an ordinary one at the model's own (none sent)
      expect(ask(RISKY)).toMatchObject({ autoHeavy: "risky", selection: { effort: "high" } });
      expect(ask("hello there")?.selection.effort).toBeUndefined();
    });

    it.each(["low", "medium", "high"] as const)("a level clicked, %s, runs every turn: whatever model and engine Auto takes, a turn it hands to Heavy included", (level) => {
      const engines = new Set<string>();
      for (const text of texts) {
        for (const role of ["orchestration", "continue"] as const) {
          const pick = ask(text, level, undefined, role);
          expect(pick?.selection.effort, `${role}: ${text}`).toBe(level);
          // the level changes nothing else of the pick
          const { effort: _with, ...withLevel } = pick!.selection;
          const { effort: _without, ...without } = ask(text, undefined, undefined, role)!.selection;
          expect(withLevel).toEqual(without);
          engines.add(pick!.selection.instanceId);
        }
      }
      // the turns ran on another engine than the bot's own too (grok is the bot's)
      expect([...engines].some((id) => id !== "grok")).toBe(true);
    });

    it("an engine that does not take the level runs its own instead of failing the turn", () => {
      expect(ask(RISKY, "max")?.selection.effort).toBe("high");
    });

    it("Fast, Expert and Heavy chosen by the person keep setting their own level", () => {
      expect(ask("hello there", "medium", "fast")?.selection.effort).toBe("low");
      expect(ask("hello there", "medium", "expert")?.selection.effort).toBe("high");
      expect(ask("hello there", "low", "heavy")?.selection.effort).toBe("high");
    });
  });

  it("work a bot hands out is Auto's, whatever the mode", () => {
    expect(turn("expert", "worker")?.pick.mode).toBeUndefined();
  });

  it("a continuation with no earlier pick takes the mode's pick too", () => {
    expect(turn("expert", "continue")?.pick.mode).toBe("expert");
  });

  it("a call turn is a turn like any other: the same pick (the bot's own engine rule of #4888 holds for a pinned model)", () => {
    // the call and the typed turn share this function (start-turn-prepare-validate.ts): no separate voice pick exists
    expect(turn("expert")?.pick.selection).toEqual(turn("expert", "orchestration")?.pick.selection);
  });

  it("with no engine to run the mode on, falls back on Auto", () => {
    const empty = createAutoPickForTurn(() => ({ ...host, autoEnginesFor: () => [] }));
    const pick = empty({ bot: bot("expert"), threadId: "t1", speaker, role: "orchestration", text: "hi" })?.pick;
    expect(pick?.reason).toBe("base");
  });

  it("the preview also says what every mode runs", () => {
    const answer = pickFor({ bot: bot("fast"), threadId: "t1", speaker, role: "orchestration", text: "", withModes: true });
    // D-20261126-005: Build is no mode any more; the server names it nowhere.
    expect(Object.keys(answer?.modes ?? {})).toEqual(["auto", "fast", "expert", "heavy"]);
    expect(answer?.modes?.expert.pick?.modelLabel).toBe("Claude Opus 5.5");
  });
});
