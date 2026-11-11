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
