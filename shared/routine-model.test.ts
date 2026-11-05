import { describe, expect, it } from "vitest";

import { loadRoutineModel, parseRoutineModel, routineTurnModel, subagentTurnModel } from "./routine-model.ts";

describe("routine model (2026-11-04)", () => {
  it("reads a model id, and null or empty as the bot's model", () => {
    expect(parseRoutineModel(" fast-model ")).toEqual({ ok: true, model: "fast-model" });
    expect(parseRoutineModel("vendor/model-1[1m]")).toEqual({ ok: true, model: "vendor/model-1[1m]" });
    expect(parseRoutineModel(null)).toEqual({ ok: true });
    expect(parseRoutineModel("")).toEqual({ ok: true });
    expect(parseRoutineModel(undefined)).toEqual({ ok: true });
    expect(parseRoutineModel(3).ok).toBe(false);
    expect(parseRoutineModel("two words").ok).toBe(false);
    expect(parseRoutineModel("x".repeat(201)).ok).toBe(false);
    expect(loadRoutineModel("bad id")).toBeUndefined();
  });

  const base = { model: "fast-model", botInstanceId: "engine-a", turnInstanceId: "engine-a", takenOver: false, offered: ["big-model", "fast-model"] };

  it("runs on the routine model on the bot's own engine", () => {
    expect(routineTurnModel(base)).toEqual({ model: "fast-model" });
    // a catalog not known yet does not block it
    expect(routineTurnModel({ ...base, offered: [] })).toEqual({ model: "fast-model" });
  });

  it("does nothing without a model, after a limit takeover, or on another engine", () => {
    expect(routineTurnModel({ ...base, model: undefined })).toBeNull();
    expect(routineTurnModel({ ...base, takenOver: true })).toBeNull();
    expect(routineTurnModel({ ...base, turnInstanceId: "engine-b" })).toBeNull();
  });

  it("is ignored with one line when the engine does not offer it or it is turned off", () => {
    const missing = routineTurnModel({ ...base, model: "other-model" });
    expect(missing && "ignored" in missing && missing.ignored).toMatch(/not offered by this bot's engine/);
    const off = routineTurnModel({ ...base, refusal: "Your organization turned this model off." });
    expect(off && "ignored" in off && off.ignored).toMatch(/turned this model off/);
  });
});

describe("sub-agent model (#2038)", () => {
  const base = { turnInstanceId: "claude-1", botInstanceId: "claude-1" };
  const fast = { instanceId: "claude-1", model: "small-model" };
  it("uses nothing without a routine or a fast model", () => {
    expect(subagentTurnModel(base)).toBeUndefined();
  });
  it("derives it from the fast model on the turn's engine only", () => {
    expect(subagentTurnModel({ ...base, fast })).toBe("small-model");
    expect(subagentTurnModel({ ...base, fast: { ...fast, instanceId: "other-1" } })).toBeUndefined();
    expect(subagentTurnModel({ ...base, turnInstanceId: "other-1", fast })).toBeUndefined();
  });
  it("orders routine sub-agent model, routine model, fast model", () => {
    expect(subagentTurnModel({ ...base, fast, routineModel: "routine-model" })).toBe("routine-model");
    expect(subagentTurnModel({ ...base, fast, routineModel: "routine-model", routineSubagentModel: "sub-model" })).toBe("sub-model");
    expect(subagentTurnModel({ ...base, routineSubagentModel: "sub-model" })).toBe("sub-model");
  });
  it("skips a refused or unlisted sub-agent model and falls to the next rule", () => {
    expect(subagentTurnModel({ ...base, fast, routineSubagentModel: "sub-model", refusal: (m) => (m === "sub-model" ? "off" : undefined) })).toBe("small-model");
    expect(subagentTurnModel({ ...base, fast, routineSubagentModel: "sub-model", offered: ["a"] })).toBe("small-model");
    expect(subagentTurnModel({ ...base, fast, refusal: () => "off" })).toBeUndefined();
  });
  it("yields to a limit takeover", () => {
    expect(subagentTurnModel({ ...base, fast, routineModel: "routine-model", routineSubagentModel: "sub-model", takenOver: true })).toBeUndefined();
  });
});
