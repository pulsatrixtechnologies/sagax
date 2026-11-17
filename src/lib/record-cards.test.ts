// @vitest-environment happy-dom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { answer, ticketCard, TICKET_REF } from "./record-card-fixtures";
import {
  confirmRecordCard, peekRecordCard, prefetchRecordCard, readRecordCard, recordBackoffLeft, recordCardPath, refreshRecordCard, resetRecordCards,
  RECORD_BUSY_BACKOFF_MS, RECORD_CARD_TTL_MS, RECORD_READS_AT_ONCE, useRecordCard,
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

describe("a failed read is not read again by itself", () => {
  function mount(ref = TICKET_REF) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let latest: ReturnType<typeof useRecordCard> | null = null;
    const Probe = () => { latest = useRecordCard(ref, { enabled: true }); return null; };
    act(() => root.render(createElement(Probe)));
    return { get read() { return latest!; }, stop: () => { act(() => root.unmount()); host.remove(); } };
  }
  const settle = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  it.each([
    ["down", () => json({ state: "down" })],
    ["sign_in", () => json({ state: "sign_in" })],
    ["unavailable", () => json({ state: "unavailable" })],
    ["a network failure", () => { throw new TypeError("network"); }],
  ] as const)("makes one read for %s while the card stays open", async (_name, make) => {
    reply = make as () => Response;
    const view = mount();
    await settle(6_000);
    expect(calls).toHaveLength(1);
    expect(view.read.loading).toBe(false);
    expect(view.read.miss).not.toBeNull();
    view.stop();
  });

  it("reads once more on Réessayer (refresh), and again after the cache time when reopened", async () => {
    reply = () => json({ state: "down" });
    const view = mount();
    await settle(2_000);
    expect(calls).toHaveLength(1);
    act(() => view.read.refresh());
    await settle(2_000);
    expect(calls).toHaveLength(2);
    view.stop();
    vi.setSystemTime(Date.now() + RECORD_CARD_TTL_MS + 1);
    const again = mount();
    await settle(1_000);
    expect(calls).toHaveLength(3);
    again.stop();
  });

  it("keeps a card it already has when a re-read fails", async () => {
    await readRecordCard(TICKET_REF);
    reply = () => json({ state: "down" });
    await refreshRecordCard(TICKET_REF);
    expect(peekRecordCard(TICKET_REF).answer).toHaveProperty("card");
  });

  it("reads twenty chips of one message at most once each and never more than the limit at once", async () => {
    let running = 0, peak = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      calls.push(String(input));
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((done) => setTimeout(done, 50));
      running -= 1;
      return json(answer(ticketCard(Date.now(), "fr")));
    }));
    const refs = Array.from({ length: 20 }, (_, index) => ({ ...TICKET_REF, id: String(481000 + index) }));
    const reads = refs.flatMap((ref) => [readRecordCard(ref), readRecordCard(ref)]);
    await vi.advanceTimersByTimeAsync(2_000);
    await Promise.all(reads);
    expect(calls).toHaveLength(20);
    expect(new Set(calls).size).toBe(20);
    expect(peak).toBeLessThanOrEqual(RECORD_READS_AT_ONCE);
  });
});


describe("a reset", () => {
  it("settles the reads still waiting for a turn, and the running ones never take the count below zero", async () => {
    const releases: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      calls.push(String(input));
      await new Promise<void>((done) => releases.push(done));
      return json(answer(ticketCard(Date.now(), "fr")));
    }));
    const refs = Array.from({ length: 6 }, (_, index) => ({ ...TICKET_REF, id: String(482000 + index) }));
    const reads = refs.map((ref) => readRecordCard(ref));
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(RECORD_READS_AT_ONCE);
    resetRecordCards();
    // the two that never got a turn settle at once, as unavailable
    const queued = await Promise.all(reads.slice(RECORD_READS_AT_ONCE));
    expect(queued).toEqual([{ state: "unavailable" }, { state: "unavailable" }]);
    // the running ones finish without a throw
    releases.forEach((release) => release());
    await vi.advanceTimersByTimeAsync(10);
    await Promise.all(reads.slice(0, RECORD_READS_AT_ONCE));
    // and the limit still holds afterwards (a count under zero would let more through)
    calls.length = 0;
    releases.length = 0;
    const more = Array.from({ length: 8 }, (_, index) => readRecordCard({ ...TICKET_REF, id: String(483000 + index) }));
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(RECORD_READS_AT_ONCE);
    releases.forEach((release) => release());
    await vi.advanceTimersByTimeAsync(10);
    releases.forEach((release) => release());
    await vi.advanceTimersByTimeAsync(10);
    await Promise.all(more);
  });
});
