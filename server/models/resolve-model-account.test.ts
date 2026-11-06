import { describe, expect, it } from "vitest";
import { nextAccountAfterFailure, resolveModelAccount, type PoolAccount } from "./resolve-model-account.ts";

const account = (partial: Partial<PoolAccount> & Pick<PoolAccount, "instanceId">): PoolAccount => ({
  models: ["claude-sonnet-5"],
  credit: "ok",
  managedPlugins: [],
  ...partial,
});

const selection = { instanceId: "claude-a", model: "claude-sonnet-5", effort: "high" as const };

describe("resolveModelAccount (#2106)", () => {
  it("leaves a single-account pick alone", () => {
    expect(resolveModelAccount({
      selection,
      accounts: [account({ instanceId: "claude-a" })],
    })).toBe(selection);
  });

  it("moves to the sibling with credits when the preferred account is out", () => {
    expect(resolveModelAccount({
      selection,
      accounts: [
        account({ instanceId: "claude-a", credit: "out" }),
        account({ instanceId: "claude-b", credit: "ok" }),
      ],
    })).toEqual({ ...selection, instanceId: "claude-b" });
  });

  it("moves to the sibling that holds the managed MCP plugin the turn needs", () => {
    expect(resolveModelAccount({
      selection,
      accounts: [
        account({ instanceId: "claude-a", managedPlugins: [] }),
        account({ instanceId: "claude-b", managedPlugins: ["docs"] }),
      ],
      neededPlugins: ["docs"],
    })).toEqual({ ...selection, instanceId: "claude-b" });
  });

  it("falls back to the next sibling after a credit or rate-limit refusal", () => {
    expect(nextAccountAfterFailure({
      selection,
      failedInstanceId: "claude-a",
      accounts: [
        account({ instanceId: "claude-a" }),
        account({ instanceId: "claude-b" }),
      ],
    })).toEqual({ ...selection, instanceId: "claude-b" });
  });
});
