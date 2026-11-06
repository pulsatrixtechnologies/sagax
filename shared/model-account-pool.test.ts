import { describe, expect, it } from "vitest";
import { pickAccountForModel, type PoolAccount } from "./model-account-pool.ts";

const account = (partial: Partial<PoolAccount> & Pick<PoolAccount, "instanceId">): PoolAccount => ({
  models: ["claude-sonnet-5", "claude-opus-5"],
  credit: "ok",
  managedPlugins: [],
  ...partial,
});

describe("pickAccountForModel (#2106)", () => {
  it("picks the account that still has credits when the preferred one is out", () => {
    const accounts = [
      account({ instanceId: "claude-a", credit: "out" }),
      account({ instanceId: "claude-b", credit: "ok" }),
    ];
    expect(pickAccountForModel({
      model: "claude-sonnet-5",
      accounts,
      preferredInstanceId: "claude-a",
    })).toBe("claude-b");
  });

  it("picks the account that holds the managed MCP plugin the turn needs", () => {
    const accounts = [
      account({ instanceId: "claude-a", managedPlugins: ["packing"] }),
      account({ instanceId: "claude-b", managedPlugins: ["docs", "notes"] }),
    ];
    expect(pickAccountForModel({
      model: "claude-sonnet-5",
      accounts,
      preferredInstanceId: "claude-a",
      neededPlugins: ["docs"],
    })).toBe("claude-b");
  });

  it("falls back to the next account after a rate-limit or credit skip", () => {
    const accounts = [
      account({ instanceId: "claude-a", credit: "ok" }),
      account({ instanceId: "claude-b", credit: "ok" }),
      account({ instanceId: "claude-c", credit: "ok" }),
    ];
    expect(pickAccountForModel({
      model: "claude-sonnet-5",
      accounts,
      preferredInstanceId: "claude-a",
      skip: ["claude-a", "claude-b"],
    })).toBe("claude-c");
  });

  it("keeps the preferred account when it can run the model and has credit", () => {
    const accounts = [
      account({ instanceId: "claude-a", credit: "ok" }),
      account({ instanceId: "claude-b", credit: "ok" }),
    ];
    expect(pickAccountForModel({
      model: "claude-sonnet-5",
      accounts,
      preferredInstanceId: "claude-a",
    })).toBe("claude-a");
  });

  it("returns null when no account can run the model", () => {
    expect(pickAccountForModel({
      model: "claude-sonnet-5",
      accounts: [account({ instanceId: "claude-a", models: ["other"], credit: "ok" })],
    })).toBeNull();
  });
});
