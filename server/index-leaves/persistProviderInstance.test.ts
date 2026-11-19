import { describe, expect, it, vi } from "vitest";

import { createPersistProviderInstance } from "./persistProviderInstance.ts";

function fakeHost() {
  const steps: string[] = [];
  const live = { instanceId: "claude-work", dispose: vi.fn(async () => { steps.push("dispose"); }) };
  const byId = new Map<string, unknown>([["claude-work", live]]);
  const host = {
    cfg: { instances: {} },
    saveConfig: () => { steps.push("save"); },
    instanceConfigs: () => ({}),
    providerAuthSessions: { clearInstance: () => {} },
    bus: { detach: (id: string) => { steps.push(`detach ${id}`); }, attach: () => {} },
    registry: {
      get: (id: string) => byId.get(id),
      release: (id: string) => { const found = byId.get(id); byId.delete(id); steps.push(`release ${id}`); return found; },
      dispose: async (id: string) => { const found = byId.get(id) as typeof live | undefined; byId.delete(id); await found?.dispose(); },
      load: async () => {},
    },
    resetPathCache: () => {},
    runningTurnEngines: new Map<string, unknown>(),
  };
  return { host, live, steps, byId };
}

describe("persistProviderInstance: an account removed mid-turn (2026-11-19)", () => {
  it("leaves the lists at once and stops its engine only once the turn is over", async () => {
    vi.useFakeTimers();
    try {
      const { host, live, steps, byId } = fakeHost();
      host.runningTurnEngines.set("thread-1", live);
      await createPersistProviderInstance(() => host)("claude-work", {});
      expect(byId.has("claude-work")).toBe(false);
      // the turn keeps its engine and its events
      expect(steps).toEqual(["save", "release claude-work"]);
      expect(live.dispose).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(live.dispose).not.toHaveBeenCalled();
      host.runningTurnEngines.delete("thread-1");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(steps.slice(2)).toEqual(["detach claude-work", "dispose"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an idle account goes at once", async () => {
    const { host, live, steps } = fakeHost();
    await createPersistProviderInstance(() => host)("claude-work", {});
    expect(steps).toEqual(["save", "detach claude-work", "dispose"]);
    expect(live.dispose).toHaveBeenCalledOnce();
  });
});
