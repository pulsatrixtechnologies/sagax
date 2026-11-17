// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { answer, ticketCard, TICKET_REF } from "./record-card-fixtures";
import {
  confirmRecordCard, peekRecordCard, prefetchRecordCard, readRecordCard, recordBackoffLeft, recordCardPath, refreshRecordCard, resetRecordCards,
  RECORD_BUSY_BACKOFF_MS, RECORD_CARD_TTL_MS,
} from "./record-cards";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let calls: string[];
let reply: () => Response | Promise<Response>;

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-11-17T19:34:00Z"), toFake: ["Date", "setTimeout", "clearTimeout"] });
  setLocale("fr");
  resetRecordCards();
  calls = [];
  reply = () => json(answer(ticketCard(Date.now(), "fr")));
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    calls.push(String(input));
    return reply();
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("record card client", () => {
  it("asks the route with the person's language", async () => {
    expect(recordCardPath(TICKET_REF, { lang: "fr", fresh: true, confirm: true })).toBe("/api/me/records/nimbus_desk/ticket/481516?lang=fr&fresh=1&confirm=1");
    await readRecordCard(TICKET_REF);
    expect(calls).toEqual(["/api/me/records/nimbus_desk/ticket/481516?lang=fr"]);
  });

  it("makes one read for concurrent callers and none while the answer is fresh", async () => {
    await Promise.all([readRecordCard(TICKET_REF), readRecordCard(TICKET_REF), readRecordCard(TICKET_REF)]);
    prefetchRecordCard(TICKET_REF);
    await readRecordCard(TICKET_REF);
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + RECORD_CARD_TTL_MS + 1);
    await readRecordCard(TICKET_REF);
    expect(calls).toHaveLength(2);
  });

  it("keeps a card per language", async () => {
    await readRecordCard(TICKET_REF);
    setLocale("en");
    await readRecordCard(TICKET_REF);
    expect(calls.map((call) => call.split("?")[1])).toEqual(["lang=fr", "lang=en"]);
  });

  it("refresh reads again with fresh=1", async () => {
    await readRecordCard(TICKET_REF);
    await refreshRecordCard(TICKET_REF);
    expect(calls[1]).toContain("fresh=1");
  });

  it("backs the product off after busy, without calling, then reads again", async () => {
    reply = () => json({ state: "busy", retryAfter: 4 });
    const first = await readRecordCard(TICKET_REF);
    expect(first).toMatchObject({ state: "busy" });
    expect(recordBackoffLeft("nimbus_desk")).toBe(4);
    const other = { ...TICKET_REF, id: "481517" };
    expect(await readRecordCard(other)).toMatchObject({ state: "busy" });
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 4_001);
    reply = () => json(answer(ticketCard(Date.now(), "fr")));
    expect(await readRecordCard(TICKET_REF)).toHaveProperty("card");
    expect(calls).toHaveLength(2);
  });

  it("backs off ten seconds when busy names no delay, and keeps the card it already has", async () => {
    await readRecordCard(TICKET_REF);
    reply = () => json({ state: "busy" });
    await refreshRecordCard(TICKET_REF);
    expect(recordBackoffLeft("nimbus_desk")).toBe(RECORD_BUSY_BACKOFF_MS / 1000);
    expect(peekRecordCard(TICKET_REF).answer).toHaveProperty("card");
  });

  it("remembers a confirmation for the record until reload", async () => {
    reply = () => json({ state: "org_ask", rule: { id: "r", text: "ask" } });
    expect(await readRecordCard(TICKET_REF)).toMatchObject({ state: "org_ask" });
    reply = () => json(answer(ticketCard(Date.now(), "fr")));
    await confirmRecordCard(TICKET_REF);
    expect(calls[1]).toContain("confirm=1");
    await refreshRecordCard(TICKET_REF);
    expect(calls[2]).toContain("confirm=1");
  });

  it("turns a failure into a state", async () => {
    reply = () => json({ error: "x" }, 404);
    expect(await readRecordCard(TICKET_REF)).toEqual({ state: "unavailable" });
    resetRecordCards();
    reply = () => { throw new TypeError("network"); };
    expect(await readRecordCard(TICKET_REF)).toEqual({ state: "down" });
  });
});
