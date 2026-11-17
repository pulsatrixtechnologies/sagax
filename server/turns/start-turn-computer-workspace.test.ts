import { describe, expect, it, vi } from "vitest";
import { createComputerWorkspaceStartTurn } from "./start-turn-computer-workspace.ts";
import { createTurnState } from "./start-turn-state.ts";
import type { StartTurnHost } from "./start-turn-types.ts";

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
  // #4456: every turn of a hosted server waited 24 to 283 ms (up to a second)
  // for the plugin copy; what needs the plugins waits for the copy itself
  it.each(["codex", "grokAgent", "grok", "claudeAgent"])("starts the plugin copy and goes on to dispatch without waiting for it on %s (#4456)", async (driverKind) => {
    const order: string[] = [];
    let finish!: () => void;
    const copied = new Promise<void>((resolve) => { finish = resolve; });
    const syncPluginsForTurn = vi.fn(async () => { order.push("copy"); await copied; order.push("ready"); });
    const startedAt = Date.now();
    await createComputerWorkspaceStartTurn(workspaceHost(syncPluginsForTurn))(workspaceState(driverKind)).then(() => { order.push("dispatch"); });
    // no wait at all: before #4456 the turn waited up to a second here
    expect(Date.now() - startedAt).toBeLessThan(300);
    expect(syncPluginsForTurn).toHaveBeenCalledWith("person", "backup-turn", "bot");
    expect(order).toEqual(["copy", "dispatch"]);
    finish();
    await vi.waitFor(() => expect(order).toEqual(["copy", "dispatch", "ready"]));
  });

  // #4394: a turn waited 5 min 20 s behind a plugin copy into an environment
  // still starting (queueBy plugins:310873), and the copy failed anyway
  it("never holds the turn while a copy waits on an environment that takes minutes, and a failed copy stays beside it (#4394)", async () => {
    const order: string[] = [];
    const syncPluginsForTurn = vi.fn(async () => { order.push("copy"); await new Promise((resolve) => setTimeout(resolve, 20)); throw new Error("environment still starting"); });
    await createComputerWorkspaceStartTurn(workspaceHost(syncPluginsForTurn))(workspaceState()).then(() => { order.push("dispatch"); });
    expect(order).toEqual(["copy", "dispatch"]);
    await new Promise((resolve) => setTimeout(resolve, 40));
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
