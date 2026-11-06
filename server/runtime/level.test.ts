// The level rule is the one place a delegated turn's permission mode is
// decided (contract §3), so each clause is pinned on its own: the order,
// who may inherit, that custom never travels, and the engine cap with its
// source. The cap table runs over every engine with a capability row, so a
// new engine or a changed provider mapping shows up here.
import { describe, expect, it } from "vitest";

import { ENGINE_KINDS, engineCapabilities } from "./capabilities.ts";
import { assignmentLevel, type LevelInput } from "./level.ts";
import type { Level, LevelSource } from "./types.ts";

const input = (over: Partial<LevelInput>): LevelInput =>
  ({ own: "ask", chief: "full", origin: "person", chiefLineage: true, driverKind: "claudeAgent", ...over });
const level = (over: Partial<LevelInput>) => assignmentLevel(input(over));
const TRAVELS: readonly Level[] = ["ask", "edits", "auto", "full"];

describe("assignmentLevel", () => {
  it("is max(own, inherited) in the order ask < edits < auto < full", () => {
    expect(level({ own: "ask", chief: "full" })).toEqual({ level: "full", source: "chief" });
    expect(level({ own: "ask", chief: "edits" })).toEqual({ level: "edits", source: "chief" });
    expect(level({ own: "edits", chief: "auto" })).toEqual({ level: "auto", source: "chief" });
    expect(level({ own: "auto", chief: "edits" })).toEqual({ level: "auto", source: "own" });
    expect(level({ own: "full", chief: "ask" })).toEqual({ level: "full", source: "own" });
    // equal levels are the bot's own, not a hand-down
    for (const own of TRAVELS) expect(level({ own, chief: own })).toEqual({ level: own, source: "own" });
  });

  it("inherits only from a Chief lineage whose origin is a person or a routine", () => {
    expect(level({ origin: "person" })).toEqual({ level: "full", source: "chief" });
    expect(level({ origin: "routine" })).toEqual({ level: "full", source: "chief" });
    expect(level({ origin: "outside" })).toEqual({ level: "ask", source: "own" });
    expect(level({ chiefLineage: false })).toEqual({ level: "ask", source: "own" });
    expect(level({ chiefLineage: false, origin: "outside" })).toEqual({ level: "ask", source: "own" });
    expect(level({ chief: undefined })).toEqual({ level: "ask", source: "own" });
    // outside lineage keeps the bot's own level whatever it is
    expect(level({ origin: "outside", own: "auto" })).toEqual({ level: "auto", source: "own" });
  });

  it("never lets custom travel", () => {
    // an own custom stays custom, above or below the Chief's level
    expect(level({ own: "custom", chief: "full", driverKind: "codex" })).toEqual({ level: "custom", source: "own" });
    expect(level({ own: "custom", chief: "ask", driverKind: "codex" })).toEqual({ level: "custom", source: "own" });
    expect(level({ own: "custom", chief: undefined, driverKind: "codex" })).toEqual({ level: "custom", source: "own" });
    // an inherited custom is ignored, even on the engine that has custom
    expect(level({ own: "ask", chief: "custom", driverKind: "codex" })).toEqual({ level: "ask", source: "own" });
    expect(level({ own: "auto", chief: "custom", driverKind: "codex" })).toEqual({ level: "auto", source: "own" });
  });

  describe("engine cap", () => {
    it("steps an inherited level down to the highest one the engine runs", () => {
      // Claude: Full, a native reviewer and an edits mode: everything passes
      expect(level({ chief: "full", driverKind: "claudeAgent" })).toEqual({ level: "full", source: "chief" });
      expect(level({ chief: "auto", driverKind: "claudeAgent" })).toEqual({ level: "auto", source: "chief" });
      expect(level({ chief: "edits", driverKind: "claudeAgent" })).toEqual({ level: "edits", source: "chief" });
      // Codex: Full and a reviewer, but Ask already runs workspace-write, so
      // an inherited Edits changes nothing
      expect(level({ chief: "full", driverKind: "codex" })).toEqual({ level: "full", source: "chief" });
      expect(level({ chief: "auto", driverKind: "codex" })).toEqual({ level: "auto", source: "chief" });
      expect(level({ chief: "edits", driverKind: "codex" })).toEqual({ level: "ask", source: "engine_cap" });
      // Antigravity: Full and an edits mode, no native reviewer: Auto becomes Edits
      expect(level({ chief: "full", driverKind: "antigravityAgent" })).toEqual({ level: "full", source: "chief" });
      expect(level({ chief: "auto", driverKind: "antigravityAgent" })).toEqual({ level: "edits", source: "engine_cap" });
      expect(level({ chief: "edits", driverKind: "antigravityAgent" })).toEqual({ level: "edits", source: "chief" });
      // OpenCode, the chat family, engines with no permissive mode of their
      // own, and no engine at all: Full (the harness answers what they
      // leave), nothing below it
      for (const driverKind of ["opencodeGo", "openai-compat", "groq", "kimiAgent", "piAgent", undefined]) {
        expect(level({ chief: "full", driverKind })).toEqual({ level: "full", source: "chief" });
        expect(level({ chief: "auto", driverKind })).toEqual({ level: "ask", source: "engine_cap" });
        expect(level({ chief: "edits", driverKind })).toEqual({ level: "ask", source: "engine_cap" });
      }
    });

    it("says engine_cap whenever the cap lowered the inherited level, down to own included", () => {
      // capped to exactly the bot's own level
      expect(level({ own: "edits", chief: "auto", driverKind: "antigravityAgent" })).toEqual({ level: "edits", source: "engine_cap" });
      // capped below the bot's own level: own wins, and the cap is still why
      expect(level({ own: "edits", chief: "auto", driverKind: "kimiAgent" })).toEqual({ level: "edits", source: "engine_cap" });
      // capped, but still above own
      expect(level({ own: "ask", chief: "auto", driverKind: "antigravityAgent" })).toEqual({ level: "edits", source: "engine_cap" });
      // not capped: the hand-down as it was, Full on every engine
      expect(level({ own: "auto", chief: "full", driverKind: "antigravityAgent" })).toEqual({ level: "full", source: "chief" });
      expect(level({ own: "auto", chief: "full", driverKind: "kimiAgent" })).toEqual({ level: "full", source: "chief" });
    });

    it("agrees with the capability flags for every engine that has a row", () => {
      // what the flags say the engine runs, highest first
      const expected = (inherited: Level, driverKind: string): { level: Level; source: LevelSource } => {
        const caps = engineCapabilities(driverKind);
        const runs: Record<Level, boolean> = { ask: true, edits: caps.edits, auto: caps.nativeReviewer, full: caps.full, custom: false };
        const from = TRAVELS.indexOf(inherited);
        for (let i = from; i >= 0; i--) {
          const candidate = TRAVELS[i]!;
          if (!runs[candidate]) continue;
          if (candidate === "ask") return { level: "ask", source: "engine_cap" };
          return { level: candidate, source: i === from ? "chief" : "engine_cap" };
        }
        throw new Error("unreachable: every engine asks");
      };
      expect(ENGINE_KINDS.length).toBeGreaterThan(0);
      for (const driverKind of ENGINE_KINDS) {
        for (const chief of ["edits", "auto", "full"] as const) {
          expect(level({ own: "ask", chief, driverKind }), `${driverKind} inheriting ${chief}`).toEqual(expected(chief, driverKind));
        }
      }
    });
  });

  it("is pure: the same input gives the same answer and the input is untouched", () => {
    const frozen = Object.freeze(input({ own: "edits", chief: "full", driverKind: "geminiAgent" }));
    expect(assignmentLevel(frozen)).toEqual(assignmentLevel(frozen));
    expect(frozen).toEqual(input({ own: "edits", chief: "full", driverKind: "geminiAgent" }));
  });
});
