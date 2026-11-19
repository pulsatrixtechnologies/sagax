import { describe, expect, it } from "vitest";
import { accountsOpenTo, nextAccountAfterFailure, resolveModelAccount, type PoolAccount } from "./resolve-model-account.ts";
import { turnPayer } from "../engines/engine-credentials.ts";

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

// M-20261119-015: a turn moves only among the organization's accounts and
// the person's own; another person's added account never runs it.
describe("accountsOpenTo", () => {
  const owners: Record<string, string | undefined> = { claude: undefined, "claude-ada": "ada", "claude-nimbus": "nimbus" };
  const ownerOf = (instanceId: string) => owners[instanceId];
  const all = [{ instanceId: "claude" }, { instanceId: "claude-ada" }, { instanceId: "claude-nimbus" }];

  it("keeps the organization's accounts and the person's own", () => {
    expect(accountsOpenTo(all, ownerOf, "ada", "claude").map((entry) => entry.instanceId)).toEqual(["claude", "claude-ada"]);
  });

  it("keeps the account picked, whoever holds it", () => {
    expect(accountsOpenTo(all, ownerOf, "ada", "claude-nimbus").map((entry) => entry.instanceId)).toEqual(["claude", "claude-ada", "claude-nimbus"]);
  });

  it("a solo server has one person: every account", () => {
    expect(accountsOpenTo(all, () => undefined, null, "claude")).toHaveLength(3);
  });

  it("never moves a person's turn onto another person's account with more credit", () => {
    const accounts = accountsOpenTo([
      account({ instanceId: "claude-ada", credit: "rate_limited" }),
      account({ instanceId: "claude-nimbus", credit: "ok" }),
    ], ownerOf, "ada", "claude-ada");
    const next = resolveModelAccount({ selection: { ...selection, instanceId: "claude-ada" }, accounts });
    expect(next.instanceId).toBe("claude-ada");
  });

  it("the owner pays for the people who write to the bot: the owner's accounts, never the writer's", () => {
    // Nimbus writes to Ada's bot, Ada pays (#1137): the turn may move to
    // Ada's account, never to Nimbus's (resolveEngineAccess refuses it)
    const payer = turnPayer({
      speaker: { origin: "person", principalId: "nimbus" },
      owner: { principalId: "ada" },
      payerMode: "owner",
    }).principalId;
    expect(payer).toBe("ada");
    const pool = [
      account({ instanceId: "claude", credit: "rate_limited" }),
      account({ instanceId: "claude-ada" }),
      account({ instanceId: "claude-nimbus", credit: "ok" }),
    ];
    const accounts = accountsOpenTo(pool, ownerOf, payer, "claude");
    expect(accounts.map((entry) => entry.instanceId)).toEqual(["claude", "claude-ada"]);
    expect(resolveModelAccount({ selection: { ...selection, instanceId: "claude" }, accounts }).instanceId).toBe("claude-ada");
  });
});
