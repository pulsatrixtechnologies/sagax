// A Booking card never claims a booking the calendar tool did not confirm. A
// press on a time (`book_slot`) settles the card as `booking: pending`
// (chat-widgets.ts); this watches the bot's tools after that press: the first
// calendar create call that ends ok makes it `booked`, one that ends in an error
// gives the card back, selectable, with the tool's own words, and a turn that ends
// with no such call gives it back too ("nothing was booked"). Sagax has no
// calendar of its own: the tool is the person's calendar connector, matched by
// its name, so the organization's rules still ruled whether it ran.
import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import type { WidgetBookingState, WidgetPayload } from "../../shared/widget.ts";

/** A calendar tool that creates an event, by name: "outlook_calendar_event_create", "GOOGLECALENDAR_CREATE_EVENT". */
export function isCalendarCreate(name: string | undefined): boolean {
  if (!name) return false;
  const text = name.toLowerCase();
  return /(calendar|event|meeting|appointment)/.test(text) && /(create|insert|add|book|schedule|new_|make)/.test(text) && !/(delete|cancel|list|get|find|search|update|respond|accept)/.test(text);
}

/** The first line of a tool's own words, bounded: what the card says when the call failed. */
export function failureDetail(output: string | undefined): string | undefined {
  const line = (output ?? "").split("\n").map((part) => part.trim()).find(Boolean);
  if (!line) return undefined;
  const flat = line.replace(/\s+/g, " ");
  return flat.length <= 160 ? flat : `${flat.slice(0, 159).trimEnd()}…`;
}

interface Message { id: string; kind?: string; widget?: WidgetPayload }
interface Store {
  messagesFor(threadId: string): readonly Message[];
  patchMessage(threadId: string, id: string, patch: { widget: WidgetPayload }): unknown;
}

interface Watch {
  messageId: string;
  /** The press that settled the card, kept to put it back if a retry in the same turn works. */
  settled: NonNullable<WidgetPayload["settled"]>;
  /** The press waited in the steer queue: its turn is the one that starts after it. */
  queued: boolean;
  /** The turn this press started or joined, once one is seen. */
  turnId?: string;
  /** The calendar calls of the turn that have not ended. */
  calls: Set<string>;
}

/** Threads that hold a pressed time waiting on the calendar tool: every other thread's events cost nothing here. */
const armed = new Set<string>();
export const armBooking = (threadId: string): void => { armed.add(threadId); };

export function createBookingOutcome(store: Store, now: () => number = Date.now) {
  const watches = new Map<string, Watch>();
  const pendingOf = (threadId: string): Message | undefined =>
    store.messagesFor(threadId).findLast((message) => message.kind === "widget" && message.widget?.booking?.state === "pending" && message.widget.settled);
  const widgetOf = (threadId: string, id: string): WidgetPayload | undefined =>
    store.messagesFor(threadId).find((candidate) => candidate.id === id)?.widget;

  /** The card as it stands for one outcome: booked keeps its answer, failed gives the card back. */
  function patch(threadId: string, watch: Watch, booking: WidgetBookingState): void {
    const current = widgetOf(threadId, watch.messageId);
    if (!current || current.booking?.state === "booked") return;
    const { settled: _settled, ...open } = current;
    store.patchMessage(threadId, watch.messageId, { widget: booking.state === "booked" ? { ...open, settled: watch.settled, booking } : { ...open, booking } });
  }

  return {
    observe(event: RuntimeEvent): void {
      const { threadId } = event;
      // a turn's end is the one event read on every thread (a restart forgets what was armed); the rest, only where armed
      if (!armed.has(threadId) && event.type !== "turn.completed") return;
      let watch = watches.get(threadId);
      const pending = pendingOf(threadId);
      if (pending?.widget?.settled && (!watch || watch.messageId !== pending.id)) {
        watch = { messageId: pending.id, settled: pending.widget.settled, queued: Boolean(pending.widget.settled.queueId), calls: new Set() };
        watches.set(threadId, watch);
      }
      if (!watch) {
        armed.delete(threadId);
        return;
      }
      if (!watch.turnId && event.turnId && (event.type === "turn.started" || !watch.queued)) watch.turnId = event.turnId;
      if (event.turnId && watch.turnId && event.turnId !== watch.turnId) return;
      if (event.type === "item.started" && event.itemType === "tool" && event.itemId && isCalendarCreate(event.title)) {
        watch.calls.add(event.itemId);
      } else if (event.type === "item.completed" && event.itemType === "tool" && event.itemId && watch.calls.delete(event.itemId)) {
        if (event.ok) {
          patch(threadId, watch, { state: "booked", at: now() });
          watches.delete(threadId);
          armed.delete(threadId);
        } else {
          // the card is selectable again at once; a retry that works in this same turn still books it
          const detail = failureDetail(event.output);
          patch(threadId, watch, { state: "failed", at: now(), code: "tool_failed", ...(detail ? { detail } : {}) });
        }
      } else if (event.type === "turn.completed" && watch.turnId && event.turnId === watch.turnId) {
        // the turn ended: with no calendar call that confirmed anything, nothing was booked
        if (widgetOf(threadId, watch.messageId)?.booking?.state === "pending") patch(threadId, watch, { state: "failed", at: now(), code: "not_booked" });
        watches.delete(threadId);
        armed.delete(threadId);
      }
    },
  };
}
