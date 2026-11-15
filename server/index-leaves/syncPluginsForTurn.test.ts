import { describe, expect, it } from "vitest";
import { createSyncPluginsForTurn, PLUGIN_SYNC_EXEC_SLOTS, withPluginSyncSlot } from "./syncPluginsForTurn.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function hostWith(sync: (principalId: string, botId: string, limit: <T>(task: () => Promise<T>) => Promise<T>) => Promise<unknown>) {
  return {
    pluginCopyFailures: { forgotten: [] as string[], forgetPerson(person: string) { this.forgotten.push(person); } },
    userSandbox: {} as Record<string, unknown>,
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

  // #4394: a copy cut by an environment still starting was only tried again
  // at a later turn, after its pause, or if another call happened to wait
  it("a copy cut by the environment's start waits for it to be up, then copies again without the pause (#4394)", async () => {
    const left = [true, false];
    const calls: string[] = [];
    let cuts = 0;
    const up = deferred();
    const host = hostWith(async (principal, botId) => {
      calls.push(`${principal}/${botId}`);
      if (calls.length === 1) cuts += 1;
      return left.shift();
    });
    const asked: string[] = [];
    host.userSandbox = {
      startingCuts: () => cuts,
      whenUp: async (principal: string, botId: string) => { asked.push(`${principal}/${botId}`); await up.promise; return true; },
    };
    const sync = createSyncPluginsForTurn(() => host);
    const copy = sync("person", "turn-1", "bot-a");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // the copy waits for the environment itself, nothing else of the person does
    expect(asked).toEqual(["person/bot-a"]);
    expect(calls).toEqual(["person/bot-a"]);
    // a later turn of the same bot joins the same copy
    const joined = sync("person", "turn-2", "bot-a");
    expect(host.pluginSyncInFlight.size).toBe(1);
    up.resolve();
    await Promise.all([copy, joined]);
    expect(calls).toEqual(["person/bot-a", "person/bot-a"]);
    expect(host.pluginCopyFailures.forgotten).toEqual(["person"]);
    expect(host.pluginSyncInFlight.size).toBe(0);
  });

  it("a copy that left plugins for another reason, or whose environment did not come up, is not copied again at once", async () => {
    const calls: string[] = [];
    let cuts = 0;
    const host = hostWith(async (principal, botId) => { calls.push(`${principal}/${botId}`); if (botId === "bot-b") cuts += 1; return true; });
    host.userSandbox = { startingCuts: () => cuts, whenUp: async () => false };
    const sync = createSyncPluginsForTurn(() => host);
    // a command failed, no start cut: the failed copy's pause applies
    await sync("person", "turn-1", "bot-a");
    // cut by the start, but the environment never came up
    await sync("person", "turn-1", "bot-b");
    expect(calls).toEqual(["person/bot-a", "person/bot-b"]);
    expect(host.pluginCopyFailures.forgotten).toEqual([]);
  });
});
