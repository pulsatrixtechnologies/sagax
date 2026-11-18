import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PurchaseListing } from "../vault/credential-vault.ts";
import { outboundWiring, primaryOutboundDecision, primaryPurchaseCard, purchaseCardFallback, purchaseOutboundCard, type OutboundWiringDeps } from "./outbound-wiring.ts";
import type { Message } from "../store.ts";
import { autoVerdict } from "../approvals/auto-approve.ts";
import { setOrgApprovalPolicySource } from "../rules/custom-rules-org.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const SID = `CA${"b".repeat(32)}`;
const ARGS = { to: "+1 514 555 0142", objective: "Confirmer le rendez-vous de mardi" };
/** voice_call on the person's own line: every call goes through it (#4193). */
const voiceMock = () => vi.fn(async (_turn: unknown, args: Record<string, unknown>) => (args.dry_run ? { ok: true as const, isError: false, value: { dry_run: true } } : { ok: true as const, isError: false, value: { sid: SID } }));

function setup(opts: { seedConsent?: boolean; extra?: Partial<OutboundWiringDeps> } = {}) {
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
  const wiring = outboundWiring({ dataDir: dir, store, botName: () => "Rocket", personName: () => "Jean", language: () => "fr", twilio, voice, wake, ...opts.extra });
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

describe("#4304: the live call card's End call and its ended card", () => {
  const notMounted = { ok: false as const, code: "profile_not_mounted" as const, error: "the Perspicax connection is not mounted in this turn" };

  async function placedLive(extra: Partial<OutboundWiringDeps> = {}) {
    const made = setup({ extra: { principalSub: () => "sub-jean", ...extra } });
    const context = { principalId: "jean", botId: "bot-a", threadId: "t-1", room: false };
    await made.wiring.placeCall({ ...context, generation: "g1" }, ARGS);
    const id = made.wiring.primaryPending("jean", false)[0]!.requestId;
    made.wiring.calls.answer("jean", id, "call", undefined, "+1 514 555 0142", true);
    await made.wiring.placeCall({ ...context, generation: "g2" }, ARGS);
    expect(made.wiring.calls.get(id)?.status).toBe("placed");
    made.twilio.mockClear();
    return { ...made, id };
  }

  it("passes the callee name to voice_call and shows it on the card from the start", async () => {
    const { wiring, rows, voice } = setup({ extra: { principalSub: () => "sub-jean" } });
    const context = { principalId: "jean", botId: "bot-a", threadId: "t-1", room: false };
    const args = { ...ARGS, callee_name: "Marie" };
    await wiring.placeCall({ ...context, generation: "g1" }, args);
    expect(rows[0]!.outbound?.calleeName).toBe("Marie");
    const id = wiring.primaryPending("jean", false)[0]!.requestId;
    wiring.calls.answer("jean", id, "call", undefined, "+1 514 555 0142", true);
    await wiring.placeCall({ ...context, generation: "g2" }, args);
    expect(voice).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ ref: id, callee_name: "Marie" }));
    expect(rows[0]!.outbound?.calleeName).toBe("Marie");
  });

  it("a Perspicax that refuses callee_name places the call without it", async () => {
    const voice = vi.fn(async (_turn: unknown, callArgs: Record<string, unknown>) => (
      "callee_name" in callArgs
        ? { ok: true as const, isError: true, value: "unexpected additional property: callee_name" }
        : callArgs.dry_run ? { ok: true as const, isError: false, value: { dry_run: true } } : { ok: true as const, isError: false, value: { sid: SID } }
    ));
    const { wiring, rows } = setup({ extra: { principalSub: () => "sub-jean", voice } });
    const context = { principalId: "jean", botId: "bot-a", threadId: "t-1", room: false };
    const args = { ...ARGS, callee_name: "Marie" };
    await wiring.placeCall({ ...context, generation: "g1" }, args);
    const id = wiring.primaryPending("jean", false)[0]!.requestId;
    wiring.calls.answer("jean", id, "call", undefined, "+1 514 555 0142", true);
    const placed = await wiring.placeCall({ ...context, generation: "g2" }, args);
    expect(placed.isError).toBeUndefined();
    expect(rows[0]!.outbound?.status).toBe("done");
  });

  it("the timer starts at the pickup, resent lines show once, and the final result replaces the streamed lines", async () => {
    let clock = 1_000;
    const { wiring, rows, id } = await placedLive({ now: () => clock });
    clock = 2_000;
    expect(wiring.callProgress({ sub: "sub-jean", ref: id, phase: "ringing" })).toBe("applied");
    expect(rows[0]!.outbound?.liveAnsweredAt).toBeUndefined();
    clock = 9_000;
    const lines = [{ speaker: "bot" as const, text: "Hello", at: 9_100 }];
    expect(wiring.callProgress({ sub: "sub-jean", ref: id, phase: "in_call", lines })).toBe("applied");
    clock = 20_000;
    expect(wiring.callProgress({ sub: "sub-jean", ref: id, lines: [...lines, { speaker: "callee" as const, text: "Hi", at: 9_900 }] })).toBe("applied");
    expect(rows[0]!.outbound?.liveAnsweredAt).toBe(9_000);
    expect(rows[0]!.outbound?.liveTranscript?.map((line) => line.text)).toEqual(["Hello", "Hi"]);
    wiring.callResult({ sub: "sub-jean", result: { ref: id, callSid: SID, outcome: "completed", endedBy: "goal", durationSec: 12, points: ["Done"], commitments: [], transcript: [{ speaker: "bot", text: "Hello" }, { speaker: "callee", text: "Hi" }] } });
    // the result carries the one transcript; the streamed copy leaves the card, so nothing shows twice
    expect(rows[0]!.outbound?.liveTranscript).toBeUndefined();
    expect(rows[0]!.outbound?.result?.transcript).toHaveLength(2);
  });

  it("ends the call outside any turn on the person's own access", async () => {
    const personTwilio = vi.fn(async (_principalId: string, _botId: string, _args: Record<string, unknown>) => ({ ok: true as const, isError: false, value: { status: "completed" } }));
    const { wiring, rows, twilio, id } = await placedLive({ personTwilio });
    twilio.mockResolvedValue(notMounted as never);
    expect(await wiring.personHangUp("jean", id)).toEqual({ ok: true });
    expect(personTwilio).toHaveBeenCalledWith("jean", "bot-a", expect.objectContaining({ resource: "Calls", action: "update", id: SID, set: { Status: "completed" } }));
    expect(rows[0]!.outbound?.phase).toBe("ended");
  });

  it("a bot's hang up whose turn holds no connection reaches the call on the person's access", async () => {
    const personTwilio = vi.fn(async () => ({ ok: true as const, isError: false, value: { status: "completed" } }));
    const { wiring, twilio } = await placedLive({ personTwilio });
    twilio.mockResolvedValue(notMounted as never);
    const answer = await wiring.hangUp({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g9" });
    expect(answer.isError).toBeUndefined();
    expect(personTwilio).toHaveBeenCalledTimes(1);
  });

  it("attempts nothing and shows nothing once the call has ended", async () => {
    const personTwilio = vi.fn(async () => ({ ok: true as const, isError: false, value: {} }));
    const { wiring, twilio, id } = await placedLive({ personTwilio });
    expect(wiring.callProgress({ sub: "sub-jean", ref: id, phase: "ended" })).toBe("applied");
    expect(await wiring.personHangUp("jean", id)).toEqual({ ok: true });
    wiring.callResult({ sub: "sub-jean", result: { ref: id, callSid: SID, outcome: "completed", endedBy: "hang-up", durationSec: 16, points: [], commitments: [] } });
    expect(await wiring.personHangUp("jean", id)).toEqual({ ok: true });
    expect(personTwilio).not.toHaveBeenCalled();
    expect(twilio).not.toHaveBeenCalled();
  });

  it("End call before the call is placed is not a success: approved and placing answer not_live, nothing is reached", async () => {
    const personTwilio = vi.fn(async () => ({ ok: true as const, isError: false, value: {} }));
    const made = setup({ extra: { principalSub: () => "sub-jean", personTwilio } });
    const context = { principalId: "jean", botId: "bot-a", threadId: "t-1", room: false };
    await made.wiring.placeCall({ ...context, generation: "g1" }, ARGS);
    const id = made.wiring.primaryPending("jean", false)[0]!.requestId;
    made.wiring.calls.answer("jean", id, "call", undefined, "+1 514 555 0142", true);
    expect(made.wiring.calls.get(id)?.status).toBe("approved");
    expect(await made.wiring.personHangUp("jean", id)).toMatchObject({ status: 409, code: "not_live" });
    made.wiring.calls.get(id)!.status = "placing";
    expect(await made.wiring.personHangUp("jean", id)).toMatchObject({ status: 409, code: "not_live" });
    expect(personTwilio).not.toHaveBeenCalled();
  });

  it("a call Twilio says is already over ends the card without an error", async () => {
    const personTwilio = vi.fn(async () => ({ ok: true as const, isError: true, value: { code: 21220, message: "Call is not in-progress. Cannot redirect." } }));
    const { wiring, rows, id } = await placedLive({ personTwilio });
    expect(await wiring.personHangUp("jean", id)).toEqual({ ok: true });
    expect(rows[0]!.outbound?.phase).toBe("ended");
  });

  it("a failure reads as one plain sentence, never the connection's internal words", async () => {
    const { wiring, twilio, id } = await placedLive();
    twilio.mockResolvedValue(notMounted as never);
    const outcome = await wiring.personHangUp("jean", id);
    expect(outcome).toMatchObject({ status: 502, code: "hangup_failed" });
    expect(JSON.stringify(outcome)).not.toMatch(/mounted|turn|Perspicax/i);
  });

  it("an ended call's card carries no recording player: no recording is made", async () => {
    const { wiring, rows, id } = await placedLive();
    expect(wiring.callResult({ sub: "sub-jean", result: { ref: id, callSid: SID, outcome: "completed", durationSec: 16, points: ["Okay"], commitments: [] } })).toBe("applied");
    expect(rows[0]!.outbound?.result).toMatchObject({ durationSec: 16 });
    expect(rows[0]!.outbound).not.toHaveProperty("recordingUrl");
  });
});

describe("live call card lot 4: the person takes the call over", () => {
  const OWN = "+15145550177";
  /** voice_call that places with a take over number and hands the call over. */
  const takeOverVoice = () => vi.fn(async (_turn: unknown, args: Record<string, unknown>) => (
    args.control === "take_over"
      ? { ok: true as const, isError: false, value: JSON.stringify({ taken_over: true, ref: args.ref, to: OWN, status: "dialing" }) }
      : args.dry_run ? { ok: true as const, isError: false, value: { dry_run: true } }
        : { ok: true as const, isError: false, value: JSON.stringify({ placed: true, sid: SID, take_over_number: OWN }) }
  ));

  async function inCall(extra: Partial<OutboundWiringDeps> = {}) {
    let clock = 1_000;
    const timers: Array<{ ms: number; fn: () => void }> = [];
    const voice = takeOverVoice();
    const made = setup({ extra: {
      principalSub: () => "sub-jean", voice, now: () => clock,
      ownerSmsNumber: () => OWN,
      later: (ms, fn) => { timers.push({ ms, fn }); },
      ...extra,
    } });
    const context = { principalId: "jean", botId: "bot-a", threadId: "t-1", room: false };
    await made.wiring.placeCall({ ...context, generation: "g1" }, ARGS);
    const id = made.wiring.primaryPending("jean", false)[0]!.requestId;
    made.wiring.calls.answer("jean", id, "call", undefined, "+1 514 555 0142", true);
    await made.wiring.placeCall({ ...context, generation: "g2" }, ARGS);
    expect(made.wiring.callProgress({ sub: "sub-jean", ref: id, phase: "in_call", lines: [{ speaker: "bot", text: "Bonjour", at: 1_100 }] })).toBe("applied");
    return { ...made, voice, id, timers, tick: (to: number) => { clock = to; } };
  }

  it("the placed answer's take_over_number shows masked on the card, and the Reach me number goes with the call", async () => {
    const { rows, voice, id } = await inCall();
    expect(voice).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ref: id, take_over_to: OWN }));
    expect(rows[0]!.outbound?.takeOverTo).toBe("+1 514 ••• •• 77");
    expect(JSON.stringify(rows[0]!.outbound)).not.toContain(OWN);
  });

  it("no take_over_number: the card offers no Take over", async () => {
    const voice = vi.fn(async (_turn: unknown, args: Record<string, unknown>) => (args.dry_run ? { ok: true as const, isError: false, value: { dry_run: true } } : { ok: true as const, isError: false, value: { sid: SID } }));
    const { rows } = await inCall({ voice });
    expect(rows[0]!.outbound).not.toHaveProperty("takeOverTo");
  });

  it("transferring, then on the call once the ring time passed; the timer keeps the pickup", async () => {
    const { wiring, rows, voice, id, timers, tick } = await inCall();
    tick(5_000);
    expect(await wiring.personTakeOver("jean", id)).toEqual({ ok: true, to: OWN });
    expect(voice).toHaveBeenLastCalledWith(expect.anything(), { control: "take_over", ref: id, take_over_to: OWN });
    expect(rows[0]!.outbound).toMatchObject({ phase: "transferred", takeOver: { state: "transferring", at: 5_000 }, liveAnsweredAt: 1_000 });
    // Perspicax's own progress says the same: nothing doubles
    expect(wiring.callProgress({ sub: "sub-jean", ref: id, phase: "transferred", lines: [{ speaker: "system", text: "Transfert de l'appel vers vous.", at: 5_100 }] })).toBe("applied");
    expect(timers).toHaveLength(1);
    tick(31_000);
    timers[0]!.fn();
    expect(rows[0]!.outbound?.takeOver).toEqual({ state: "answered", at: 5_000 });
    expect(rows[0]!.outbound?.liveTranscript?.at(-1)).toMatchObject({ speaker: "system", text: "Vous êtes sur l'appel." });
    wiring.callResult({ sub: "sub-jean", result: { ref: id, callSid: SID, outcome: "completed", endedBy: "transfer", durationSec: 95, points: ["Transféré"], commitments: [], transcript: [{ speaker: "bot", text: "Bonjour" }] } });
    expect(rows[0]!.outbound?.result).toMatchObject({ outcome: "completed", endedBy: "transfer", durationSec: 95 });
  });

  it("nobody answered: back in call with Perspicax's line, the take over cleared, the late timer does nothing", async () => {
    const { wiring, rows, id, timers, tick } = await inCall();
    expect(await wiring.personTakeOver("jean", id)).toMatchObject({ ok: true });
    tick(22_000);
    expect(wiring.callProgress({ sub: "sub-jean", ref: id, phase: "in_call", lines: [{ speaker: "system", text: "Transfert sans réponse, Rocket a repris l'appel.", at: 22_000 }] })).toBe("applied");
    expect(rows[0]!.outbound?.phase).toBe("in_call");
    expect(rows[0]!.outbound).not.toHaveProperty("takeOver");
    timers[0]!.fn();
    expect(rows[0]!.outbound).not.toHaveProperty("takeOver");
    expect(rows[0]!.outbound?.liveTranscript?.map((line) => line.text)).not.toContain("Vous êtes sur l'appel.");
  });

  it("only the person who asked for the call: anyone else gets 404 and nothing is reached", async () => {
    const { wiring, voice, id } = await inCall();
    voice.mockClear();
    expect(await wiring.personTakeOver("alex", id)).toMatchObject({ status: 404, code: "unknown_call" });
    expect(await wiring.personTakeOver("jean", "call_ffffffffffffffff")).toMatchObject({ status: 404 });
    expect(voice).not.toHaveBeenCalled();
  });

  it("a refused redirect reads as one plain sentence and the card stays in call (the bot keeps talking)", async () => {
    const { wiring, rows, voice, id } = await inCall();
    voice.mockResolvedValueOnce({ ok: true as const, isError: true, value: "Twilio answered 502: redirect refused" } as never);
    const outcome = await wiring.personTakeOver("jean", id);
    expect(outcome).toMatchObject({ status: 502, code: "takeover_failed" });
    expect(JSON.stringify(outcome)).not.toMatch(/Twilio|502:/);
    expect(rows[0]!.outbound?.phase).toBe("in_call");
    expect(rows[0]!.outbound).not.toHaveProperty("takeOver");
  });

  it("the bot's transfer goes through the same take over, and its failure is said to the bot and shown on the card", async () => {
    const { wiring, rows, voice, id } = await inCall();
    voice.mockResolvedValueOnce({ ok: true as const, isError: true, value: "denied: no_take_over_number" } as never);
    const refused = await wiring.transfer({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g3" }, {});
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/verified number/);
    expect(rows[0]!.outbound?.liveTranscript?.at(-1)).toMatchObject({ speaker: "system" });
    const done = await wiring.transfer({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g4" }, {});
    expect(done.isError).toBeUndefined();
    expect(voice).toHaveBeenLastCalledWith(expect.anything(), { control: "take_over", ref: id, take_over_to: OWN });
    expect(rows[0]!.outbound?.takeOver?.state).toBe("transferring");
  });

  it("a bot's transfer whose turn holds no connection reaches voice_call on the person's access", async () => {
    const personVoice = vi.fn(async (_p: string, _b: string, args: Record<string, unknown>) => ({ ok: true as const, isError: false, value: { taken_over: true, ref: args.ref, to: OWN } }));
    const { wiring, voice } = await inCall({ personVoice });
    voice.mockResolvedValueOnce({ ok: false as const, code: "profile_not_mounted", error: "not mounted" } as never);
    const answer = await wiring.transfer({ principalId: "jean", botId: "bot-a", threadId: "t-1", generation: "g5" }, {});
    expect(answer.isError).toBeUndefined();
    expect(personVoice).toHaveBeenCalledWith("jean", "bot-a", expect.objectContaining({ control: "take_over" }));
  });
});
