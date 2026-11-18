// @vitest-environment happy-dom
// The Book a call card: the days that have a free slot, that day's times five at
// a time, a press on a time (one POST that books it), and the card that stays in
// place, showing the booked time, once it is settled.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { WIDGET_SAMPLES } from "../../../shared/widget-samples";
import { parseWidgetInput, widgetActions, type WidgetPayload, type WidgetRoot } from "../../../shared/widget";
import { WidgetMessage } from "./WidgetMessage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sample(): WidgetRoot {
  const parsed = parseWidgetInput(WIDGET_SAMPLES.bookingCard);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const row = (root: WidgetRoot, more: Partial<WidgetPayload> = {}): Message => ({
  id: "w1", role: "bot", kind: "widget", at: 1, text: "fallback", widget: { v: 1, root, ...more },
});
const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
const store = { state: { bots: [], config: { profile: { name: "Alex Doe" } } }, dispatch: vi.fn(), flushBotPatches: vi.fn(async () => null) } as unknown as ReturnType<typeof useStore>;
const inStore = (message: Message) => createElement(BotEditorStore, { value: store, children: createElement(WidgetMessage, { botId: "scout", threadId: "t1", message }) });

let host: HTMLDivElement;
let root: Root;
const mount = (message: Message) => act(() => root.render(inStore(message)));
const all = <T extends Element = HTMLElement>(selector: string) => Array.from(host.querySelectorAll<T>(selector));
const chips = () => all<HTMLButtonElement>("[data-widget-ref]").map((chip) => chip.textContent);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  // Monday 9 November 2026, 14:50 in Toronto
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T19:50:00Z"));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the Booking card", () => {
  it("draws the meeting, the upcoming bookings, the day tiles and the first day's first five times", () => {
    mount(row(sample()));
    const card = host.querySelector('[data-widget-booking]')!;
    expect(card.textContent).toContain("Book a call");
    expect(card.textContent).toContain("Quick sync");
    expect(card.textContent).toContain("30 min · Your booking link");
    // the person's own initials stand in for a photo
    expect(card.textContent).toContain("AD");
    expect(all("ul li").map((item) => item.textContent)).toEqual(["Jordan Lee · Nov 9 at 2:00 PM", "Sam Rivera · Nov 10 at 10:30 AM", "Casey Morgan · Nov 11 at 1:00 PM"]);
    // one listed past the three, and one more the bot said there is
    expect(card.textContent).toContain("and 2 more");
    expect(all('[role="radio"]').map((tile) => tile.textContent)).toEqual(["Mon9", "Tue10", "Wed11", "Thu12", "Fri13"]);
    expect(all('[role="radio"]')[0]!.getAttribute("aria-checked")).toBe("true");
    expect(chips().map((text) => text?.replace(/\s/g, " "))).toEqual(["3:30 PM", "4:00 PM", "4:30 PM", "5:00 PM", "5:30 PM"]);
    expect(card.textContent).toContain("Today · Nov 9");
  });

  it("shows the picked day's times, and More times the next ones, then the next day", () => {
    mount(row(sample()));
    act(() => all<HTMLButtonElement>('[role="radio"]')[1]!.click());
    expect(all('[role="radio"]')[1]!.getAttribute("aria-checked")).toBe("true");
    expect(chips().map((text) => text?.replace(/\s/g, " "))).toEqual(["9:00 AM", "9:30 AM", "11:00 AM", "2:00 PM", "2:30 PM"]);
    expect(host.textContent).toContain("Tomorrow · Nov 10");
    // Monday has a sixth time past the five
    act(() => all<HTMLButtonElement>('[role="radio"]')[0]!.click());
    const more = all<HTMLButtonElement>("button").find((button) => button.textContent === "More times")!;
    act(() => more.click());
    expect(chips()).toHaveLength(6);
    // that was the last of Monday: the next press moves to Tuesday
    act(() => more.click());
    expect(all('[role="radio"]')[1]!.getAttribute("aria-checked")).toBe("true");
  });

  it("books the time pressed with one POST that carries the slot's own button", async () => {
    const message = row(sample());
    mount(message);
    const chip = all<HTMLButtonElement>("[data-widget-ref]")[1]!;
    await act(async () => { chip.click(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/bots/scout/messages");
    const entry = widgetActions(message.widget!.root).find((candidate) => candidate.ref === chip.getAttribute("data-widget-ref"))!;
    expect(entry.action).toMatchObject({ type: "book_slot", payload: { start: "2026-11-09T21:00:00.000Z", timeZone: "America/Toronto" } });
    expect(JSON.parse(String(init?.body)).widgetAction.ref).toBe(entry.ref);
  });

  it("keeps the card in place once booked, with the chosen time marked and nothing else pressable", () => {
    const parsed = sample();
    const entry = widgetActions(parsed)[2]!;
    mount(row(parsed, { settled: { ref: entry.ref, label: entry.label, tone: "submit", at: 1 } }));
    const card = host.querySelector('[data-widget="w1"]')!;
    expect(card.getAttribute("data-widget-state")).toBe("settled");
    expect(host.querySelector('[role="status"]')!.textContent).toMatch(/^Booked · Mon, Nov 9, 4:30\sPM$/);
    const chosen = all<HTMLButtonElement>("[data-widget-ref]").filter((chip) => chip.getAttribute("aria-pressed") === "true");
    expect(chosen.map((chip) => chip.textContent?.replace(/\s/g, " "))).toEqual(["4:30 PM"]);
    expect(all<HTMLButtonElement>("[data-widget-ref]").filter((chip) => chip.getAttribute("aria-pressed") !== "true").every((chip) => chip.disabled)).toBe(true);
    expect(all<HTMLButtonElement>("button").some((button) => button.textContent === "More times")).toBe(false);
  });
});
