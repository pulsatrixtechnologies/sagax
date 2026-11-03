import { describe, expect, it, vi } from "vitest";
import { PersonalProviderInstances } from "./personal-provider-instances.ts";
import type { ProviderAccountsView } from "../../shared/provider-accounts.ts";
import type { InstanceConfigMap } from "../contracts.ts";

describe("personal compatible instances", () => {
  it("isolates equal server ids, keys and deletion between people, and retains unchanged instances", async () => {
    const load = vi.fn(async (_configs: InstanceConfigMap) => {}), remove = vi.fn(async (_id: string) => {});
    const fleet = new PersonalProviderInstances({ load, remove });
    const view: ProviderAccountsView = { keys: [], servers: [{ instanceId: "lab", name: "Lab", url: "http://127.0.0.1:8080/v1", protocol: "anthropic", models: [{ id: "vendor/model", label: "Model" }] }] };
    await fleet.sync("person-a", view, async () => "test-key-a");
    await fleet.sync("person-b", view, async () => "test-key-b");
    const a = Object.keys(load.mock.calls[0]![0])[0]!, b = Object.keys(load.mock.calls[1]![0])[0]!;
    expect(a).not.toBe(b);
    expect(fleet.visible(a, "person-b")).toBe(false);
    expect(fleet.get(a)).toMatchObject({ owner: "person-a", provider: "compat:lab" });
    expect(load.mock.calls[0]![0][a]).toMatchObject({ environment: { SAGAX_COMPAT_SERVER_API_KEY: "test-key-a" }, config: { protocol: "anthropic", managedModels: ["vendor/model"], modelNames: { "vendor/model": "Model" } } });
    await fleet.sync("person-a", view, async () => "test-key-a");
    expect(load).toHaveBeenCalledTimes(2);
    await fleet.sync("person-a", { keys: [], servers: [] }, async () => undefined);
    expect(remove).toHaveBeenCalledExactlyOnceWith(a);
    expect(fleet.get(b)?.owner).toBe("person-b");
  });
});
