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

  it("M-20261125-073: a bot still set on Build runs as Auto, the request read as for a plain Auto bot", () => {
    const pick = turn("build")?.pick;
    expect(pick?.mode).toBeUndefined();
    expect(pick?.reason).not.toBe("mode");
    expect(pick?.selection).toEqual(turn(undefined)?.pick.selection);
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
    // Build is a mode of the menu since the owner's decision M-20261123-045.
    expect(Object.keys(answer?.modes ?? {})).toEqual(["auto", "fast", "expert", "heavy", "build"]);
    expect(answer?.modes?.expert.pick?.modelLabel).toBe("Claude Opus 5.5");
  });
});
