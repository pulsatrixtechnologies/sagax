import { describe, expect, it, vi } from "vitest";
import { createProviderAccountsFailureLog, ProviderAccountsError } from "../engines/provider-accounts.ts";
import { createInstancesForViewer } from "./instancesForViewer.ts";

describe("instancesForViewer provider sync (#3519)", () => {
  it("logs a failed provider sync by its step and kind of provider, once, never as the generic background line", async () => {
    const lines: string[] = [];
    const failures = createProviderAccountsFailureLog((line) => lines.push(line));
    const sync = vi.fn(async (_owner: unknown) => { throw Object.assign(new ProviderAccountsError(503), { step: "list" as const, upstream: "unreachable" }); });
    const reportBackgroundError = vi.fn();
    const host = {
      IDENTITY: { kind: "solo" },
      providerAccountOwner: () => undefined,
      syncPersonalProviders: sync,
      syncPersonalProvidersInBackground: (owner: unknown) => failures.run("solo", () => sync(owner)),
      reportBackgroundError,
      describeInstances: async () => [],
      refusedModelsFor: () => [],
      personalProviderInstances: { visible: () => true, get: () => undefined },
      overlayModelServers: (instances: unknown[]) => instances,
      piModelServersForViewer: async () => [],
    };
    const instancesForViewer = createInstancesForViewer(() => host);
    await instancesForViewer(null);
    await instancesForViewer(null);
    expect(reportBackgroundError).not.toHaveBeenCalled();
    expect(lines).toEqual(["provider accounts: the list step failed (organization server: unreachable)"]);
  });
});

describe("instancesForViewer account names (#4376)", () => {
  it("shows a person the name they gave one of their accounts, and nobody else", async () => {
    const names: Record<string, string> = { "pr_alice:codex": "Work plan" };
    const host = {
      IDENTITY: { kind: "perspicax" },
      providerAccountOwner: () => null,
      describeInstances: async () => [{ instanceId: "codex", displayName: "Codex" }, { instanceId: "claude", displayName: "Claude" }],
      refusedModelsFor: () => [],
      personalProviderInstances: { visible: () => true, get: () => undefined },
      compatServerVisible: () => true,
      orgOfferedEngines: (instances: unknown[]) => instances,
      piKeyProviders: { forViewer: () => [] },
      overlayModelServers: (instances: unknown[]) => instances,
      piModelServersForViewer: async () => [],
      desktopLocalModels: { overlay: (instances: unknown[]) => instances },
      accountNames: { get: (person: string | null, id: string) => (person ? names[`${person}:${id}`] : undefined) },
    };
    const instancesForViewer = createInstancesForViewer(() => host);
    expect((await instancesForViewer("pr_alice")).map((entry: { displayName: string }) => entry.displayName)).toEqual(["Work plan", "Claude"]);
    expect((await instancesForViewer("pr_bob")).map((entry: { displayName: string }) => entry.displayName)).toEqual(["Codex", "Claude"]);
  });
});
