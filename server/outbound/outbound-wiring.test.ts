import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PurchaseListing } from "../vault/credential-vault.ts";
import { outboundWiring, primaryOutboundDecision, primaryPurchaseCard, purchaseCardFallback, purchaseOutboundCard } from "./outbound-wiring.ts";
import type { Message } from "../store.ts";
import { autoVerdict } from "../approvals/auto-approve.ts";
import { setOrgApprovalPolicySource } from "../rules/custom-rules-org.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const SID = `CA${"b".repeat(32)}`;
const ARGS = { to: "+1 514 555 0142", objective: "Confirmer le rendez-vous de mardi" };
/** voice_call on the person's own line: every call goes through it (#4193). */
const voiceMock = () => vi.fn(async (_turn: unknown, args: Record<string, unknown>) => (args.dry_run ? { ok: true as const, isError: false, value: { dry_run: true } } : { ok: true as const, isError: false, value: { sid: SID } }));

function setup(opts: { seedConsent?: boolean } = {}) {
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
  const voice = voiceMock();
  const wake = vi.fn();
  const wiring = outboundWiring({ dataDir: dir, store, botName: () => "Rocket", personName: () => "Jean", language: () => "fr", twilio, voice, wake });
  wiring.calls.updateSettings({ enabled: true, callbackNumber: "+14385550199" });
  if (opts.seedConsent !== false) wiring.consentStore.accept("jean", "bot-a");
  return { wiring, rows, twilio, voice, wake };
}

const listing: PurchaseListing = {
  id: "pay_0123456789abcdef", botId: "bot-a", threadId: "t-1", merchant: "Boutique", domain: "shop.example.test",
  amount: "45.20", currency: "CAD", cardName: "Visa perso", cardLast4: "4242", cardBrand: "visa", status: "pending", createdAt: 1,
  title: "Pay 45.20 CAD to Boutique?", line: "3 items. Card ending 4242 (visa).",
  items: [{ name: "Cable", quantity: 2 }, { name: "Chargeur", quantity: 1 }],
};

describe("outbound wiring", () => {
  it("a call card appears, its answer updates it and wakes the bot, then the call is placed", async () => {
    const { wiring, rows, twilio, voice, wake } = setup();
    const first = await wiring.placeCall({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g1", room: false }, ARGS);
    expect(first.isError).toBeUndefined();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outbound).toMatchObject({ kind: "call", status: "pending", destination: "+1 514 555 0142", botName: "Rocket", mode: "conversation", objective: ARGS.objective });
    expect(rows[0]!.outbound).not.toHaveProperty("callback");
    const pending = wiring.primaryPending("jean", false);
    // 2026-11-06 (the maintainer): the Primary Bot allows once, always or declines, like the person
    expect(pending).toEqual([expect.objectContaining({ title: "Call +1 514 555 0142?", line: `Conversation, 5 min max. Objective: ${ARGS.objective}`, options: ["allow", "always_allow", "deny"], always: "rule", alwaysScope: "calls to +1 514 555 0142" })]);
    const id = pending[0]!.requestId;
    wiring.calls.answer("jean", id, "call", undefined, "+1 514 555 0142", true);
    // the route's answered hook
    const handler = wiring.routes({ principal: () => "jean" });
    expect(typeof handler).toBe("function");
    const second = await wiring.placeCall({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g2", room: false }, ARGS);
    expect(second.text).toContain("Conversation call placed");
    expect(voice).toHaveBeenLastCalledWith({ threadId: "t-1", generation: "g2", botId: "bot-a" }, expect.objectContaining({ mode: "conversation", ref: id }));
    // the one-way call Sagax built through twilio_api_write is gone (#4193)
    expect(twilio).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outbound?.status).toBe("done");
    expect(wake).not.toHaveBeenCalled();
  });

  it("a direct chat with no thread opener and no organization name calls on behalf of the person who speaks (#1487)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outbound-wiring-"));
    dirs.push(dir);
    const rows: Message[] = [];
    const store = {
      messagesFor: () => rows,
      appendMessage: (_threadId: string, message: Omit<Message, "id" | "at">) => { const row = { ...message, id: `m${rows.length + 1}`, at: rows.length + 1 } as Message; rows.push(row); return row; },
      patchMessage: () => null,
    };
    const twilio = vi.fn(async () => ({ ok: true as const, isError: false, value: { dry_run: true } }));
    const wiring = outboundWiring({ dataDir: dir, store, botName: () => "Rocket", personName: () => "", principalName: (id) => (id === "jean" ? "Jean Tremblay" : undefined), language: () => "fr", twilio, voice: voiceMock(), wake: vi.fn() });
    wiring.calls.updateSettings({ enabled: true, callbackNumber: "+14385550199" });
    wiring.consentStore.accept("jean", "bot-a");
    const answer = await wiring.placeCall({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g1", room: false }, ARGS);
    expect(answer.text).not.toContain("on whose behalf");
    expect(answer.isError).toBeUndefined();
    expect(rows[0]!.outbound).toMatchObject({ kind: "call", status: "pending" });
  });

  it("stages a one-time consent card before any call card when the person has not accepted", async () => {
    const { wiring, rows } = setup({ seedConsent: false });
    const first = await wiring.placeCall({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g1", room: false }, ARGS);
    expect(first.isError).toBeUndefined();
    expect(first.text).toContain("consent card");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.card?.phoneCallConsent?.status).toBe("pending");
    expect(rows[0]!.outbound).toBeUndefined();
    wiring.resolveConsent({ principalId: "jean", botId: "bot-a", threadId: "t-1", requestId: rows[0]!.card!.requestId!, allow: true });
    expect(rows[0]!.card?.phoneCallConsent?.status).toBe("accepted");
    const second = await wiring.placeCall({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g2", room: false }, ARGS);
    expect(second.text).toMatch(/card|Call/);
    expect(rows.some((row) => row.outbound?.kind === "call")).toBe(true);
  });

  it("refuses rooms and a conversation with no person", async () => {
    const { wiring, twilio, voice } = setup();
    expect((await wiring.placeCall({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g", room: true }, ARGS)).isError).toBe(true);
    expect((await wiring.placeCall({ principalId: null, botId: "bot-a", threadId: "t-1", generation: "g", room: false }, ARGS)).isError).toBe(true);
    expect(twilio).not.toHaveBeenCalled();
    expect(voice).not.toHaveBeenCalled();
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

  it("the Primary Bot answers a purchase once, always (a rule for the site) or no; a call too (the maintainer 2026-11-06)", () => {
    expect(primaryOutboundDecision("purchase", { behavior: "allow" })).toEqual({ decision: "once" });
    expect(primaryOutboundDecision("purchase", { behavior: "allow", always: true })).toEqual({ decision: "always" });
    expect(primaryOutboundDecision("purchase", { behavior: "allow", rule: "allow" })).toEqual({ decision: "always" });
    expect(primaryOutboundDecision("purchase", { behavior: "deny" })).toEqual({ decision: "deny" });
    // the Primary Bot confirms the card's own number on the person's behalf
    expect(primaryOutboundDecision("call", { behavior: "allow" }, "+15145550142")).toEqual({ decision: "call", confirmedTo: "+15145550142", confirmed: true });
    expect(primaryOutboundDecision("call", { behavior: "allow", always: true }, "+15145550142")).toEqual({ decision: "always", confirmedTo: "+15145550142", confirmed: true });
    expect(primaryOutboundDecision("call", { behavior: "allow", rule: "allow" }, "+15145550142")).toEqual({ decision: "always", confirmedTo: "+15145550142", confirmed: true });
    expect(primaryOutboundDecision("call", { behavior: "allow" })).toHaveProperty("refused");
    expect(primaryOutboundDecision("call", { behavior: "deny" })).toEqual({ decision: "deny" });
    const card = primaryPurchaseCard(listing, "Rocket", false);
    expect(card.options).toEqual(["allow", "always_allow", "deny"]);
    expect(card.always).toBe("rule");
    expect(card.alwaysScope).toContain(listing.domain);
  });
});

describe("the Primary Bot's call answers keep the organization's rules (the maintainer 2026-11-06)", () => {
  afterEach(() => setOrgApprovalPolicySource(null));

  it("an organization rule Demander d'abord or Refuser still gates place_phone_call before any card", () => {
    const tool = "mcp__sagax__place_phone_call";
    for (const mode of ["ask", "auto", "full"] as const) {
      expect(autoVerdict(mode, tool, { outbound: true, customRule: { behavior: "ask", id: "orule_ask" }, toolAllowed: true })).toEqual({ approve: null, source: "custom-rule-ask" });
      expect(autoVerdict(mode, tool, { outbound: true, customRule: { behavior: "deny", id: "orule_deny" }, toolAllowed: true }).approve).not.toBe(true);
    }
  });

  it("Toujours permettre off: no Always for the Primary Bot, and a saved Always call no longer answers", async () => {
    const { wiring } = setup();
    await wiring.placeCall({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g1", room: false }, ARGS);
    const id = wiring.primaryPending("jean", false)[0]!.requestId;
    wiring.calls.answer("jean", id, "always", "Chef", "+1 514 555 0142", true);
    expect(wiring.calls.standingFor("jean", "+15145550142")).toBe(true);
    setOrgApprovalPolicySource(() => ({ alwaysAllow: false }));
    expect(primaryOutboundDecision("call", { behavior: "allow", always: true }, "+15145550142")).toHaveProperty("refused");
    expect(primaryOutboundDecision("call", { behavior: "allow" }, "+15145550142")).toEqual({ decision: "call", confirmedTo: "+15145550142", confirmed: true });
    await wiring.placeCall({ principalId: "jean", botId: "bot-a", threadId: "t-2", generation: "g2", room: false }, ARGS);
    const pending = wiring.primaryPending("jean", false);
    expect(pending).toEqual([expect.objectContaining({ threadId: "t-2", options: ["allow", "deny"] })]);
    expect(pending[0]).not.toHaveProperty("always");
  });
});
