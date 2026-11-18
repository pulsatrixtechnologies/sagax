import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import type { WidgetPayload } from "../../shared/widget.ts";
import { createBookingOutcome, failureDetail, isCalendarCreate } from "./booking-outcome.ts";

const THREAD = "t1";
const base = { eventId: "e", provider: "claude", threadId: THREAD, createdAt: "2026-11-09T19:50:00Z" } as const;
const ev = (more: Record<string, unknown>) => ({ ...base, turnId: "turn1", ...more }) as unknown as RuntimeEvent;
const started = (itemId: string, title: string) => ev({ type: "item.started", itemType: "tool", itemId, title });
const done = (itemId: string, ok: boolean, output?: string) => ev({ type: "item.completed", itemType: "tool", itemId, ok, ...(output ? { output } : {}) });
const turnDone = ev({ type: "turn.completed", ok: true });

/** A thread holding one Booking widget as the press left it: settled, pending. */
function setup(settledMore: Record<string, unknown> = {}) {
  const widget: WidgetPayload = {
    v: 1, root: { type: "Card", id: "n1", children: [] },
    settled: { ref: "n3", label: "Book Mon, Nov 9, 4:30 PM", tone: "submit", at: 1, ...settledMore },
    booking: { state: "pending", at: 1 },
  };
  const rows = [{ id: "w1", kind: "widget", widget }];
  const store = {
    messagesFor: () => rows,
    patchMessage: (_thread: string, id: string, patch: { widget: WidgetPayload }) => { rows.find((row) => row.id === id)!.widget = patch.widget; },
  };
  return { rows, outcome: createBookingOutcome(store, () => 99) };
}

describe("which calls create a calendar event", () => {
  it("matches the creating tools of the calendar connectors and nothing that only reads or changes", () => {
    for (const name of ["mcp__claude_ai_Microsoft_365__outlook_calendar_event_create", "GOOGLECALENDAR_CREATE_EVENT", "calendar_events_insert", "book_meeting"]) expect(isCalendarCreate(name), name).toBe(true);
    for (const name of ["outlook_calendar_list_events", "GOOGLECALENDAR_FIND_EVENT", "delete_calendar_event", "outlook_calendar_event_update", "respond_to_calendar_event", "Read", undefined]) expect(isCalendarCreate(name), String(name)).toBe(false);
  });

  it("keeps the first line of a failure, bounded", () => {
    expect(failureDetail("\n  The slot is taken.\nstack...")).toBe("The slot is taken.");
    expect(failureDetail("x".repeat(400))!.length).toBe(160);
    expect(failureDetail(undefined)).toBeUndefined();
  });
});

describe("a booking press waits for the calendar tool", () => {
  it("stays pending while the tool runs, and is booked only when it ends ok", () => {
    const { rows, outcome } = setup();
    outcome.observe(ev({ type: "turn.started" }));
    outcome.observe(started("c1", "outlook_calendar_event_create"));
    expect(rows[0]!.widget.booking!.state).toBe("pending");
    outcome.observe(done("c1", true));
    expect(rows[0]!.widget.booking).toMatchObject({ state: "booked" });
    expect(rows[0]!.widget.settled!.ref).toBe("n3");
  });

  it("gives the card back, selectable, with the tool's own words when the call fails", () => {
    const { rows, outcome } = setup();
    outcome.observe(ev({ type: "turn.started" }));
    outcome.observe(started("c1", "outlook_calendar_event_create"));
    outcome.observe(done("c1", false, "That time is no longer free.\nmore"));
    expect(rows[0]!.widget.settled).toBeUndefined();
    expect(rows[0]!.widget.booking).toMatchObject({ state: "failed", code: "tool_failed", detail: "That time is no longer free." });
  });

  it("books after all when a retry in the same turn works", () => {
    const { rows, outcome } = setup();
    outcome.observe(ev({ type: "turn.started" }));
    outcome.observe(started("c1", "GOOGLECALENDAR_CREATE_EVENT"));
    outcome.observe(done("c1", false, "busy"));
    outcome.observe(started("c2", "GOOGLECALENDAR_CREATE_EVENT"));
    outcome.observe(done("c2", true));
    expect(rows[0]!.widget.booking!.state).toBe("booked");
    expect(rows[0]!.widget.settled!.ref).toBe("n3");
  });

  it("gives the card back when the turn ends with no calendar call", () => {
    const { rows, outcome } = setup();
    outcome.observe(ev({ type: "turn.started" }));
    outcome.observe(started("r1", "outlook_calendar_list_events"));
    outcome.observe(done("r1", true));
    expect(rows[0]!.widget.booking!.state).toBe("pending");
    outcome.observe(turnDone);
    expect(rows[0]!.widget.settled).toBeUndefined();
    expect(rows[0]!.widget.booking).toMatchObject({ state: "failed", code: "not_booked" });
  });

  it("ignores the end of a turn that was already running when the press waited in the queue", () => {
    const { rows, outcome } = setup({ queueId: "q1" });
    outcome.observe(ev({ type: "item.started", itemType: "tool", itemId: "x", title: "Read", turnId: "old" }));
    outcome.observe(ev({ type: "turn.completed", ok: true, turnId: "old" }));
    expect(rows[0]!.widget.booking!.state).toBe("pending");
    outcome.observe(ev({ type: "turn.started", turnId: "new" }));
    outcome.observe(ev({ type: "turn.completed", ok: true, turnId: "new" }));
    expect(rows[0]!.widget.booking).toMatchObject({ state: "failed", code: "not_booked" });
  });

  it("does nothing for a thread with no pending booking", () => {
    const { rows, outcome } = setup();
    rows[0]!.widget = { ...rows[0]!.widget, booking: { state: "booked", at: 1 } };
    outcome.observe(started("c1", "outlook_calendar_event_create"));
    outcome.observe(done("c1", false, "boom"));
    expect(rows[0]!.widget.booking!.state).toBe("booked");
  });
});

describe("a time pressed on a Booking card", () => {
  it("settles it as pending, not booked, and a failed booking lets the next press through", async () => {
    const { parseWidgetInput, widgetActions } = await import("../../shared/widget.ts");
    const { WIDGET_SAMPLES } = await import("../../shared/widget-samples.ts");
    const { prepareWidgetPress } = await import("./chat-widgets.ts");
    const parsed = parseWidgetInput(WIDGET_SAMPLES.bookingCard);
    if (!parsed.ok) throw new Error(parsed.error);
    const rows = [{ id: "w1", kind: "widget", widget: { v: 1, root: parsed.value } as WidgetPayload }];
    const store = {
      messagesFor: () => rows,
      patchMessage: (_thread: string, id: string, patch: { widget: WidgetPayload }) => { rows.find((row) => row.id === id)!.widget = patch.widget; },
    };
    const ref = widgetActions(parsed.value)[1]!.ref;
    const press = () => prepareWidgetPress(store as never, THREAD, { messageId: "w1", ref, rev: 0 }, "s1");
    const first = press();
    if (!first.ok) throw new Error(first.error);
    first.settle();
    expect(rows[0]!.widget.settled!.ref).toBe(ref);
    expect(rows[0]!.widget.booking).toMatchObject({ state: "pending" });
    // the calendar tool refused: the card is live again and takes a new press
    const outcome = createBookingOutcome(store as never, () => 5);
    outcome.observe(ev({ type: "turn.started" }));
    outcome.observe(started("c1", "outlook_calendar_event_create"));
    outcome.observe(done("c1", false, "refused"));
    expect(press().ok).toBe(true);
    const again = press();
    if (!again.ok) throw new Error(again.error);
    again.settle();
    expect(rows[0]!.widget.booking).toMatchObject({ state: "pending" });
  });
});
