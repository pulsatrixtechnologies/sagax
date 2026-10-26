import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api }));

import { loadWorkingBots, stopWorkingBot } from "./computer-working-bots";

afterEach(() => fixture.api.mockReset());

describe("computer working bots lib", () => {
  it("reads the list from the working-bots endpoint", async () => {
    fixture.api.mockResolvedValue({ bots: [{ id: "b1", name: "Katarina", threadId: "t1" }] });
    expect(await loadWorkingBots()).toEqual([{ id: "b1", name: "Katarina", threadId: "t1" }]);
    expect(fixture.api).toHaveBeenCalledWith("/api/computer/working-bots", {});
  });

  it("tolerates a body without bots", async () => {
    fixture.api.mockResolvedValue({});
    expect(await loadWorkingBots()).toEqual([]);
  });

  it("stops a bot through the ordinary task stop, by thread", async () => {
    fixture.api.mockResolvedValue({ ok: true });
    await stopWorkingBot({ id: "b2", name: "Ember", threadId: "t2" });
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/b2/interrupt", { method: "POST", body: JSON.stringify({ threadId: "t2" }) });
  });
});
