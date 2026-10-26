import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { vaultHandle } from "../shared/credential-vault.ts";
import { luhnOk, parsePurchaseCall, parseReceiptCall, purchaseCardText } from "../shared/payment-vault.ts";
import { fillResolverFor } from "./credential-vault.ts";
import { CredentialVault, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";

// Fictional payment values. 4242... is the well-known test number, not a real card.
const PAN = "4242424242424242";
const CVV = "123";
const KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 4) };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function vault(now = () => 1_700_000_000_000) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-pay-"));
  dirs.push(dir);
  return new CredentialVault(dir, () => KEY, now);
}

const card = {
  kind: "card" as const,
  name: "Shop card",
  card: { pan: PAN, cvv: CVV, expMonth: 12, expYear: 2030, holder: "Ada Lovelace" },
};
const address = {
  kind: "address" as const,
  name: "Home",
  address: { recipient: "Ada Lovelace", line1: "1 Rue des Tests", city: "Montreal", region: "QC", postal: "H2X 1Y4", country: "CA" },
};

describe("payment vault", () => {
  it("rejects a number that fails Luhn and never stores it", () => {
    expect(luhnOk(PAN)).toBe(true);
    expect(luhnOk("4242424242424241")).toBe(false);
    const store = vault();
    expect(() => store.create(LOCAL_VAULT_PRINCIPAL, { ...card, card: { ...card.card, pan: "4242424242424241" } })).toThrow(/not valid/);
    expect(store.list(LOCAL_VAULT_PRINCIPAL)).toEqual([]);
  });

  it("lists the last four and never the number or the code", () => {
    const store = vault();
    const created = store.create(LOCAL_VAULT_PRINCIPAL, card);
    expect(created.card).toEqual({ brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, holder: "Ada Lovelace" });
    expect(JSON.stringify(created)).not.toContain(PAN);
    expect(JSON.stringify(created)).not.toContain(CVV);
    expect(store.reveal(LOCAL_VAULT_PRINCIPAL, created.id, "pan")).toBe(PAN);
    expect(store.reveal(LOCAL_VAULT_PRINCIPAL, created.id, "cvv")).toBe(CVV);
    const raw = readFileSync(join(dirs[0]!, "credential-vault.enc"), "utf8");
    expect(raw).not.toContain(PAN);
    expect(raw).not.toContain(CVV);
  });

  it("fills a card only after the person allows the purchase, and only on that site", async () => {
    const store = vault();
    const saved = store.create(LOCAL_VAULT_PRINCIPAL, card);
    const home = store.create(LOCAL_VAULT_PRINCIPAL, address);
    const page = "https://shop.example.test/pay";
    const asked = store.openPurchase(LOCAL_VAULT_PRINCIPAL, {
      botId: "bot-a", threadId: "thread-1", merchant: "Example Shop", pageUrl: page,
      amount: "12.5", currency: "cad", cardId: saved.id, addressId: home.id,
    });
    expect(asked.already).toBe(false);
    expect(asked.listing.title).toBe("Pay 12.50 CAD to Example Shop?");
    expect(asked.note).not.toContain(PAN);
    expect(JSON.stringify(asked.listing)).not.toContain(PAN);
    const blocked = await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, {
      handle: vaultHandle(saved.id), field: "cardNumber", botId: "bot-a", threadId: "thread-1", pageUrl: page,
    });
    expect(blocked.ok).toBe(false);
    const answered = store.answerPurchase(LOCAL_VAULT_PRINCIPAL, asked.listing.id, "once", "Melonie");
    expect(answered.listing.via).toBe("Melonie");
    expect(answered.note).toContain(vaultHandle(saved.id));
    expect(answered.note).not.toContain(PAN);
    const filled = await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, {
      handle: vaultHandle(saved.id), field: "cardNumber", botId: "bot-a", threadId: "thread-1", pageUrl: page,
    });
    expect(filled.ok && filled.value).toBe(PAN);
    const otherSite = await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, {
      handle: vaultHandle(saved.id), field: "cardNumber", botId: "bot-a", threadId: "thread-1", pageUrl: "https://evil.example/pay",
    });
    expect(otherSite.ok).toBe(false);
    const street = await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, {
      handle: vaultHandle(home.id), field: "addressLine1", botId: "bot-a", threadId: "thread-1", pageUrl: page,
    });
    expect(street.ok && street.value).toBe("1 Rue des Tests");
    expect(purchaseCardText({ merchant: "Example Shop", amount: "12.50", currency: "CAD", last4: "4242", brand: "visa" }).line).not.toContain(PAN);
  });

  it("refuses an always grant: every purchase asks again (JC 2026-10-22)", () => {
    const store = vault();
    const saved = store.create(LOCAL_VAULT_PRINCIPAL, card);
    const page = "https://shop.example.test/pay";
    const asked = store.openPurchase(LOCAL_VAULT_PRINCIPAL, {
      botId: "bot-a", threadId: "thread-1", pageUrl: page, amount: "4", currency: "USD", cardId: saved.id,
    });
    expect(() => store.answerPurchase(LOCAL_VAULT_PRINCIPAL, asked.listing.id, "always")).toThrow(/deny or once/);
    expect(store.pendingPurchases(LOCAL_VAULT_PRINCIPAL)).toHaveLength(1);
  });

  it("ignores an always grant saved before the rule: no fill, a new card", async () => {
    let clock = 1_700_000_000_000;
    const store = vault(() => clock);
    const saved = store.create(LOCAL_VAULT_PRINCIPAL, card);
    const page = "https://shop.example.test/pay";
    const asked = store.openPurchase(LOCAL_VAULT_PRINCIPAL, {
      botId: "bot-a", threadId: "thread-1", pageUrl: page, amount: "4", currency: "USD", cardId: saved.id,
    });
    store.answerPurchase(LOCAL_VAULT_PRINCIPAL, asked.listing.id, "once");
    // an old file: the row reads "always", from before the rule
    const raw = (store as unknown as { load(p: string): { purchases: Record<string, { status: string; expiresAt?: number }> } }).load(LOCAL_VAULT_PRINCIPAL);
    raw.purchases[asked.listing.id]!.status = "always";
    delete raw.purchases[asked.listing.id]!.expiresAt;
    clock += 60_000;
    const fill = await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, { handle: vaultHandle(saved.id), field: "cardNumber", botId: "bot-a", threadId: "thread-2", pageUrl: page });
    expect(fill.ok).toBe(false);
    const again = store.openPurchase(LOCAL_VAULT_PRINCIPAL, {
      botId: "bot-a", threadId: "thread-2", pageUrl: page, amount: "4", currency: "USD", cardId: saved.id,
    });
    expect(again.already).toBe(false);
  });

  it("shows the cart on the card and records the receipt, closing a purchase allowed once", () => {
    const store = vault();
    const saved = store.create(LOCAL_VAULT_PRINCIPAL, card);
    const page = "https://shop.example.test/pay";
    const seen: string[] = [];
    const access = fillResolverFor(store, { principalId: LOCAL_VAULT_PRINCIPAL, botId: "bot-a", threadId: "thread-1" }, undefined, (listing) => seen.push(`${listing.status}:${listing.orderRef ?? ""}`));
    expect(access.recordPurchase({ pageUrl: page, orderRef: "A-1" }).ok).toBe(false);
    const asked = access.requestPurchase({
      pageUrl: page, amount: "45.20", currency: "CAD", cardId: saved.id, merchant: "Example Shop",
      items: [{ name: "Cable USB-C", quantity: 2, price: "10.00" }, { name: "Chargeur", quantity: 1 }],
    });
    expect(asked.ok).toBe(true);
    const pending = store.pendingPurchases(LOCAL_VAULT_PRINCIPAL)[0]!;
    expect(pending.line).toMatch(/^3 items\. Card ending 4242/);
    expect(pending.items).toHaveLength(2);
    store.answerPurchase(LOCAL_VAULT_PRINCIPAL, pending.id, "once");
    const recorded = access.recordPurchase({ pageUrl: "https://shop.example.test/thanks", orderRef: "A-1" });
    expect(recorded).toMatchObject({ ok: true });
    expect(recorded.message).toContain("order A-1");
    expect(seen).toEqual(["pending:", "once:A-1"]);
    // the approved cart stays as approved; the receipt sits beside it
    const done = store.purchaseById(LOCAL_VAULT_PRINCIPAL, pending.id)!;
    expect(done.items).toHaveLength(2);
    // allowed once: closed by the receipt, the next payment asks again
    expect(access.recordPurchase({ pageUrl: page, orderRef: "A-2" }).ok).toBe(false);
    const again = access.requestPurchase({ pageUrl: page, amount: "5", currency: "CAD", cardId: saved.id });
    expect(again.message).toContain("Nothing was charged");
    expect(JSON.stringify(seen)).not.toContain(PAN);
  });

  it("parses flights and refuses a bad cart", () => {
    const flights = parsePurchaseCall({ arguments: { credential: "cred_x", amount: "812.40", currency: "CAD", flights: [{ from: "YUL", to: "YVR", date: "2026-11-02", flight: "AC 301" }, { from: "YVR", to: "YUL", date: "2026-11-09" }] } });
    expect(typeof flights !== "string" && flights.flights).toHaveLength(2);
    expect(purchaseCardText({ merchant: "Air", amount: "812.40", currency: "CAD", last4: "4242", brand: "visa", flights: [{ from: "YUL", to: "YVR", date: "2026-11-02" }, { from: "YVR", to: "YUL", date: "2026-11-09" }] }).line).toMatch(/^2 flights\./);
    expect(parsePurchaseCall({ arguments: { credential: "cred_x", amount: "1", currency: "CAD", flights: [{ from: "YUL", to: "YVR", date: "demain" }] } })).toMatch(/flights/);
    expect(parsePurchaseCall({ arguments: { credential: "cred_x", amount: "1", currency: "CAD", items: [{ name: "x", quantity: 0 }] } })).toMatch(/quantity/);
    expect(parseReceiptCall({ arguments: { order_ref: "B-9" } })).toEqual({ orderRef: "B-9" });
    expect(parseReceiptCall({ arguments: { order_ref: "4242 4242 4242 4242" } })).toEqual({});
    expect(parsePurchaseCall({ arguments: { credential: "cred_x", amount: "1", currency: "CAD", items: [{ name: "carte 4242-4242-4242-4242" }] } })).toMatch(/no card number/);
  });

  it("binds a once approval to the amount, the currency and the cart (review)", () => {
    const store = vault();
    const saved = store.create(LOCAL_VAULT_PRINCIPAL, card);
    const page = "https://shop.example.test/pay";
    const ask = (amount: string, items?: Array<{ name: string; quantity: number }>) => store.openPurchase(LOCAL_VAULT_PRINCIPAL, {
      botId: "bot-a", threadId: "thread-1", pageUrl: page, amount, currency: "CAD", cardId: saved.id, ...(items ? { items } : {}),
    });
    const first = ask("10.00", [{ name: "Câble", quantity: 1 }]);
    store.answerPurchase(LOCAL_VAULT_PRINCIPAL, first.listing.id, "once");
    expect(ask("10.00", [{ name: "Câble", quantity: 1 }]).already).toBe(true);
    expect(ask("99.00", [{ name: "Câble", quantity: 1 }]).already).toBe(false);
    expect(ask("10.00", [{ name: "Câble", quantity: 3 }]).already).toBe(false);
  });

  it("uses a once approval at the first card field of any kind, each field once, on that one form (re-review)", async () => {
    let clock = 1_700_000_000_000;
    const store = vault(() => clock);
    const saved = store.create(LOCAL_VAULT_PRINCIPAL, card);
    const page = "https://shop.example.test/pay";
    const asked = store.openPurchase(LOCAL_VAULT_PRINCIPAL, { botId: "bot-a", threadId: "thread-1", pageUrl: page, amount: "10.00", currency: "CAD", cardId: saved.id });
    store.answerPurchase(LOCAL_VAULT_PRINCIPAL, asked.listing.id, "once");
    const fill = (field: "cardNumber" | "cardCvc" | "cardExpiry", form = "form-a", url = page) => store.resolveForFill(LOCAL_VAULT_PRINCIPAL, { handle: vaultHandle(saved.id), field, botId: "bot-a", threadId: "thread-1", pageUrl: url, form });
    // a card on file: the site asks only for the security code
    expect((await fill("cardCvc")).ok).toBe(true);
    // the same code again is a second payment: refused
    expect((await fill("cardCvc")).ok).toBe(false);
    // another form, or another page of the same site: refused
    expect((await fill("cardExpiry", "form-b")).ok).toBe(false);
    expect((await fill("cardExpiry", "form-a", "https://shop.example.test/other")).ok).toBe(false);
    // the rest of the same form, once each, within the window
    expect((await fill("cardNumber")).ok).toBe(true);
    expect((await fill("cardNumber")).ok).toBe(false);
    clock += 11 * 60_000;
    expect((await fill("cardExpiry")).ok).toBe(false);
  });

  it("flags a receipt whose total is not the approved amount", () => {
    const store = vault();
    const saved = store.create(LOCAL_VAULT_PRINCIPAL, card);
    const page = "https://shop.example.test/pay";
    const access = fillResolverFor(store, { principalId: LOCAL_VAULT_PRINCIPAL, botId: "bot-a", threadId: "thread-1" });
    access.requestPurchase({ pageUrl: page, amount: "45.20", currency: "CAD", cardId: saved.id, items: [{ name: "Câble", quantity: 1 }] });
    store.answerPurchase(LOCAL_VAULT_PRINCIPAL, store.pendingPurchases(LOCAL_VAULT_PRINCIPAL)[0]!.id, "once");
    const recorded = access.recordPurchase({ pageUrl: page, orderRef: "A-1", total: "52.00", items: [{ name: "Autre", quantity: 4 }] });
    expect(recorded.message).toContain("does not match");
    const row = store.purchaseById(LOCAL_VAULT_PRINCIPAL, store.listPurchases(LOCAL_VAULT_PRINCIPAL)[0]!.id)!;
    expect(row.items).toEqual([{ name: "Câble", quantity: 1 }]);
    expect(row.receipt).toMatchObject({ orderRef: "A-1", total: "52.00", items: [{ name: "Autre", quantity: 4 }] });
    expect(row.mismatch).toBe(true);
  });

  it("filters card-like text with dots, flight places, and bad dates (review)", () => {
    expect(parsePurchaseCall({ arguments: { credential: "cred_x", amount: "1", currency: "CAD", items: [{ name: "4242.4242.4242.4242" }] } })).toMatch(/card number/);
    expect(parsePurchaseCall({ arguments: { credential: "cred_x", amount: "1", currency: "CAD", flights: [{ from: "4242 4242 4242 4242", to: "YVR", date: "2026-11-02" }] } })).toMatch(/flights/);
    expect(parsePurchaseCall({ arguments: { credential: "cred_x", amount: "1", currency: "CAD", flights: [{ from: "YUL", to: "YVR", date: "2026-13-45" }] } })).toMatch(/flights/);
  });
});
