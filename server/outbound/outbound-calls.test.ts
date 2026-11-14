import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CALL_APPROVAL_MS, callAnswerNote, callCard, OutboundCalls, placePhoneCall, type OutboundCallRecord, type PlaceCallDeps, STANDING_CALL_VIA } from "./outbound-calls.ts";

// #4193: every call a bot places is a live conversation through voice_call on
// the person's own line; there is no one-way spoken message any more.
const ARGS = { to: "+1 514 555 0142", objective: "Confirmer le rendez-vous de mardi 10 h" };
const CTX = { principalId: "jean@example.com", botId: "bot-rocket", threadId: "t-1" };
const SID = `CA${"a".repeat(32)}`;

let dir: string;
let clock: number;
let calls: OutboundCalls;
let cards: Array<{ status: string; messageId?: string }>;
let voice: ReturnType<typeof vi.fn>;

const real = () => voice.mock.calls.filter(([args]) => !(args as Record<string, unknown>).dry_run);

function deps(): PlaceCallDeps {
  return {
    calls,
    voice: voice as unknown as NonNullable<PlaceCallDeps["voice"]>,
    names: { botName: "Rocket", personName: "Jean" },
    language: "fr",
    card: (row, existing) => { cards.push({ status: row.status, ...(existing ? { messageId: existing } : {}) }); return existing ?? "m-1"; },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "outbound-calls-"));
  clock = 1_000_000;
  calls = new OutboundCalls(dir, () => clock);
  calls.updateSettings({ enabled: true });
  cards = [];
  voice = vi.fn(async (args: Record<string, unknown>) => (args.dry_run ? { ok: true, isError: false, value: { dry_run: true, mode: "conversation" } } : { ok: true, isError: false, value: { sid: SID, status: "queued" } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("placePhoneCall", () => {
  it("a first call only dry-runs on the person's line and shows a card; nothing is placed", async () => {
    const answer = await placePhoneCall(deps(), CTX, ARGS);
    expect(answer.isError).toBeUndefined();
    expect(answer.text).toContain("Nothing was placed");
    expect(voice).toHaveBeenCalledTimes(1);
    expect(voice.mock.calls[0]![0]).toMatchObject({ to: "+15145550142", mode: "conversation", purpose: ARGS.objective, dry_run: true });
    expect(calls.pending(CTX.principalId)).toHaveLength(1);
    expect(cards).toEqual([{ status: "pending" }]);
    expect(calls.pending(CTX.principalId)[0]!.messageId).toBe("m-1");
  });

  it("asking again before the answer keeps one card", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const again = await placePhoneCall(deps(), CTX, ARGS);
    expect(again.text).toContain("still waiting");
    expect(calls.pending(CTX.principalId)).toHaveLength(1);
  });

  it("after Call, the same arguments place the call once; a second try asks again", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.pending(CTX.principalId)[0]!;
    const answered = calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true);
    expect(callAnswerNote(answered)).toContain("allowed");
    const placed = await placePhoneCall(deps(), CTX, ARGS);
    expect(placed.isError).toBeUndefined();
    expect(placed.text).toContain("Conversation call placed");
    expect(real()).toHaveLength(1);
    expect(real()[0]![0]).toMatchObject({ ref: row.id, mode: "conversation" });
    expect(calls.get(row.id)).toMatchObject({ status: "placed", callSid: SID });
    await placePhoneCall(deps(), CTX, ARGS);
    expect(voice.mock.calls.at(-1)![0]).toMatchObject({ dry_run: true });
  });

  it("a changed objective, another bot, or an expired approval never place the call", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    calls.answer(CTX.principalId, calls.pending(CTX.principalId)[0]!.id, "call", undefined, "+15145550142", true);
    await placePhoneCall(deps(), CTX, { ...ARGS, objective: "Autre chose" });
    await placePhoneCall(deps(), { ...CTX, botId: "bot-other" }, ARGS);
    clock += CALL_APPROVAL_MS + 1;
    await placePhoneCall(deps(), CTX, ARGS);
    expect(real()).toHaveLength(0);
  });

  it("an approval is bound to the bot and the person named in the opening (review)", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    calls.answer(CTX.principalId, calls.pending(CTX.principalId)[0]!.id, "call", undefined, "+15145550142", true);
    await placePhoneCall({ ...deps(), names: { botName: "Rocket", personName: "Quelqu'un d'autre" } }, CTX, ARGS);
    expect(real()).toHaveLength(0);
  });

  it("a denied call is never placed and the bot is told", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.answer(CTX.principalId, calls.pending(CTX.principalId)[0]!.id, "deny", "Primary");
    expect(callAnswerNote(row)).toContain("declined");
    expect(row.via).toBe("Primary");
    await placePhoneCall(deps(), CTX, ARGS);
    expect(real()).toHaveLength(0);
    expect(() => calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true)).toThrow(/already answered/);
    expect(() => calls.answer("someone@else", row.id, "call")).toThrow(/No such call/);
    expect(() => calls.answer(CTX.principalId, row.id, "maybe" as never)).toThrow(/call, always or deny/);
  });

  it("Always call keeps the number: the next call to it is placed without a card (#2091)", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.pending(CTX.principalId)[0]!;
    // Always still wants the number confirmed on the card (ÉFVP 2026-10-22)
    expect(() => calls.answer(CTX.principalId, row.id, "always")).toThrow(/confirm/i);
    const answered = calls.answer(CTX.principalId, row.id, "always", undefined, "+15145550142", true);
    expect(answered.status).toBe("approved");
    const placed = await placePhoneCall(deps(), CTX, ARGS);
    expect(placed.text).toContain("Conversation call placed");
    // a later call to the same number: no card, approved by the standing Always
    const shown: { status: string; via?: string }[] = [];
    const next = await placePhoneCall({ ...deps(), card: (row, existing) => { shown.push({ status: row.status, ...(row.via ? { via: row.via } : {}) }); return existing ?? "m-2"; } }, CTX, { ...ARGS, objective: "Reporter le rendez-vous" });
    expect(next.text).toContain("Conversation call placed");
    expect(calls.pending(CTX.principalId)).toHaveLength(0);
    expect(shown).toEqual([{ status: "placed", via: STANDING_CALL_VIA }]);
    // another number still asks
    await placePhoneCall(deps(), CTX, { ...ARGS, to: "+1 514 555 0199" });
    expect(calls.pending(CTX.principalId)).toHaveLength(1);
    // forgetting the number asks again
    calls.forgetStanding(CTX.principalId, "+15145550142");
    await placePhoneCall(deps(), CTX, { ...ARGS, objective: "Encore" });
    // one pending card per thread: the new ask replaced the other number's
    expect(calls.pending(CTX.principalId).map((row) => row.request.purpose)).toEqual(["Encore"]);
  });

  it("a refused dry run or no Perspicax opens no card", async () => {
    voice.mockResolvedValueOnce({ ok: false, code: "profile_not_mounted", error: "no Perspicax profile is mounted in this turn" });
    expect((await placePhoneCall(deps(), CTX, ARGS)).isError).toBe(true);
    voice.mockResolvedValueOnce({ ok: true, isError: true, value: "no_line" });
    expect((await placePhoneCall(deps(), CTX, ARGS)).text).toContain("no Perspicax Voice line");
    expect(calls.pending(CTX.principalId)).toHaveLength(0);
    expect((await placePhoneCall(deps(), CTX, { ...ARGS, to: "+1 212 555 0142" })).isError).toBe(true);
    expect((await placePhoneCall({ ...deps(), voice: undefined }, CTX, ARGS)).text).toContain("Perspicax is not linked");
  });

  it("two tries at once place one call", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    calls.answer(CTX.principalId, calls.pending(CTX.principalId)[0]!.id, "call", undefined, "+15145550142", true);
    const [a, b] = await Promise.all([placePhoneCall(deps(), CTX, ARGS), placePhoneCall(deps(), CTX, ARGS)]);
    expect([a.text, b.text].filter((text) => text.includes("Conversation call placed"))).toHaveLength(1);
    expect(real()).toHaveLength(1);
  });

  it("a call Perspicax accepted without a readable sid still counts as placed", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.pending(CTX.principalId)[0]!;
    calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true);
    voice.mockResolvedValueOnce({ ok: true, isError: false, value: "created" });
    expect((await placePhoneCall(deps(), CTX, ARGS)).text).toContain("Conversation call placed");
    expect(calls.get(row.id)?.status).toBe("placed");
  });

  it("a card left a day is stale, and a new ask closes the old card", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const old = calls.pending(CTX.principalId)[0]!;
    await placePhoneCall(deps(), CTX, { ...ARGS, objective: "Autre objectif" });
    expect(calls.get(old.id)?.status).toBe("denied");
    expect(cards.some((card) => card.status === "denied")).toBe(true);
    clock += 24 * 60 * 60_000 + 1;
    expect(calls.pending(CTX.principalId)).toHaveLength(0);
  });

  it("a refusal at placement settles the approval as failed", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.pending(CTX.principalId)[0]!;
    calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true);
    voice.mockResolvedValueOnce({ ok: true, isError: true, value: "21215: account not authorized" });
    const failed = await placePhoneCall(deps(), CTX, ARGS);
    expect(failed.isError).toBe(true);
    expect(calls.get(row.id)?.status).toBe("failed");
  });

  it("the card shows the number to its person, logs and the store never hold a card", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.pending(CTX.principalId)[0]!;
    expect(callCard(row, "Rocket")).toMatchObject({ kind: "call", destination: "+1 514 555 0142", status: "pending", botName: "Rocket" });
    const disk = readFileSync(join(dir, "outbound-calls.json"), "utf8");
    expect(disk).toContain("+15145550142");
    // reloaded from disk
    expect(new OutboundCalls(dir, () => clock).pending(CTX.principalId)).toHaveLength(1);
  });

  it("pilot gate: off by default, a do-not-call number, or an unconfirmed number never place a call (ÉFVP)", async () => {
    mkdirSync(join(dir, "fresh"));
    const fresh = new OutboundCalls(join(dir, "fresh"), () => clock);
    expect(fresh.settings()).toEqual({ enabled: false, doNotCall: [] });
    const off = await placePhoneCall({ ...deps(), calls: fresh }, CTX, ARGS);
    expect(off).toMatchObject({ isError: true });
    expect(off.text).toContain("off");
    fresh.updateSettings({ enabled: true, addDoNotCall: "514-555-0142" });
    expect(fresh.settings().doNotCall).toEqual(["+15145550142"]);
    const listed = await placePhoneCall({ ...deps(), calls: fresh }, CTX, ARGS);
    expect(listed.text).toContain("do-not-call");
    expect(voice).not.toHaveBeenCalled();
    fresh.updateSettings({ removeDoNotCall: "+15145550142" });
    await placePhoneCall({ ...deps(), calls: fresh }, CTX, ARGS);
    const row = fresh.pending(CTX.principalId)[0]!;
    expect(() => fresh.answer(CTX.principalId, row.id, "call")).toThrow(/confirm the number/);
    expect(() => fresh.answer(CTX.principalId, row.id, "call", undefined, "+1 514 555 0000")).toThrow(/confirm the number/);
    fresh.answer(CTX.principalId, row.id, "call", undefined, "+1 514 555 0142", true);
    // added to the list after the yes: still refused, nothing placed
    fresh.updateSettings({ addDoNotCall: "+15145550142" });
    expect((await placePhoneCall({ ...deps(), calls: fresh }, CTX, ARGS)).text).toContain("do-not-call");
    expect(real()).toHaveLength(0);
    expect(() => fresh.updateSettings({ callbackNumber: "nope" })).toThrow(/callback/);
  });

  it("the tick is the server's: no confirm flag, no call; a long name is cut, never emptied (re-review)", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.pending(CTX.principalId)[0]!;
    expect(() => calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142")).toThrow(/confirm the number/);
    const long = await placePhoneCall({ ...deps(), names: { botName: "Rocket", personName: "J".repeat(200) } }, { ...CTX, threadId: "t-2" }, ARGS);
    expect(long.isError).toBeUndefined();
    const opened = calls.pending(CTX.principalId).find((entry) => entry.threadId === "t-2")!;
    expect(callCard(opened, "Rocket").script).toMatch(/au nom de J{20,80}\./);
  });
});

describe("a placed call is a live conversation, never a spoken message (#4193)", () => {
  it("the old one-way arguments (from, purpose, message) still go through voice_call as a conversation, with no message", async () => {
    const oneWay = { to: "+1 514 555 0142", from: "+1 438 555 0100", purpose: "Confirmer le rendez-vous", message: "Jean confirme mardi 10 h." };
    const answer = await placePhoneCall(deps(), CTX, oneWay);
    expect(answer.isError).toBeUndefined();
    const dry = voice.mock.calls[0]![0] as Record<string, unknown>;
    expect(dry).toMatchObject({ mode: "conversation", purpose: "Confirmer le rendez-vous", dry_run: true });
    expect(dry).not.toHaveProperty("message");
    const row = calls.pending(CTX.principalId)[0]!;
    expect(row.request.mode).toBe("conversation");
    calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true);
    const placed = await placePhoneCall(deps(), CTX, oneWay);
    expect(placed.text).toContain("Conversation call placed");
    expect(placed.text).not.toMatch(/your message|hangs up/);
    expect(real()[0]![0]).not.toHaveProperty("message");
  });

  it("the card is a conversation goal; a record of an older one-way call never shows its message as a script", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const card = callCard(calls.pending(CTX.principalId)[0]!, "Rocket");
    expect(card).toMatchObject({ mode: "conversation", objective: ARGS.objective });
    expect(card.script).toContain("assistant IA");
    const legacy: OutboundCallRecord = {
      id: "call_0000000000000001", principalId: CTX.principalId, botId: CTX.botId, threadId: CTX.threadId, digest: "x", status: "pending", createdAt: clock,
      request: { to: "+15145550142", from: "+14385550100", purpose: "Confirmer", message: "Texte à lire tel quel.", language: "fr" },
    };
    const old = callCard(legacy, "Rocket");
    expect(old.script).toBeUndefined();
    expect(old.callback).toBeUndefined();
    expect(old.purpose).toBe("Confirmer");
    expect(JSON.stringify(old)).not.toContain("Texte à lire");
  });

  it("no_realtime_voice relays Perspicax's reason in plain words; nothing is dialed and no card is shown", async () => {
    voice.mockResolvedValueOnce({
      ok: true, isError: true,
      value: { error: "no_realtime_voice", message: "The realtime voice is not live: the voice model's account is out of credits; the person who manages Perspicax tops it up at the vendor. nothing was dialed.", details: { reason: "no_realtime_voice", sidecar_state: "out_of_credits" } },
    });
    const refused = await placePhoneCall(deps(), CTX, ARGS);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("out of credits");
    expect(refused.text).toContain("tops it up");
    expect(refused.text).not.toContain("{");
    expect(calls.pending(CTX.principalId)).toHaveLength(0);
    // an older Perspicax without the reason: still plain words
    voice.mockResolvedValueOnce({ ok: true, isError: true, value: "no_realtime_voice" });
    const plain = await placePhoneCall(deps(), CTX, ARGS);
    expect(plain.text).toMatch(/live voice/i);
    expect(plain.text).not.toContain("no_realtime_voice");
  });

  it("the call speaks as the bot that placed it: voice_call names it, dry run and placement alike", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    expect(voice.mock.calls[0]![0]).toMatchObject({ bot: `sagax:${CTX.botId}`, dry_run: true });
    const row = calls.pending(CTX.principalId)[0]!;
    calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true);
    await placePhoneCall(deps(), CTX, ARGS);
    expect(real()[0]![0]).toMatchObject({ bot: `sagax:${CTX.botId}`, ref: row.id });
  });

  it("an older Perspicax that knows only the line's bots still places the call, without the bot", async () => {
    const older = { ok: true, isError: true, value: { code: "params_invalid", message: "bot: one of the line's bots (sagax:bot-line)" } };
    voice.mockImplementation(async (args: Record<string, unknown>) => (args.bot
      ? older
      : args.dry_run ? { ok: true, isError: false, value: { dry_run: true, mode: "conversation" } } : { ok: true, isError: false, value: { sid: SID, status: "queued" } }));
    const asked = await placePhoneCall(deps(), CTX, ARGS);
    expect(asked.isError).toBeUndefined();
    const row = calls.pending(CTX.principalId)[0]!;
    calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true);
    const placed = await placePhoneCall(deps(), CTX, ARGS);
    expect(placed.text).toContain("Conversation call placed");
    expect(real().at(-1)![0]).not.toHaveProperty("bot");
    expect(calls.get(row.id)).toMatchObject({ status: "placed", callSid: SID });
  });

  it("the live voice gone between the card and the call: the call fails with the reason in plain words", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.pending(CTX.principalId)[0]!;
    calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true);
    voice.mockResolvedValueOnce({ ok: true, isError: true, value: JSON.stringify({ message: "The realtime voice is off on this Perspicax; an admin turns it on.", details: { reason: "no_realtime_voice", sidecar_state: "off" } }) });
    const failed = await placePhoneCall(deps(), CTX, ARGS);
    expect(failed.isError).toBe(true);
    expect(calls.get(row.id)).toMatchObject({ status: "failed", error: "The realtime voice is off on this Perspicax; an admin turns it on" });
    expect(failed.text).toContain("an admin turns it on");
  });
});
