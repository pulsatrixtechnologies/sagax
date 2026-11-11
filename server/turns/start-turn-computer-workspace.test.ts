import { describe, expect, it, vi } from "vitest";
import { createComputerWorkspaceStartTurn } from "./start-turn-computer-workspace.ts";
import { createTurnState } from "./start-turn-state.ts";
import type { StartTurnHost } from "./start-turn-types.ts";

describe("turn plugin preparation", () => {
  it.each(["codex", "grokAgent", "grok", "claudeAgent"])("awaits the person's plugin materialization before dispatch on %s", async (driverKind) => {
    const order: string[] = [];
    let finish!: () => void;
    const copied = new Promise<void>((resolve) => { finish = resolve; });
    const syncPluginsForTurn = vi.fn(async () => { order.push("copy"); await copied; order.push("ready"); });
    const host = {
      IDENTITY: { kind: "perspicax" },
      supportsWorkspaceFiles: () => driverKind !== "grok",
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
    const state = createTurnState({ botId: "bot", text: "Run the pass", opts: {}, startTurn: async () => {} });
    Object.assign(state, {
      bot: { id: "bot", modelSelection: { instanceId: "primary-claude" } },
      instance: { driverKind, adapter: { capabilities: {} } },
      threadId: "thread", dispatchClaimId: "backup-turn", plan: { computer: "off" },
      turnPlace: { principal: "person" }, placedText: {}, integrations: {},
    });
    const preparing = createComputerWorkspaceStartTurn(host)(state).then(() => { order.push("dispatch"); });
    await vi.waitFor(() => expect(syncPluginsForTurn).toHaveBeenCalledWith("person", "backup-turn", "bot"));
    expect(order).toEqual(["copy"]);
    finish();
    await preparing;
    expect(order).toEqual(["copy", "ready", "dispatch"]);
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
