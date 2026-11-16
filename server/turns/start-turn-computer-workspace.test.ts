import { describe, expect, it, vi } from "vitest";
import { createComputerWorkspaceStartTurn } from "./start-turn-computer-workspace.ts";
import { createTurnState } from "./start-turn-state.ts";
import type { StartTurnHost } from "./start-turn-types.ts";
import { PLUGIN_COPY_TURN_WAIT_MS } from "../index-leaves/syncPluginsForTurn.ts";

function workspaceHost(syncPluginsForTurn: (principal: string, generation: string, botId: string) => Promise<unknown>): StartTurnHost {
  return {
    IDENTITY: { kind: "perspicax" },
    supportsWorkspaceFiles: () => true,
    ensureWorkspace: vi.fn(), ensureTaskWorkspace: () => "/fixture/task",
    beginMemoryTurn: vi.fn(), renderSkillInstructions: () => "", installedPlaybookInstructions: () => "",
    cloudGuestOpened: () => false, inheritedTeamComputer: () => undefined,
    remoteComputerForTurn: () => ({ skipRemote: true }),
    mountUserSandbox: vi.fn(), mountPersonalMcp: vi.fn(), mountPluginMcp: vi.fn(),
    store: { pinTaskCwd: () => "/fixture/task", isConfidentialThread: () => false, taskByThread: () => ({}) },
    syncPluginsForTurn,
    turnTrace: vi.fn(),
    directTurnClaimIsCurrent: () => true, DirectTurnSetupCancelled: class extends Error {},
  } as unknown as StartTurnHost;
}

function workspaceState(driverKind = "grokAgent") {
  const state = createTurnState({ botId: "bot", text: "Run the pass", opts: {}, startTurn: async () => {} });
  Object.assign(state, {
    bot: { id: "bot", modelSelection: { instanceId: "primary-claude" } },
    instance: { driverKind, adapter: { capabilities: {} } },
    threadId: "thread", dispatchClaimId: "backup-turn", plan: { computer: "off" },
    turnPlace: { principal: "person" }, placedText: {}, integrations: {},
  });
  return state;
}

describe("turn plugin preparation", () => {
  it.each(["codex", "grokAgent", "grok", "claudeAgent"])("waits for a quick plugin copy before dispatch on %s", async (driverKind) => {
    const order: string[] = [];
    let finish!: () => void;
    const copied = new Promise<void>((resolve) => { finish = resolve; });
    const syncPluginsForTurn = vi.fn(async () => { order.push("copy"); await copied; order.push("ready"); });
    const preparing = createComputerWorkspaceStartTurn(workspaceHost(syncPluginsForTurn))(workspaceState(driverKind)).then(() => { order.push("dispatch"); });
    await vi.waitFor(() => expect(syncPluginsForTurn).toHaveBeenCalledWith("person", "backup-turn", "bot"));
    expect(order).toEqual(["copy"]);
    finish();
    await preparing;
    expect(order).toEqual(["copy", "ready", "dispatch"]);
  });

  // #4394: a turn waited 5 min 20 s behind a plugin copy into an environment
  // still starting (queueBy plugins:310873), and the copy failed anyway
  it("starts the turn after at most a second while a copy waits on an environment that takes minutes (#4394)", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      let finish!: () => void;
      // the environment answers after five minutes
      const copied = new Promise<void>((resolve) => { finish = resolve; });
      setTimeout(() => finish(), 5 * 60_000);
      const syncPluginsForTurn = vi.fn(async () => { order.push("copy"); await copied; order.push("ready"); });
      const preparing = createComputerWorkspaceStartTurn(workspaceHost(syncPluginsForTurn))(workspaceState()).then(() => { order.push("dispatch"); });
      await vi.advanceTimersByTimeAsync(PLUGIN_COPY_TURN_WAIT_MS - 1);
      expect(order).toEqual(["copy"]);
      await vi.advanceTimersByTimeAsync(1);
      await preparing;
      // the turn went on; the copy did not stop
      expect(order).toEqual(["copy", "dispatch"]);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(order).toEqual(["copy", "dispatch", "ready"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never starts memory tracking for a setup a Stop already freed (#3300)", async () => {
    class DirectTurnSetupCancelled extends Error {}
    const beginMemoryTurn = vi.fn();
    const ensureWorkspace = vi.fn();
    const host = {
      supportsWorkspaceFiles: () => true, ensureWorkspace, beginMemoryTurn,
      directTurnClaimIsCurrent: () => false, DirectTurnSetupCancelled,
    } as unknown as StartTurnHost;
    const state = createTurnState({ botId: "bot", text: "Run the pass", opts: {}, startTurn: async () => {} });
    Object.assign(state, {
      bot: { id: "bot", modelSelection: { instanceId: "primary-claude" } },
      instance: { driverKind: "claudeAgent", adapter: { capabilities: {} } },
      threadId: "thread", dispatchClaimId: "stopped-turn",
    });
    await expect(createComputerWorkspaceStartTurn(host)(state)).rejects.toBeInstanceOf(DirectTurnSetupCancelled);
    expect(ensureWorkspace).not.toHaveBeenCalled();
    expect(beginMemoryTurn).not.toHaveBeenCalled();
  });
});
