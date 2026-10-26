import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PurchaseListing } from "./credential-vault.ts";
import { outboundWiring, primaryOutboundDecision, primaryPurchaseCard, purchaseCardFallback, purchaseOutboundCard } from "./outbound-wiring.ts";
import type { Message } from "./store.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const SID = `CA${"b".repeat(32)}`;
const ARGS = { to: "+1 514 555 0142", from: "+1 438 555 0100", purpose: "Confirmer le rendez-vous", message: "Jean confirme mardi." };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "outbound-wiring-"));
  dirs.push(dir);
  const rows: Message[] = [];
  let n = 0;
  const store = {
    messagesFor: () => rows,
    appendMessage: (_threadId: string, message: Omit<Message, "id" | "at">) => { const row = { ...message, id: `m${++n}`, at: n } as Message; rows.push(row); return row; },
    patchMessage: (_threadId: string, id: string, patch: Partial<Message>) => { const row = rows.find((r) => r.id === id); if (!row) return null; Object.assign(row, patch); return row; },
  };
  const twilio = vi.fn(async (_turn: unknown, args: Record<string, unknown>) => (args._dry_run ? { ok: true as const, isError: false, value: { dry_run: true } } : { ok: true as const, isError: false, value: { sid: SID } }));
  const wake = vi.fn();
  const wiring = outboundWiring({ dataDir: dir, store, botName: () => "Rocket", personName: () => "Jean", language: () => "fr", twilio, wake });
  wiring.calls.updateSettings({ enabled: true, callbackNumber: "+14385550199" });
  return { wiring, rows, twilio, wake };
}

const listing: PurchaseListing = {
  id: "pay_0123456789abcdef", botId: "bot-a", threadId: "t-1", merchant: "Boutique", domain: "shop.example.test",
  amount: "45.20", currency: "CAD", cardName: "Visa perso", cardLast4: "4242", cardBrand: "visa", status: "pending", createdAt: 1,
  title: "Pay 45.20 CAD to Boutique?", line: "3 items. Card ending 4242 (visa).",
  items: [{ name: "Cable", quantity: 2 }, { name: "Chargeur", quantity: 1 }],
};

describe("outbound wiring", () => {
  it("a call card appears, its answer updates it and wakes the bot, then the call is placed", async () => {
    const { wiring, rows, twilio, wake } = setup();
    const first = await wiring.placeCall({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g1", room: false }, ARGS);
    expect(first.isError).toBeUndefined();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outbound).toMatchObject({ kind: "call", status: "pending", destination: "+1 514 555 0142", botName: "Rocket", callback: "+1 438 555 0199" });
    const pending = wiring.primaryPending("jean", false);
    // ÉFVP pilot: the person confirms the number on the card; the Primary Bot may only decline
    expect(pending).toEqual([expect.objectContaining({ title: "Call +1 514 555 0142?", options: ["deny"] })]);
    expect(pending[0]).not.toHaveProperty("always");
    const id = pending[0]!.requestId;
    wiring.calls.answer("jean", id, "call", undefined, "+1 514 555 0142", true);
    // the route's answered hook
    const handler = wiring.routes({ principal: () => "jean" });
    expect(typeof handler).toBe("function");
    const second = await wiring.placeCall({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g2", room: false }, ARGS);
    expect(second.text).toContain("Call placed");
    expect(twilio).toHaveBeenLastCalledWith({ threadId: "t-1", generation: "g2", botId: "bot-a" }, expect.objectContaining({ resource: "Calls", action: "create" }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outbound?.status).toBe("done");
    expect(wake).not.toHaveBeenCalled();
  });

  it("refuses rooms and a conversation with no person", async () => {
    const { wiring, twilio } = setup();
    expect((await wiring.placeCall({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g", room: true }, ARGS)).isError).toBe(true);
    expect((await wiring.placeCall({ principalId: null, botId: "bot-a", threadId: "t-1", generation: "g", room: false }, ARGS)).isError).toBe(true);
    expect(twilio).not.toHaveBeenCalled();
  });

  it("a purchase card follows its purchase, and its answer wakes the bot", () => {
    const { wiring, rows, wake } = setup();
    wiring.purchaseCard(listing);
    expect(rows[0]!.outbound).toMatchObject({ kind: "purchase", status: "pending", cardLabel: "Visa •••• 4242", items: listing.items });
    wiring.purchaseAnswered({ ...listing, status: "once" }, "Sagax purchase update: allowed");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outbound?.status).toBe("approved");
    expect(wake).toHaveBeenCalledWith("bot-a", "t-1", "m1", "Sagax purchase update: allowed");
    wiring.purchaseCard({ ...listing, status: "once", orderRef: "A-1", doneAt: 5 });
    expect(rows[0]!.outbound).toMatchObject({ status: "done", orderRef: "A-1" });
    expect(rows[0]!.text).toBe("Purchased 3 items at Boutique, 45.20 CAD, order A-1.");
    wiring.purchaseCard({ ...listing, status: "once", orderRef: "A-1", doneAt: 5, mismatch: true, receipt: { total: "52.00" } });
    expect(rows[0]!.outbound).toMatchObject({ mismatchTotal: "52.00", declared: true });
  });

  it("never writes a card number or an id into the words", () => {
    const card = purchaseOutboundCard(listing, "Rocket");
    const words = [purchaseCardFallback(listing), card.merchant, card.cardLabel].join(" ");
    expect(words).not.toMatch(/pay_[0-9a-f]{16}/);
    expect(words).not.toMatch(/\d{12,}/);
  });

  it("the Primary Bot answers a call or a purchase this once or no, never always (JC 2026-10-22)", () => {
    expect(primaryOutboundDecision("purchase", { behavior: "allow" })).toEqual({ decision: "once" });
    expect(primaryOutboundDecision("call", { behavior: "allow" })).toHaveProperty("refused");
    expect(primaryOutboundDecision("call", { behavior: "deny" })).toEqual({ decision: "deny" });
    expect(primaryOutboundDecision("purchase", { behavior: "deny" })).toEqual({ decision: "deny" });
    expect(primaryOutboundDecision("purchase", { behavior: "allow", always: true })).toHaveProperty("refused");
    expect(primaryOutboundDecision("call", { behavior: "allow", always: true })).toHaveProperty("refused");
    const card = primaryPurchaseCard(listing, "Rocket", false);
    expect(card.options).toEqual(["allow", "deny"]);
    expect(card).not.toHaveProperty("always");
    expect(card).not.toHaveProperty("alwaysScope");
  });
});
