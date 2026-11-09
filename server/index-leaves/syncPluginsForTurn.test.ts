import { describe, expect, it } from "vitest";
import { createSyncPluginsForTurn, PLUGIN_SYNC_EXEC_SLOTS, withPluginSyncSlot } from "./syncPluginsForTurn.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function hostWith(sync: (principalId: string, botId: string, limit: <T>(task: () => Promise<T>) => Promise<T>) => Promise<void>) {
  return {
    userSandbox: {},
    pluginSyncedGenerations: new Map<string, Promise<void>>(),
    pluginSyncInFlight: new Map<string, Promise<void>>(),
    pluginSyncSlots: new Map(),
    reportBackgroundError: () => undefined,
    syncPluginFoldersForTurn: sync
  };
}

describe("syncPluginsForTurn (#3083)", () => {
  it("lets two turns of one person in different conversations copy in parallel", async () => {
    const firstExec = deferred();
    const host = hostWith(async (_principal, botId, limit) => {
      if (botId === "bot-a") await limit(() => firstExec.promise);
      else await limit(async () => undefined);
    });
    const sync = createSyncPluginsForTurn(() => host);
    let firstDone = false;
    const first = sync("person", "turn-1", "bot-a").then(() => { firstDone = true; });
    // The second turn finishes while the first one's command is still running.
    await sync("person", "turn-2", "bot-b");
    expect(firstDone).toBe(false);
    firstExec.resolve();
    await first;
    expect(firstDone).toBe(true);
  });

  it("joins a copy already running for the same bot", async () => {
    const gate = deferred();
    let calls = 0;
    const host = hostWith(async () => { calls += 1; await gate.promise; });
    const sync = createSyncPluginsForTurn(() => host);
    const a = sync("person", "turn-1", "bot-a");
    const b = sync("person", "turn-2", "bot-a");
    gate.resolve();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
    expect(host.pluginSyncInFlight.size).toBe(0);
  });

  it("keeps the person's copy commands under the slot limit", async () => {
    const slots = new Map();
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, deferred);
    const runs = gates.map((gate) => withPluginSyncSlot(slots, "person", async () => {
      running += 1; peak = Math.max(peak, running);
      await gate.promise;
      running -= 1;
    }));
    await Promise.resolve();
    expect(running).toBe(PLUGIN_SYNC_EXEC_SLOTS);
    gates.forEach((gate) => gate.resolve());
    await Promise.all(runs);
    expect(peak).toBe(PLUGIN_SYNC_EXEC_SLOTS);
    expect(slots.size).toBe(0);
  });
});
