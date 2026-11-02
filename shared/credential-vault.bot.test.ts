import { describe, expect, it } from "vitest";

import { botIdFromVaultPrincipal, botVaultPrincipal, isBotVaultPrincipal } from "./credential-vault.ts";

describe("team bot vault principal", () => {
  it("names a bot principal and parses it back", () => {
    expect(botVaultPrincipal("payroll-bot")).toBe("bot:payroll-bot");
    expect(botIdFromVaultPrincipal("bot:payroll-bot")).toBe("payroll-bot");
    expect(isBotVaultPrincipal("bot:payroll-bot")).toBe(true);
    expect(isBotVaultPrincipal("pr_alice")).toBe(false);
    expect(botIdFromVaultPrincipal("pr_alice")).toBeNull();
    expect(() => botVaultPrincipal("../evil")).toThrow(/invalid bot/);
  });
});
