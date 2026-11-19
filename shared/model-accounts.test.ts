// M-20261119-015: the words that name an account, and the one account of
// several a model comes from alone (the "Special access" badge).
import { describe, expect, it } from "vitest";
import { accountWords, isToolName, onlyAccountOffering } from "./model-accounts.ts";

describe("accountWords", () => {
  it("takes the name the person gave the account", () => {
    expect(accountWords({ displayName: "Team", email: "ada@acme.test" }, "Claude")).toBe("Team");
  });

  it("takes the address when the name is the provider's or a tool's", () => {
    expect(accountWords({ displayName: "Claude", email: "ada@acme.test" }, "Claude")).toBe("ada@acme.test");
    expect(accountWords({ displayName: "Claude Code", email: "ada@example.com" }, "Claude")).toBe("ada@example.com");
    expect(isToolName(" claude code ")).toBe(true);
  });

  it("says nothing with neither (the apps number it)", () => {
    expect(accountWords({ displayName: "Claude Code" }, "Claude")).toBeUndefined();
    expect(accountWords({}, "Claude")).toBeUndefined();
  });
});

describe("onlyAccountOffering", () => {
  it("names the one account of two that offers a model", () => {
    expect(onlyAccountOffering(["team"], ["personal", "team"])).toBe("team");
  });

  it("nothing when both offer it, or with one account", () => {
    expect(onlyAccountOffering(["personal", "team"], ["personal", "team"])).toBeUndefined();
    expect(onlyAccountOffering(["team"], ["team"])).toBeUndefined();
  });

  it("an engine that is not one of the accounts (pi) never counts", () => {
    expect(onlyAccountOffering(["team", "pi"], ["personal", "team"])).toBe("team");
  });
});
