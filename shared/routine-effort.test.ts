import { describe, expect, it } from "vitest";
import { EFFORT_LEVELS } from "./model-selection.ts";
import { loadRoutineEffort, parseRoutineEffort, routineTurnEffort } from "./routine-effort.ts";

describe("routine reasoning effort", () => {
  it("reuses bot effort validation and loads old or invalid values as the bot default", () => {
    for (const effort of EFFORT_LEVELS) expect(parseRoutineEffort(effort)).toEqual({ ok: true, effort });
    for (const value of [null, undefined, ""]) expect(parseRoutineEffort(value)).toEqual({ ok: true });
    for (const value of [false, 3, "LOW", "invalid", {}, []]) {
      expect(parseRoutineEffort(value).ok).toBe(false);
      expect(loadRoutineEffort(value)).toBeUndefined();
    }
    expect(loadRoutineEffort("low")).toBe("low");
  });

  const base = { effort: "low" as const, botInstanceId: "codex", turnInstanceId: "codex", takenOver: false, levels: ["low", "high"] as const };
  it("applies only on the bot's own engine, while a limit takeover wins", () => {
    expect(routineTurnEffort(base)).toEqual({ effort: "low" });
    expect(routineTurnEffort({ ...base, effort: undefined })).toBeNull();
    expect(routineTurnEffort({ ...base, takenOver: true })).toBeNull();
    expect(routineTurnEffort({ ...base, turnInstanceId: "backup" })).toBeNull();
  });

  it("explains an unsupported engine or model level instead of passing it to the driver", () => {
    for (const turn of [{ ...base, levels: [] }, { ...base, option: { effortLevels: ["high" as const] } }]) {
      expect(routineTurnEffort(turn)).toEqual({ ignored: expect.stringContaining("this run uses the bot's effort") });
    }
  });
});
