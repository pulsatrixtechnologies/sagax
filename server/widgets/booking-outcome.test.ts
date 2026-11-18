import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import type { WidgetPayload } from "../../shared/widget.ts";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armBooking, bookingWatchFiles, classifyTool, createBookingOutcome, failureDetail, isCalendarCreate, RESTART_GRACE_MS, toolLabel } from "./booking-outcome.ts";

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
  armBooking(THREAD);
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

describe("which tools are the booking, by what the tool policy declares", () => {
  it("reads the policy's own classification first and the name list only as a fallback", () => {
    expect(classifyTool("mcp__claude_ai_Microsoft_365__outlook_calendar_event_create")).toBe("create");
    expect(classifyTool("mcp__claude_ai_Google_Calendar__create_event")).toBe("create");
    // a server the policy does not know, named like a create
    expect(classifyTool("book_meeting")).toBe("create");
    // writes the policy sees but that are not a create
    expect(classifyTool("mcp__claude_ai_Microsoft_365__outlook_calendar_event_update")).toBe("write");
    expect(classifyTool("mcp__claude_ai_Microsoft_365__outlook_calendar_delete_event")).toBe("write");
    expect(classifyTool("mcp__claude_ai_Microsoft_365__outlook_flag_message")).toBe("write");
    // reads, a mail send and a built-in are no calendar write
    expect(classifyTool("mcp__claude_ai_Microsoft_365__outlook_calendar_list_events")).toBe("other");
    expect(classifyTool("mcp__claude_ai_Microsoft_365__outlook_send_mail")).toBe("other");
    expect(classifyTool("Read")).toBe("other");
    expect(toolLabel("mcp__claude_ai_Microsoft_365__outlook_flag_message")).toBe("outlook_flag_message");
  });

  it("says to check the calendar, not that nothing was booked, when a write that is not the create ran", () => {
    const { rows, outcome } = setup();
    outcome.observe(ev({ type: "turn.started" }));
    outcome.observe(started("w1", "mcp__claude_ai_Microsoft_365__outlook_flag_message"));
    outcome.observe(done("w1", true));
    outcome.observe(turnDone);
    expect(rows[0]!.widget.settled).toBeUndefined();
    expect(rows[0]!.widget.booking).toMatchObject({ state: "failed", code: "check_calendar", detail: "outlook_flag_message" });
  });

  it("does not take an update for the booking, and a write that failed did not run", () => {
    const { rows, outcome } = setup();
    outcome.observe(ev({ type: "turn.started" }));
    outcome.observe(started("u1", "mcp__claude_ai_Microsoft_365__outlook_calendar_event_update"));
    outcome.observe(done("u1", true));
    expect(rows[0]!.widget.booking!.state).toBe("pending");
    outcome.observe(started("u2", "mcp__claude_ai_Microsoft_365__outlook_flag_message"));
    outcome.observe(done("u2", false, "no"));
    outcome.observe(turnDone);
    expect(rows[0]!.widget.booking).toMatchObject({ code: "check_calendar", detail: "outlook_calendar_event_update" });
  });
});

describe("a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "booking-watches-"));
  const files = () => bookingWatchFiles(dir);
  const reset = () => rmSync(dir, { recursive: true, force: true });
  const store = (rows: Array<{ id: string; kind: string; widget: WidgetPayload }>) => ({
    messagesFor: () => rows,
    patchMessage: (_t: string, id: string, patch: { widget: WidgetPayload }) => { rows.find((row) => row.id === id)!.widget = patch.widget; },
  });
  const widget = (): WidgetPayload => ({
    v: 1, root: { type: "Card", id: "n1", children: [] },
    settled: { ref: "n3", label: "Book", tone: "submit", at: 1 }, booking: { state: "pending", at: 1 },
  });

  it("keeps the watch on disk and leaves the press pending, then lets a resumed turn book it", () => {
    reset();
    const rows = [{ id: "w1", kind: "widget", widget: widget() }];
    armBooking(THREAD);
    const before = createBookingOutcome(store(rows), () => 10, files());
    before.observe(ev({ type: "turn.started" }));
    before.observe(started("c1", "mcp__claude_ai_Microsoft_365__outlook_calendar_event_create"));
    expect(existsSync(join(dir, "booking-watches", `${THREAD}.json`))).toBe(true);
    // the server stops and starts again: a new tracker reads the watch back
    const after = createBookingOutcome(store(rows), () => 20, files());
    expect(after.restore()).toBe(1);
    // the cut turn's own end settles nothing
    after.observe(ev({ type: "turn.completed", ok: false }));
    expect(rows[0]!.widget.booking!.state).toBe("pending");
    // a resumed turn does the booking
    after.observe(ev({ type: "turn.started", turnId: "turn2" }));
    after.observe(ev({ type: "item.started", itemType: "tool", itemId: "c9", title: "mcp__claude_ai_Microsoft_365__outlook_calendar_event_create", turnId: "turn2" }));
    after.observe(ev({ type: "item.completed", itemType: "tool", itemId: "c9", ok: true, turnId: "turn2" }));
    expect(rows[0]!.widget.booking!.state).toBe("booked");
    expect(existsSync(join(dir, "booking-watches", `${THREAD}.json`))).toBe(false);
  });

  it("says to check the calendar when the call that was running at the restart never reported", () => {
    reset();
    const rows = [{ id: "w1", kind: "widget", widget: widget() }];
    armBooking(THREAD);
    const before = createBookingOutcome(store(rows), () => 10, files());
    before.observe(ev({ type: "turn.started" }));
    before.observe(started("c1", "mcp__claude_ai_Microsoft_365__outlook_calendar_event_create"));
    const after = createBookingOutcome(store(rows), () => 20, files());
    after.restore();
    after.observe(ev({ type: "turn.started", turnId: "turn2" }));
    after.observe(ev({ type: "turn.completed", ok: true, turnId: "turn2" }));
    expect(rows[0]!.widget.settled).toBeUndefined();
    expect(rows[0]!.widget.booking).toMatchObject({ code: "check_calendar", detail: "outlook_calendar_event_create" });
  });

  it("waits the grace for a resumed turn, then settles on what it knows", () => {
    reset();
    const rows = [{ id: "w1", kind: "widget", widget: widget() }];
    armBooking(THREAD);
    const before = createBookingOutcome(store(rows), () => 10, files());
    before.observe(ev({ type: "turn.started" }));
    let clock = 100;
    const after = createBookingOutcome(store(rows), () => clock, files());
    after.restore();
    clock += RESTART_GRACE_MS - 1;
    after.sweep();
    expect(rows[0]!.widget.booking!.state).toBe("pending");
    clock += 2;
    after.sweep();
    // no call was ever started: nothing was booked, and that is known
    expect(rows[0]!.widget.booking).toMatchObject({ state: "failed", code: "not_booked" });
    reset();
  });

  it("forgets a watch whose card was settled another way", () => {
    reset();
    const rows = [{ id: "w1", kind: "widget", widget: widget() }];
    armBooking(THREAD);
    createBookingOutcome(store(rows), () => 10, files()).observe(ev({ type: "turn.started" }));
    rows[0]!.widget = { ...rows[0]!.widget, booking: { state: "booked", at: 5 } };
    expect(createBookingOutcome(store(rows), () => 20, files()).restore()).toBe(0);
    expect(existsSync(join(dir, "booking-watches", `${THREAD}.json`))).toBe(false);
    reset();
  });

  it("calls a pending card no watch knows unconfirmed when a turn ends in its thread", () => {
    const rows = [{ id: "w1", kind: "widget", widget: widget() }];
    // nothing armed this thread and no file: the card is one an older build left
    const thread = "t-legacy";
    const tracker = createBookingOutcome({ messagesFor: () => rows, patchMessage: (_t: string, id: string, patch: { widget: WidgetPayload }) => { rows.find((row) => row.id === id)!.widget = patch.widget; } }, () => 7);
    tracker.observe({ ...base, threadId: thread, turnId: "x", type: "turn.completed", ok: true } as unknown as RuntimeEvent);
    expect(rows[0]!.widget.booking).toMatchObject({ state: "failed", code: "unconfirmed" });
  });
});
