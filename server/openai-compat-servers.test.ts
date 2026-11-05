// Named OpenAI-compatible servers (2026-10-30): each its own engine, on its
// own key only, never the workspace's "Other (OpenAI-compatible)" key.
import { describe, expect, it } from "vitest";

import { driverKeyBacked, instanceConfigs, type AppConfig } from "./config.ts";
import {
  addCompatServer,
  canManageCompatServer,
  compatServerOwner,
  compatServers,
  compatServerVisible,
  editCompatServer,
  editCompatServerSchema,
  newCompatServerSchema,
  removeCompatServer,
  strippedUrl,
} from "./openai-compat-servers.ts";

describe("named OpenAI-compatible servers", () => {
  it("keeps a pasted endpoint as its base address (#2022)", () => {
    expect(strippedUrl("https://provider.example/v1/chat/completions")).toBe("https://provider.example/v1");
    expect(strippedUrl("https://provider.example/v1/chat/completions/")).toBe("https://provider.example/v1");
    expect(strippedUrl("https://provider.example/v1/completions")).toBe("https://provider.example/v1");
    expect(strippedUrl("https://provider.example/v1/responses")).toBe("https://provider.example/v1");
    expect(strippedUrl("https://provider.example/v1/models")).toBe("https://provider.example/v1");
    expect(strippedUrl("https://provider.example/compatibility/v1")).toBe("https://provider.example/compatibility/v1");
    expect(addCompatServer({}, undefined, {
      displayName: "Pasted",
      url: "https://provider.example/v1/chat/completions/",
    }, () => "p").instances["compat-p"]).toMatchObject({
      config: { url: "https://provider.example/v1" },
    });
  });

  it("adds a server as an engine of its own, its key apart from the instance", () => {
    const added = addCompatServer({}, undefined, { displayName: " Azure AI Foundry ", url: "https://res.openai.azure.com/openai/v1/", key: "k-azure" }, () => "abc");
    expect(added.instanceId).toBe("compat-abc");
    expect(added.instances["compat-abc"]).toEqual({ driver: "openai-compat", displayName: "Azure AI Foundry", config: { url: "https://res.openai.azure.com/openai/v1", apiKeyEnv: "SAGAX_COMPAT_SERVER_API_KEY" } });
    expect(added.keys).toEqual({ "compat-abc": { key: "k-azure" } });
    expect(JSON.stringify(added.instances)).not.toContain("k-azure");
  });

  it("hands each server its own key, never the workspace's, and lists them without keys", () => {
    const one = addCompatServer({ openaiCompat: { driver: "openai-compat" } }, undefined, { displayName: "Azure", url: "https://res.openai.azure.com/openai/v1", key: "k-azure" }, () => "a1");
    const two = addCompatServer(one.instances, one.keys, { displayName: "vLLM", url: "http://10.0.0.5:8000/v1" }, () => "b2");
    const cfg: AppConfig = { openaiCompat: { key: "k-workspace", url: "https://openrouter.ai/api/v1" }, instances: two.instances, openaiCompatServers: two.keys };
    const map = instanceConfigs(cfg);
    expect(map["compat-a1"]!.environment).toMatchObject({ SAGAX_COMPAT_SERVER_API_KEY: "k-azure" });
    expect(JSON.stringify(map["compat-a1"])).not.toContain("k-workspace");
    expect(JSON.stringify(map["compat-b2"])).not.toContain("k-workspace");
    expect(map["compat-b2"]!.environment?.SAGAX_COMPAT_SERVER_API_KEY).toBeUndefined();
    // the built-in "Other (OpenAI-compatible)" keeps the workspace key
    expect(map.openaiCompat!.environment).toMatchObject({ OPENAI_COMPAT_API_KEY: "k-workspace" });
    // the organization's key: a server with a key is one, a keyless one is not
    expect(driverKeyBacked(cfg, "openai-compat", "compat-a1")).toBe(true);
    expect(driverKeyBacked(cfg, "openai-compat", "compat-b2")).toBe(false);
    expect(compatServers(cfg)).toEqual([
      { instanceId: "compat-a1", name: "Azure", url: "https://res.openai.azure.com/openai/v1", configured: true },
      { instanceId: "compat-b2", name: "vLLM", url: "http://10.0.0.5:8000/v1", configured: false },
    ]);
  });

  it("renames, moves, rekeys and removes; never another engine", () => {
    const added = addCompatServer({ claude: { driver: "claudeAgent" } }, undefined, { displayName: "Gateway", url: "https://gw.example.test/v1", key: "k1" }, () => "g");
    const renamed = editCompatServer(added.instances, added.keys, "compat-g", { displayName: "Gateway EU", key: "k2" })!;
    expect(renamed.instances["compat-g"]).toMatchObject({ displayName: "Gateway EU", config: { url: "https://gw.example.test/v1" } });
    expect(renamed.keys["compat-g"]).toEqual({ key: "k2" });
    expect(editCompatServer(renamed.instances, renamed.keys, "compat-g", { key: "" })!.keys["compat-g"]).toEqual({});
    expect(editCompatServer(renamed.instances, renamed.keys, "claude", { displayName: "x" })).toBeNull();
    const removed = removeCompatServer(renamed.instances, renamed.keys, "compat-g")!;
    expect(removed.instances).toEqual({ claude: { driver: "claudeAgent" } });
    expect(removed.keys).toEqual({});
    expect(removeCompatServer(removed.instances, removed.keys, "claude")).toBeNull();
  });

  it("takes https anywhere, http only on this machine or a private network", () => {
    expect(newCompatServerSchema.safeParse({ displayName: "A", url: "https://x.example.test/v1" }).success).toBe(true);
    expect(newCompatServerSchema.safeParse({ displayName: "A", url: "http://127.0.0.1:8000/v1" }).success).toBe(true);
    expect(newCompatServerSchema.safeParse({ displayName: "A", url: "http://192.168.1.4:11434/v1" }).success).toBe(true);
    expect(newCompatServerSchema.safeParse({ displayName: "A", url: "http://x.example.test/v1" }).success).toBe(false);
    expect(newCompatServerSchema.safeParse({ displayName: "A", url: "https://user:pw@x.example.test/v1" }).success).toBe(false);
    expect(newCompatServerSchema.safeParse({ displayName: "", url: "https://x.example.test/v1" }).success).toBe(false);
    expect(editCompatServerSchema.safeParse({}).success).toBe(false);
  });

  it("stamps a personal owner and keeps org-wide servers visible to everyone (#2054)", () => {
    const personal = addCompatServer({}, undefined, { displayName: "Mine", url: "https://mine.example.test/v1", key: "k" }, () => "p", "pr_alice");
    expect(personal.keys["compat-p"]).toEqual({ key: "k", ownerPrincipalId: "pr_alice" });
    const shared = addCompatServer(personal.instances, personal.keys, { displayName: "Org", url: "https://org.example.test/v1" }, () => "o", null);
    expect(shared.keys["compat-o"]).toEqual({});
    expect(compatServerOwner(shared.keys, "compat-p")).toBe("pr_alice");
    expect(compatServerOwner(shared.keys, "compat-o")).toBeNull();
    expect(canManageCompatServer({ admin: false, principalId: "pr_alice", owner: "pr_alice" })).toBe(true);
    expect(canManageCompatServer({ admin: false, principalId: "pr_bob", owner: "pr_alice" })).toBe(false);
    expect(canManageCompatServer({ admin: false, principalId: "pr_alice", owner: null })).toBe(false);
    expect(canManageCompatServer({ admin: true, principalId: "pr_admin", owner: null })).toBe(true);
    expect(canManageCompatServer({ admin: false, principalId: "pr_alice", owner: undefined })).toBe(true);
    expect(canManageCompatServer({ admin: false, principalId: null, owner: undefined })).toBe(false);
    const cfg: AppConfig = { instances: shared.instances, openaiCompatServers: shared.keys };
    expect(compatServers(cfg, { principalId: "pr_alice", admin: false }).map((row) => row.instanceId)).toEqual(["compat-p", "compat-o"]);
    expect(compatServers(cfg, { principalId: "pr_bob", admin: false }).map((row) => row.instanceId)).toEqual(["compat-o"]);
    expect(compatServers(cfg, { principalId: "pr_admin", admin: true }).map((row) => row.instanceId)).toEqual(["compat-p", "compat-o"]);
    expect(compatServerVisible("pr_alice", { principalId: "pr_bob", admin: false })).toBe(false);
    // clearing the key keeps the owner
    expect(editCompatServer(shared.instances, shared.keys, "compat-p", { key: "" })!.keys["compat-p"]).toEqual({ ownerPrincipalId: "pr_alice" });
  });
});
