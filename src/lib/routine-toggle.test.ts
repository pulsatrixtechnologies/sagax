import { describe, expect, it, vi } from "vitest";
import type { Routine } from "./routines";
import { flipRoutine } from "./routine-toggle";

const routine = {
  id: "5b0f2a1e-0000-4000-8000-000000000001", name: "Dispatch matin", prompt: "x", target: "bot", botId: "b", runOn: "maus",
  enabled: true, schedule: { type: "daily", time: "01:30" }, durationMinutes: 5, nextRunAt: 1, createdAt: 0, updatedAt: 0,
} as Routine;

describe("flipRoutine", () => {
  it("shows the change at once, then keeps the server's routine", async () => {
    const dispatch = vi.fn();
    const saved = { ...routine, enabled: false, updatedAt: 9 };
    const api = vi.fn().mockResolvedValue({ routine: saved });
    await flipRoutine(routine, new Set(), api, dispatch);
    expect(dispatch.mock.calls[0]![0].routine.enabled).toBe(false);
    expect(api).toHaveBeenCalledWith(`/api/routines/${routine.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
    expect(dispatch).toHaveBeenLastCalledWith({ type: "routinePatched", routine: saved });
  });

  it("puts the row back and says so by name, without an id, on failure", async () => {
    const dispatch = vi.fn();
    await flipRoutine(routine, new Set(), vi.fn().mockRejectedValue(new Error("boom")), dispatch);
    expect(dispatch.mock.calls[1]![0]).toEqual({ type: "routinePatched", routine });
    const message = dispatch.mock.calls[2]![0].message as string;
    expect(message).toContain("Dispatch matin");
    expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("does nothing for a read-only routine or while a request is pending", async () => {
    const dispatch = vi.fn();
    const api = vi.fn().mockResolvedValue({});
    await flipRoutine({ ...routine, canEdit: false }, new Set(), api, dispatch);
    await flipRoutine(routine, new Set([routine.id]), api, dispatch);
    expect(api).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
