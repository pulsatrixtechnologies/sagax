import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api, MESSAGE_PAGE_SIZE: 50 }));

import { dispatchRoutinesEffects } from "./dispatch-routines";

const routine = { id: "r1", name: "Morning", enabled: true };

function env() {
  const rawDispatch = vi.fn();
  const showError = vi.fn();
  const stateRef = { current: { routines: [routine], bots: [], selectedId: null } };
  return { rawDispatch, showError, ctx: { rawDispatch, showError, stateRef, executionBotsBeforeAction: [] } as never };
}

describe("the Active / Pause switch", () => {
  beforeEach(() => { api.mockReset(); });

  it("flips the routine at once, before the server answers", () => {
    api.mockReturnValue(new Promise(() => {}));
    const { rawDispatch, ctx } = env();
    dispatchRoutinesEffects({ type: "updateRoutine", routineId: "r1", patch: { enabled: false } }, ctx);
    expect(rawDispatch).toHaveBeenCalledWith({ type: "routinePatched", routine: { ...routine, enabled: false } });
    expect(api).toHaveBeenCalledWith("/api/routines/r1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) }));
  });

  it("puts the switch back and says why when the request fails", async () => {
    const failure = new Error("nope");
    api.mockRejectedValue(failure);
    const { rawDispatch, showError, ctx } = env();
    dispatchRoutinesEffects({ type: "updateRoutine", routineId: "r1", patch: { enabled: false } }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rawDispatch).toHaveBeenLastCalledWith({ type: "routinePatched", routine });
    expect(showError).toHaveBeenCalledWith(failure);
  });

  it("leaves other patches (a rename) to the server's answer", () => {
    api.mockReturnValue(new Promise(() => {}));
    const { rawDispatch, ctx } = env();
    dispatchRoutinesEffects({ type: "updateRoutine", routineId: "r1", patch: { name: "x" } }, ctx);
    expect(rawDispatch).not.toHaveBeenCalled();
  });
});
