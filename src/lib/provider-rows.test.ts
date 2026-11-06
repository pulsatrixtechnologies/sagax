import { describe, expect, it } from "vitest";

import type { InstanceInfo } from "@/state/store";
import type { MyEngine } from "@/lib/perspicax-org";
import { providerGroups, providerRows, splitProviderRows, visibleProviderRows, type ProviderInput } from "./provider-rows";

const instance = (instanceId: string, driverKind: string, access: InstanceInfo["access"], extra: Partial<InstanceInfo> = {}): InstanceInfo => ({
  instanceId, driverKind, displayName: instanceId, access,
  snapshot: { state: "available", authenticated: true },
  models: { default: "", options: [] },
  ...extra,
} as InstanceInfo);

const mine = (instanceId: string, driver: string, facts: Partial<MyEngine>): MyEngine => ({
  instanceId, driver, displayName: instanceId, installed: true,
  subscription: { supported: false, signedIn: false }, myKey: false, orgKey: false, myTurns: "none",
  ...facts,
});

const base = (input: Partial<ProviderInput>): ProviderInput => ({
  organization: false, instances: [], allInstances: [], allowedEngines: null, mine: null, manageKeys: true, savedKeys: [],
  keyRowOf: (driver) => (driver === "codex" ? "openai" : driver === "claudeAgent" ? "anthropic" : driver === "grok" ? "xai" : null),
  apiKeyEngine: (entry) => entry.access === "api",
  ready: (entry) => entry.snapshot.state === "available" && entry.snapshot.authenticated !== false,
  compatServers: [], voiceKeys: null, local: null, keyName: (id) => id,
  ...input,
});

describe("providerRows", () => {
  it("merges a personal key with its engines and lists own voice keys and compatible servers", () => {
    const server = { instanceId: "lab", name: "Lab", url: "https://api.example.com/v1", protocol: "anthropic" as const, models: [{ id: "vendor/model", label: "Model" }] };
    const instances = [instance("codex", "codex", "subscription"), instance("personal-lab", "openai-compat", "api", { providerAccount: { serverId: "lab", provider: "compat:lab" } })];
    const rows = providerRows(base({ organization: true, instances, allInstances: instances, manageKeys: false,
      mine: [mine("codex", "codex", { myKey: true, myTurns: "key", keyWhere: "perspicax" })],
      accounts: { keys: [{ provider: "openai", last4: "abcd" }, { provider: "fish", last4: "efgh" }, { provider: "compat:lab", last4: "ijkl" }], servers: [server] } }));
    expect(rows.filter((row) => row.accountProvider === "openai")).toHaveLength(1);
    expect(rows.find((row) => row.accountProvider === "openai")).toMatchObject({ manage: true, instanceIds: ["codex"], keyWhere: "perspicax" });
    expect(rows.find((row) => row.accountProvider === "fish")).toMatchObject({ payer: "me", keyWhere: "perspicax", brings: ["voice"] });
    expect(rows.filter((row) => row.kind === "server")).toEqual([expect.objectContaining({ accountServer: server, instanceIds: ["personal-lab"], manage: true })]);
  });
  it("solo: a subscription, a key with its engine, a named server, a model of this computer", () => {
    const instances = [
      instance("claude", "claudeAgent", "subscription"),
      instance("openai-api", "codex", "api"),
      instance("compat-azure", "openaiCompat", "custom", { models: { default: "", options: [{ id: "gpt-4.1", label: "gpt-4.1" }, { id: "o4-mini", label: "o4-mini" }] } }),
    ];
    const rows = providerRows(base({
      instances, allInstances: instances, savedKeys: ["openai", "elevenlabs"],
      compatServers: [{ instanceId: "compat-azure", name: "Azure Foundry", configured: true }],
      local: { expose: true, share: false, connected: true, endpoints: [{ id: "e1", baseUrl: "http://127.0.0.1:8000/v1", label: "Ornith" }], published: [{ id: "e1", label: "Ornith", models: ["a", "b"] }], probes: [] },
    }));
    expect(rows.map((row) => [row.id, row.payer, row.keyWhere, row.state])).toEqual([
      ["account:claude", "me", "session", "connected"],
      ["key:me:server:openai", "me", "server", "connected"],
      ["key:me:server:elevenlabs", "me", "server", "connected"],
      ["server:compat-azure", "me", "server", "connected"],
      ["local:e1", "computer", "none", "connected"],
    ]);
    expect(rows.find((row) => row.id === "key:me:server:openai")?.instanceIds).toEqual(["openai-api"]);
    expect(rows.find((row) => row.id === "key:me:server:elevenlabs")?.brings).toEqual(["voice"]);
    expect(rows.find((row) => row.id === "server:compat-azure")?.brings).toEqual([{ models: 2 }]);
    expect(rows.find((row) => row.id === "account:claude")?.claude).toBe(true);
  });

  it("organization: the person's own sign-in, their key in Perspicax or on the server, the organization's key", () => {
    const instances = [instance("claude", "claudeAgent", "subscription"), instance("codex", "codex", "subscription"), instance("grok", "grok", "api")];
    const rows = providerRows(base({
      organization: true, manageKeys: false, instances, allInstances: instances,
      mine: [
        mine("claude", "claudeAgent", { subscription: { supported: true, signedIn: true, expired: true }, myTurns: "expired" }),
        mine("codex", "codex", { subscription: { supported: true, signedIn: false }, myKey: true, keyWhere: "perspicax", myTurns: "key" }),
        mine("grok", "grok", { orgKey: true, myTurns: "org-key" }),
      ],
      voiceKeys: { elevenlabs: { configured: true, last4: null }, fish: { configured: false, last4: null }, xai: { configured: false, last4: null }, openai: { configured: false, last4: null } },
    }));
    const byId = new Map(rows.map((row) => [row.id, row]));
    // an expired sign-in is never connected
    expect(byId.get("account:claude")?.state).toBe("reconnect");
    // not signed in: the sign-in waits under To connect; their key serves it, and its row carries the engine
    expect(byId.get("account:codex")?.state).toBe("available");
    expect(byId.get("key:me:perspicax:openai")?.instanceIds).toEqual(["codex"]);
    expect(byId.get("key:org:server:xai")).toMatchObject({ payer: "org", manage: false, instanceIds: ["grok"] });
    expect(byId.get("voice:elevenlabs")).toMatchObject({ payer: "me", keyWhere: "server", brings: ["voice"] });
  });

  it("a key sealed on the server for the person says so", () => {
    const instances = [instance("cursor", "cursorAgent", "custom")];
    const rows = providerRows(base({
      organization: true, manageKeys: false, instances, allInstances: instances,
      mine: [mine("cursor", "cursorAgent", { keyWhere: "server", myTurns: "key" })],
    }));
    expect(rows).toMatchObject([{ id: "engine:cursor", payer: "me", keyWhere: "server", state: "connected" }]);
  });

  it("an engine left out of the organization's list is turned off by the admin, for everyone", () => {
    const all = [instance("claude", "claudeAgent", "subscription"), instance("kimi", "kimiAgent", "subscription")];
    const rows = providerRows(base({
      organization: true, manageKeys: true, instances: [all[0]], allInstances: all, allowedEngines: ["claude"],
      mine: [mine("claude", "claudeAgent", { subscription: { supported: true, signedIn: true }, myTurns: "subscription" })],
    }));
    const { active, off } = splitProviderRows(rows);
    expect(active.map((row) => row.id)).toEqual(["account:claude"]);
    expect(off).toMatchObject([{ id: "off:kimi", state: "adminOff" }]);
  });

  it("not connected yet waits under To connect, never counted as ready", () => {
    const instances = [instance("codex", "codex", "subscription", { snapshot: { state: "available", authenticated: false } }), instance("mistral", "mistral", "api", { snapshot: { state: "available", authenticated: false } })];
    const { active, toConnect } = splitProviderRows(providerRows(base({ instances, allInstances: instances })));
    expect(active).toEqual([]);
    expect(toConnect.map((row) => [row.id, row.state])).toEqual([["account:codex", "available"], ["engine:mistral", "keyMissing"]]);
  });

  it("groups by provider (#2080): several accounts in one row, connected when one works, else the state to fix", () => {
    const instances = [instance("claude", "claudeAgent", "subscription"), instance("claude-work", "claudeAgent", "subscription"), instance("mistral", "mistral", "api")];
    const signedIn = (expired: boolean) => mine("x", "claudeAgent", { subscription: { supported: true, signedIn: true, expired } });
    const input = (expired: [boolean, boolean]) => base({
      organization: true, manageKeys: false, instances, allInstances: instances,
      mine: [{ ...signedIn(expired[0]), instanceId: "claude" }, { ...signedIn(expired[1]), instanceId: "claude-work" }, mine("mistral", "mistral", { orgKey: true, myTurns: "org-key" })],
    });
    const rows = providerRows(input([false, true]));
    // the organization's key still applies, out of sight
    expect(rows.some((row) => row.payer === "org")).toBe(true);
    const visible = visibleProviderRows(rows);
    expect(visible.some((row) => row.payer === "org")).toBe(false);
    const groups = providerGroups(visible, instances);
    expect(groups.map((group) => [group.name, group.rows.length, group.state])).toEqual([["Claude", 2, "connected"]]);
    // the account to fix comes first inside the group
    expect(groups[0]!.rows.map((row) => row.id)).toEqual(["account:claude-work", "account:claude"]);
    expect(providerGroups(visibleProviderRows(providerRows(input([true, true]))), instances)[0]!.state).toBe("reconnect");
  });

  it("hides what waits to be connected and what the admin turned off", () => {
    const instances = [instance("codex", "codex", "subscription", { snapshot: { state: "available", authenticated: false } }), instance("claude", "claudeAgent", "subscription")];
    expect(visibleProviderRows(providerRows(base({ instances, allInstances: instances }))).map((row) => row.id)).toEqual(["account:claude"]);
  });
});
