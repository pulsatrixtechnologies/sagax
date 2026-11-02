// Order tracking on a purchase and the Full approval level (2026-10-29).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CredentialVault, fillResolverFor, LOCAL_VAULT_PRINCIPAL, type PurchaseListing } from "./credential-vault.ts";
import { purchaseCardFallback, purchaseOutboundCard } from "../outbound-wiring.ts";
import type { VaultKeySource } from "../mcp-oauth.ts";

// 4242... is the well-known test number, not a real card.
const KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 7) };
const card = { kind: "card" as const, name: "Shop card", card: { pan: "4242424242424242", cvv: "123", expMonth: 12, expYear: 2030, holder: "Ada Lovelace" } };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-orders-"));
  dirs.push(dir);
  let now = 1_700_000_000_000;
  const store = new CredentialVault(dir, () => KEY, () => now);
  const saved = store.create(LOCAL_VAULT_PRINCIPAL, card);
  return { store, saved, tick: (ms: number) => { now += ms; } };
}

const page = "https://shop.example.test/checkout";
const context = { principalId: LOCAL_VAULT_PRINCIPAL, botId: "bot-a", threadId: "thread-1" };

describe("order tracking on a purchase", () => {
  it("starts following an order at record_purchase and moves it with update_order_tracking", () => {
    const { store, saved, tick } = setup();
    const seen: PurchaseListing[] = [];
    const orders: Array<[string, number]> = [];
    const access = fillResolverFor(store, context, undefined, (listing) => seen.push(listing), { onOrder: (listing, hours) => orders.push([listing.tracking!.step, hours]) });
    access.requestPurchase({ pageUrl: page, amount: "189.99", currency: "CAD", cardId: saved.id, merchant: "Audio Shop" });
    store.answerPurchase(LOCAL_VAULT_PRINCIPAL, store.pendingPurchases(LOCAL_VAULT_PRINCIPAL)[0]!.id, "once");
    expect(access.recordPurchase({ pageUrl: "https://shop.example.test/thanks", orderRef: "A-1", tracking: { step: "ordered", carrier: "UPS" } }).ok).toBe(true);
    expect(orders).toEqual([["ordered", 24]]);
    tick(60_000);
    // from a routine's conversation: found by its order number
    const elsewhere = fillResolverFor(store, { ...context, threadId: "thread-2" }, undefined, (listing) => seen.push(listing), { onOrder: (listing, hours) => orders.push([listing.tracking!.step, hours]) });
    const moved = elsewhere.updateTracking({ orderRef: "a-1", tracking: { step: "shipped", number: "1Z999", eta: "2026-11-02" }, checkAgainHours: 12 });
    expect(moved).toMatchObject({ ok: true });
    expect(moved.message).toContain("Shipped, UPS 1Z999, expected 2026-11-02");
    const listing = seen.at(-1)!;
    // the card is the purchase's own, in its own conversation
    expect(listing.threadId).toBe("thread-1");
    expect(listing.tracking).toMatchObject({ step: "shipped", carrier: "UPS", number: "1Z999", eta: "2026-11-02" });
    expect(purchaseOutboundCard(listing, "Nova").tracking?.step).toBe("shipped");
    expect(purchaseCardFallback(listing)).toContain("Shipped, UPS 1Z999");
    expect(elsewhere.updateTracking({ orderRef: "a-1", tracking: { step: "delivered" }, checkAgainHours: 12 }).message).toContain("Sagax stops checking");
    expect(orders).toEqual([["ordered", 24], ["shipped", 12], ["delivered", 0]]);
  });

  it("refuses an order the bot did not record", () => {
    const { store } = setup();
    const access = fillResolverFor(store, context);
    expect(access.updateTracking({ tracking: { step: "shipped" }, checkAgainHours: 24 })).toMatchObject({ ok: false });
    const other = fillResolverFor(store, { ...context, botId: "bot-b" });
    expect(other.updateTracking({ orderRef: "A-1", tracking: { step: "shipped" }, checkAgainHours: 24 }).message).toContain("No order A-1");
  });

  it("follows no parcel for a flight", () => {
    const { store, saved } = setup();
    const access = fillResolverFor(store, context);
    access.requestPurchase({ pageUrl: page, amount: "420.00", currency: "CAD", cardId: saved.id, flights: [{ from: "YUL", to: "YVR", date: "2026-12-01" }] });
    store.answerPurchase(LOCAL_VAULT_PRINCIPAL, store.pendingPurchases(LOCAL_VAULT_PRINCIPAL)[0]!.id, "once");
    access.recordPurchase({ pageUrl: page, orderRef: "F-1" });
    expect(store.listPurchases(LOCAL_VAULT_PRINCIPAL)[0]!.tracking).toBeUndefined();
  });
});

describe("the approval level decides a purchase (2026-10-29)", () => {
  it("approves at once in Full, says so on the card, and still asks below Full", () => {
    const { store, saved } = setup();
    const seen: PurchaseListing[] = [];
    let level: string | null = "Full access";
    const access = fillResolverFor(store, context, undefined, (listing) => seen.push(listing), { autoApprove: () => level });
    const full = access.requestPurchase({ pageUrl: page, amount: "189.99", currency: "CAD", cardId: saved.id, merchant: "Audio Shop" });
    expect(full).toMatchObject({ ok: true });
    expect(full.message).not.toContain("Wait for the person");
    expect(store.pendingPurchases(LOCAL_VAULT_PRINCIPAL)).toEqual([]);
    expect(seen.map((listing) => [listing.status, listing.via])).toEqual([["once", "Full access"]]);
    expect(purchaseOutboundCard(seen[0]!, "Nova")).toMatchObject({ status: "approved", via: "Full access" });
    level = null;
    const asked = access.requestPurchase({ pageUrl: "https://other.example.test/pay", amount: "20.00", currency: "CAD", cardId: saved.id });
    expect(asked.message).toContain("Nothing was charged");
    expect(store.pendingPurchases(LOCAL_VAULT_PRINCIPAL)).toHaveLength(1);
  });
});
