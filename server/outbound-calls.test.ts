import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CALL_APPROVAL_MS, callAnswerNote, callCard, OutboundCalls, placePhoneCall, type PlaceCallDeps } from "./outbound-calls.ts";

const ARGS = { to: "+1 514 555 0142", from: "+1 438 555 0100", purpose: "Confirmer le rendez-vous", message: "Jean confirme mardi 10 h." };
const CTX = { principalId: "jean@example.com", botId: "bot-rocket", threadId: "t-1" };
const SID = `CA${"a".repeat(32)}`;

let dir: string;
let clock: number;
let calls: OutboundCalls;
let cards: Array<{ status: string; messageId?: string }>;
let twilio: ReturnType<typeof vi.fn>;

function deps(): PlaceCallDeps {
  return {
    calls,
    twilio: twilio as unknown as PlaceCallDeps["twilio"],
    names: { botName: "Rocket", personName: "Jean" },
    language: "fr",
    card: (row, existing) => { cards.push({ status: row.status, ...(existing ? { messageId: existing } : {}) }); return existing ?? "m-1"; },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "outbound-calls-"));
  clock = 1_000_000;
  calls = new OutboundCalls(dir, () => clock);
  calls.updateSettings({ enabled: true, callbackNumber: "+1 438 555 0199" });
  cards = [];
  twilio = vi.fn(async (args: Record<string, unknown>) => (args._dry_run ? { ok: true, isError: false, value: { dry_run: true, method: "POST" } } : { ok: true, isError: false, value: { sid: SID, status: "queued" } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("placePhoneCall", () => {
  it("a first call only dry-runs and shows a card; nothing is placed", async () => {
    const answer = await placePhoneCall(deps(), CTX, ARGS);
    expect(answer.isError).toBeUndefined();
    expect(answer.text).toContain("Nothing was placed");
    expect(twilio).toHaveBeenCalledTimes(1);
    expect(twilio.mock.calls[0]![0]).toMatchObject({ resource: "Calls", action: "create", _dry_run: true });
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
    expect(placed.text).toContain("Call placed");
    expect(twilio).toHaveBeenCalledTimes(2);
    expect(twilio.mock.calls[1]![0]).not.toHaveProperty("_dry_run");
    expect(calls.get(row.id)).toMatchObject({ status: "placed", callSid: SID });
    await placePhoneCall(deps(), CTX, ARGS);
    expect(twilio.mock.calls[2]![0]).toMatchObject({ _dry_run: true });
  });

  it("changed words, another bot, or an expired approval never place the call", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    calls.answer(CTX.principalId, calls.pending(CTX.principalId)[0]!.id, "call", undefined, "+15145550142", true);
    await placePhoneCall(deps(), CTX, { ...ARGS, message: "Autre chose" });
    await placePhoneCall(deps(), { ...CTX, botId: "bot-other" }, ARGS);
    clock += CALL_APPROVAL_MS + 1;
    await placePhoneCall(deps(), CTX, ARGS);
    expect(twilio.mock.calls.every(([args]) => (args as Record<string, unknown>)._dry_run === true)).toBe(true);
  });

  it("an approval is bound to the bot and the person named in the opening (review)", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    calls.answer(CTX.principalId, calls.pending(CTX.principalId)[0]!.id, "call", undefined, "+15145550142", true);
    await placePhoneCall({ ...deps(), names: { botName: "Rocket", personName: "Quelqu'un d'autre" } }, CTX, ARGS);
    expect(twilio.mock.calls.every(([args]) => (args as Record<string, unknown>)._dry_run === true)).toBe(true);
    expect((twilio.mock.calls[0]![0] as { set: Record<string, unknown> }).set).not.toHaveProperty("MachineDetection");
  });

  it("a denied call is never placed and the bot is told", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.answer(CTX.principalId, calls.pending(CTX.principalId)[0]!.id, "deny", "Primary");
    expect(callAnswerNote(row)).toContain("declined");
    expect(row.via).toBe("Primary");
    await placePhoneCall(deps(), CTX, ARGS);
    expect(twilio.mock.calls.every(([args]) => (args as Record<string, unknown>)._dry_run === true)).toBe(true);
    expect(() => calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true)).toThrow(/already answered/);
    expect(() => calls.answer("someone@else", row.id, "call")).toThrow(/No such call/);
    expect(() => calls.answer(CTX.principalId, row.id, "always")).toThrow(/call or deny/);
  });

  it("a refused dry run or no Perspicax opens no card", async () => {
    twilio.mockResolvedValueOnce({ ok: false, code: "profile_not_mounted", error: "no Perspicax profile is mounted in this turn" });
    expect((await placePhoneCall(deps(), CTX, ARGS)).isError).toBe(true);
    twilio.mockResolvedValueOnce({ ok: true, isError: true, value: "From is not a number of this account" });
    expect((await placePhoneCall(deps(), CTX, ARGS)).text).toContain("dry run refused");
    expect(calls.pending(CTX.principalId)).toHaveLength(0);
    expect((await placePhoneCall(deps(), CTX, { ...ARGS, to: "+1 212 555 0142" })).isError).toBe(true);
  });

  it("two tries at once place one call", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    calls.answer(CTX.principalId, calls.pending(CTX.principalId)[0]!.id, "call", undefined, "+15145550142", true);
    const [a, b] = await Promise.all([placePhoneCall(deps(), CTX, ARGS), placePhoneCall(deps(), CTX, ARGS)]);
    expect([a.text, b.text].filter((text) => text.includes("Call placed"))).toHaveLength(1);
    expect(twilio.mock.calls.filter(([args]) => !(args as Record<string, unknown>)._dry_run)).toHaveLength(1);
  });

  it("a write Twilio accepted without a readable sid still counts as placed", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.pending(CTX.principalId)[0]!;
    calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true);
    twilio.mockResolvedValueOnce({ ok: true, isError: false, value: "created" });
    expect((await placePhoneCall(deps(), CTX, ARGS)).text).toContain("Call placed");
    expect(calls.get(row.id)?.status).toBe("placed");
  });

  it("a card left a day is stale, and a new ask closes the old card", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const old = calls.pending(CTX.principalId)[0]!;
    await placePhoneCall(deps(), CTX, { ...ARGS, message: "Autre message" });
    expect(calls.get(old.id)?.status).toBe("denied");
    expect(cards.some((card) => card.status === "denied")).toBe(true);
    clock += 24 * 60 * 60_000 + 1;
    expect(calls.pending(CTX.principalId)).toHaveLength(0);
  });

  it("a Twilio failure settles the approval as failed", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.pending(CTX.principalId)[0]!;
    calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true);
    twilio.mockResolvedValueOnce({ ok: true, isError: true, value: "21215: account not authorized" });
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

  it("pilot gate: off by default, no callback number, a do-not-call number, or an unconfirmed number never place a call (ÉFVP)", async () => {
    mkdirSync(join(dir, "fresh"));
    const fresh = new OutboundCalls(join(dir, "fresh"), () => clock);
    expect(fresh.settings()).toEqual({ enabled: false, doNotCall: [] });
    const off = await placePhoneCall({ ...deps(), calls: fresh }, CTX, ARGS);
    expect(off).toMatchObject({ isError: true });
    expect(off.text).toContain("off");
    fresh.updateSettings({ enabled: true });
    expect((await placePhoneCall({ ...deps(), calls: fresh }, CTX, ARGS)).text).toContain("callback number");
    fresh.updateSettings({ callbackNumber: "+1 438 555 0199", addDoNotCall: "514-555-0142" });
    expect(fresh.settings().doNotCall).toEqual(["+15145550142"]);
    const listed = await placePhoneCall({ ...deps(), calls: fresh }, CTX, ARGS);
    expect(listed.text).toContain("do-not-call");
    expect(twilio).not.toHaveBeenCalled();
    fresh.updateSettings({ removeDoNotCall: "+15145550142" });
    await placePhoneCall({ ...deps(), calls: fresh }, CTX, ARGS);
    const row = fresh.pending(CTX.principalId)[0]!;
    expect(() => fresh.answer(CTX.principalId, row.id, "call")).toThrow(/confirm the number/);
    expect(() => fresh.answer(CTX.principalId, row.id, "call", undefined, "+1 514 555 0000")).toThrow(/confirm the number/);
    fresh.answer(CTX.principalId, row.id, "call", undefined, "+1 514 555 0142", true);
    // added to the list after the yes: still refused, nothing placed
    fresh.updateSettings({ addDoNotCall: "+15145550142" });
    expect((await placePhoneCall({ ...deps(), calls: fresh }, CTX, ARGS)).text).toContain("do-not-call");
    expect(twilio.mock.calls.every(([args]) => (args as Record<string, unknown>)._dry_run === true)).toBe(true);
    expect(() => fresh.updateSettings({ callbackNumber: "nope" })).toThrow(/callback/);
  });

  it("the tick is the server's: no confirm flag, no call; a long name is cut, never emptied; the callback is in the digest (re-review)", async () => {
    await placePhoneCall(deps(), CTX, ARGS);
    const row = calls.pending(CTX.principalId)[0]!;
    expect(() => calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142")).toThrow(/confirm the number/);
    calls.answer(CTX.principalId, row.id, "call", undefined, "+15145550142", true);
    // the callback number changed after the yes: another card
    calls.updateSettings({ callbackNumber: "+1 438 555 0177" });
    await placePhoneCall(deps(), CTX, ARGS);
    expect(twilio.mock.calls.every(([args]) => (args as Record<string, unknown>)._dry_run === true)).toBe(true);
    const long = await placePhoneCall({ ...deps(), names: { botName: "Rocket", personName: "J".repeat(200) } }, { ...CTX, threadId: "t-2" }, ARGS);
    expect(long.isError).toBeUndefined();
    const twiml = String((twilio.mock.calls.at(-1)![0] as { set: { Twiml: string } }).set.Twiml);
    expect(twiml).toMatch(/au nom de J{20,80}\./);
  });
});
