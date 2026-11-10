// #3294: the vault's ... menu leaves out what cannot apply (never greyed).
import { describe, expect, it } from "vitest";
import { vaultMenuActions } from "./CredentialsSettings";

describe("the vault menu (#3294)", () => {
  it("offers Import and Export when both apply", () => {
    expect(vaultMenuActions({ unavailable: false, exportBlocked: false, empty: false })).toEqual(["import", "export"]);
  });

  it("leaves Export out when the organization turned it off or the vault is empty", () => {
    expect(vaultMenuActions({ unavailable: false, exportBlocked: true, empty: false })).toEqual(["import"]);
    expect(vaultMenuActions({ unavailable: false, exportBlocked: false, empty: true })).toEqual(["import"]);
  });

  it("has no menu at all when the vault is unreachable", () => {
    expect(vaultMenuActions({ unavailable: true, exportBlocked: false, empty: false })).toEqual([]);
  });
});
