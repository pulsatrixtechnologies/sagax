import { describe, expect, it } from "vitest";

import {
  filterVaultItems,
  resolveVaultFilterTab,
  vaultTabCounts,
} from "./vault-filter";
import type { VaultItemListing } from "../../shared/credential-vault";

const item = (kind: VaultItemListing["kind"], id: string): VaultItemListing => ({
  id, kind, name: id, domains: [], hasPassword: false, hasTotp: false, hasApiKey: false, hasNotes: false,
  source: "local", grants: [], createdAt: 0, updatedAt: 0,
});

describe("vault-filter", () => {
  it("filters items by tab", () => {
    const items = [item("login", "a"), item("card", "b"), item("address", "c"), item("note", "d")];
    expect(filterVaultItems(items, "logins").map((row) => row.id)).toEqual(["a", "d"]);
    expect(filterVaultItems(items, "payments").map((row) => row.id)).toEqual(["b"]);
    expect(filterVaultItems(items, "contacts").map((row) => row.id)).toEqual(["c"]);
    expect(filterVaultItems(items, "all")).toHaveLength(4);
  });

  it("counts payments from cards, wallets, pending and history", () => {
    const counts = vaultTabCounts({
      items: [item("login", "a"), item("card", "b"), item("card", "c")],
      purchases: [{ id: "pay_1", botId: "bot-a", domain: "a.test", merchant: "A", amount: "1.00", currency: "CAD", cardName: "x", cardLast4: "4242", cardBrand: "visa", title: "t", line: "l", status: "pending", createdAt: 1 }],
      history: [{ id: "pay_2", botId: "bot-a", domain: "b.test", merchant: "B", amount: "2.00", currency: "CAD", cardName: "x", cardLast4: "4242", cardBrand: "visa", title: "t", line: "l", status: "once", createdAt: 2 }],
      wallets: {
        shop_pay: { chosen: true, ready: false, missing: "CLI" },
        link: { chosen: false, ready: false, missing: "CLI" },
      },
    });
    expect(counts).toEqual({ all: 3, logins: 1, payments: 2 + 1 + 1 + 1, contacts: 0 });
  });

  it("opens payments from deep links", () => {
    expect(resolveVaultFilterTab({ search: "?tab=payments" })).toBe("payments");
    expect(resolveVaultFilterTab({ hash: "#wallets" })).toBe("payments");
    expect(resolveVaultFilterTab({ requestedCard: "credentials.purchases" })).toBe("payments");
    expect(resolveVaultFilterTab({ search: "?tab=logins" })).toBe("logins");
    expect(resolveVaultFilterTab({})).toBe("all");
  });
});
