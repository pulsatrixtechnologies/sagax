// A Booking card never claims a booking the calendar tool did not confirm. A
// press on a time (`book_slot`) settles the card as `booking: pending`
// (chat-widgets.ts); this watches the bot's tools after that press: the first
// calendar create call that ends ok makes it `booked`, one that ends in an error
// gives the card back, selectable, with the tool's own words, and a turn that ends
// with no such call gives it back too. Sagax has no calendar of its own: the
// tool is the person's calendar connector, so the organization's rules still
// ruled whether it ran.
//
// The tool is recognised by what the tool policy declares for it
// (shared/engine-connectors.ts connectorWriteKind, the reading every approval
// card uses: a calendar connector's create call is `calendar-invite`), with a
// name list only as a fallback for a server that policy does not know. A write
// the policy sees but cannot call a create (an update, a cancel, a write of
// another kind on a connector) is never taken for the booking; if one ran and
// no create was confirmed, the card says "Check your calendar: <tool> ran"
// rather than "Nothing was booked".
//
// What the watch holds is kept in DATA_DIR/booking-watches/<thread>.json, so a
// restart settles nothing wrongly: the press stays pending, the watch is read
// back, a call that was running when the server stopped is remembered as one
// whose outcome is unknown, and the card is settled by the turn that resumes it,
// or by a short wait when none does.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { connectorWriteKind } from "../../shared/engine-connectors.ts";
import type { RuntimeEvent } from "../../shared/runtime-events.ts";
import type { WidgetBookingState, WidgetPayload } from "../../shared/widget.ts";
import { writeFileAtomic } from "../atomic.ts";

export type ToolClass = "create" | "write" | "other";

const UPDATE_WORDS = /(update|patch|edit|modify|reschedule|move)/;
const CREATE_WORDS = /(create|insert|add|book|schedule|new_|make)/;

/** A calendar tool that creates an event, by name alone (the fallback). */
export function isCalendarCreate(name: string | undefined): boolean {
  if (!name) return false;
  const text = name.toLowerCase();
  return /(calendar|event|meeting|appointment)/.test(text) && CREATE_WORDS.test(text) && !/(delete|cancel|list|get|find|search|update|respond|accept)/.test(text);
}

/** What a tool call is to a booking: `create` (the calendar create call), `write` (a calendar or connector
 * write that is not a create: it changed something, so the person should look), or `other`. */
export function classifyTool(name: string | undefined): ToolClass {
  if (!name) return "other";
  const kind = connectorWriteKind(name);
  const text = name.toLowerCase();
  if (kind === "calendar-invite") return UPDATE_WORDS.test(text) && !/(create|insert|add|book|new_)/.test(text) ? "write" : "create";
  if (kind === "calendar-cancel" || kind === "calendar-respond" || kind === "other-write") return "write";
  if (kind) return "other";
  return isCalendarCreate(name) ? "create" : "other";
}

/** The tool's own name without its server, for the card ("outlook_calendar_event_update"). */
export function toolLabel(name: string): string {
  const match = /^(?:mcp__)?[A-Za-z0-9][A-Za-z0-9_.-]*?__([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(name);
  return (match ? match[1]! : name).slice(0, 80);
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

export interface Watch {
  messageId: string;
  /** The press that settled the card, kept to put it back if a retry in the same turn works. */
  settled: NonNullable<WidgetPayload["settled"]>;
  /** The press waited in the steer queue: its turn is the one that starts after it. */
  queued: boolean;
  /** The turn this press started or joined, once one is seen. */
  turnId?: string;
  /** The calendar calls of the turn that have not ended, by item id. */
  calls: Record<string, { name: string; kind: "create" | "write" }>;
  /** Writes that ended ok without being the booking (tool labels). */
  ran: string[];
  /** Writes whose outcome a restart cut off (tool labels). */
  lost: string[];
  /** Read back after a restart: the turn it names is gone until a resumed one shows up. */
  restarted?: boolean;
  /** A resumed or later turn took over a restarted watch. */
  adopted?: boolean;
  /** When a restarted watch was read back, epoch ms. */
  restoredAt?: number;
}

/** Where the watches live, so a restart finds them. */
export interface WatchFiles {
  load(): Array<[string, Watch]>;
  save(threadId: string, watch: Watch | null): void;
}

const THREAD_FILE = /^[\w.-]{1,200}\.json$/;

export function bookingWatchFiles(dataDir: string): WatchFiles {
  const dir = join(dataDir, "booking-watches");
  const path = (threadId: string) => join(dir, `${threadId}.json`);
  return {
    load() {
      if (!existsSync(dir)) return [];
      const out: Array<[string, Watch]> = [];
      for (const file of readdirSync(dir)) {
        if (!THREAD_FILE.test(file)) continue;
        try {
          const watch = JSON.parse(readFileSync(join(dir, file), "utf8")) as Watch;
          if (watch && typeof watch.messageId === "string" && watch.settled && typeof watch.calls === "object") out.push([file.slice(0, -5), watch]);
        } catch {
          // a torn file is a watch that never was: the card's own pending state is still in the transcript
        }
      }
      return out;
    },
    save(threadId, watch) {
      if (!/^[\w.-]{1,200}$/.test(threadId)) return;
      if (!watch) {
        rmSync(path(threadId), { force: true });
        return;
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileAtomic(path(threadId), JSON.stringify(watch), { mode: 0o600 });
    },
  };
}

/** How long a restarted watch waits for a resumed turn before it settles on what it knows. */
export const RESTART_GRACE_MS = 3 * 60_000;

/** Threads that hold a pressed time waiting on the calendar tool: every other thread's events cost nothing here. */
const armed = new Set<string>();
export const armBooking = (threadId: string): void => { armed.add(threadId); };

export function createBookingOutcome(store: Store, now: () => number = Date.now, files?: WatchFiles) {
  const watches = new Map<string, Watch>();
  const widgetOf = (threadId: string, id: string): WidgetPayload | undefined =>
    store.messagesFor(threadId).find((candidate) => candidate.id === id)?.widget;
  const pendingOf = (threadId: string): Message | undefined =>
    store.messagesFor(threadId).findLast((message) => message.kind === "widget" && message.widget?.booking?.state === "pending" && message.widget.settled);
  const keep = (threadId: string, watch: Watch) => { try { files?.save(threadId, watch); } catch { /* the watch still works in memory */ } };
  const drop = (threadId: string) => {
    watches.delete(threadId);
    armed.delete(threadId);
    try { files?.save(threadId, null); } catch { /* nothing left to forget */ }
  };

  /** The card as it stands for one outcome: booked keeps its answer, failed gives the card back. */
  function patch(threadId: string, watch: Watch, booking: WidgetBookingState): void {
    const current = widgetOf(threadId, watch.messageId);
    if (!current || current.booking?.state === "booked") return;
    const { settled: _settled, ...open } = current;
    store.patchMessage(threadId, watch.messageId, { widget: booking.state === "booked" ? { ...open, settled: watch.settled, booking } : { ...open, booking } });
  }

  /** The turn ended (or a restart was never followed by one) and nothing confirmed a booking. */
  function giveBack(threadId: string, watch: Watch): void {
    if (widgetOf(threadId, watch.messageId)?.booking?.state === "pending") {
      const wrote = watch.ran[0] ?? watch.lost[0];
      patch(threadId, watch, wrote
        ? { state: "failed", at: now(), code: "check_calendar", detail: wrote }
        : { state: "failed", at: now(), code: "not_booked" });
    }
    drop(threadId);
  }

  return {
    observe(event: RuntimeEvent): void {
      const { threadId } = event;
      // a turn's end is the one event read on every thread; the rest, only where armed
      if (!armed.has(threadId) && event.type !== "turn.completed") return;
      let watch = watches.get(threadId);
      const pending = pendingOf(threadId);
      if (pending?.widget?.settled && (!watch || watch.messageId !== pending.id)) {
        if (!watch && !armed.has(threadId) && event.type === "turn.completed") {
          // a pending card nothing is watching (one left by an older build): what happened to it is not known
          const lone: Watch = { messageId: pending.id, settled: pending.widget.settled, queued: false, calls: {}, ran: [], lost: [] };
          patch(threadId, lone, { state: "failed", at: now(), code: "unconfirmed" });
          return;
        }
        watch = { messageId: pending.id, settled: pending.widget.settled, queued: Boolean(pending.widget.settled.queueId), calls: {}, ran: [], lost: [] };
        watches.set(threadId, watch);
        keep(threadId, watch);
      }
      if (!watch) {
        armed.delete(threadId);
        return;
      }
      // a restarted watch: its turn is gone. The next turn that shows up in the thread is the one that resumed it.
      if (watch.restarted && !watch.adopted && event.turnId) {
        if (event.turnId === watch.turnId) return;
        watch.lost.push(...Object.values(watch.calls).map((call) => toolLabel(call.name)));
        watch.calls = {};
        watch.turnId = event.turnId;
        watch.adopted = true;
        keep(threadId, watch);
      }
      if (!watch.turnId && event.turnId && (event.type === "turn.started" || !watch.queued)) {
        watch.turnId = event.turnId;
        keep(threadId, watch);
      }
      if (event.turnId && watch.turnId && event.turnId !== watch.turnId) return;
      if (event.type === "item.started" && event.itemType === "tool" && event.itemId) {
        const kind = classifyTool(event.title);
        if (kind !== "other") {
          watch.calls[event.itemId] = { name: event.title ?? "", kind };
          keep(threadId, watch);
        }
      } else if (event.type === "item.completed" && event.itemType === "tool" && event.itemId && watch.calls[event.itemId]) {
        const call = watch.calls[event.itemId]!;
        delete watch.calls[event.itemId];
        if (call.kind === "write") {
          if (event.ok) watch.ran.push(toolLabel(call.name));
          keep(threadId, watch);
        } else if (event.ok) {
          patch(threadId, watch, { state: "booked", at: now() });
          drop(threadId);
        } else {
          // the card is selectable again at once; a retry that works in this same turn still books it
          const detail = failureDetail(event.output);
          patch(threadId, watch, { state: "failed", at: now(), code: "tool_failed", ...(detail ? { detail } : {}) });
          keep(threadId, watch);
        }
      } else if (event.type === "turn.completed" && watch.turnId && event.turnId === watch.turnId) {
        giveBack(threadId, watch);
      }
    },

    /** Read the watches back after a restart: the presses stay pending, and wait for a resumed turn. */
    restore(): number {
      let count = 0;
      for (const [threadId, saved] of files?.load() ?? []) {
        const card = widgetOf(threadId, saved.messageId);
        if (card?.booking?.state !== "pending" && card?.booking?.state !== "failed") {
          // the card was settled some other way: nothing to watch
          try { files?.save(threadId, null); } catch { /* gone */ }
          continue;
        }
        const watch: Watch = { ...saved, restarted: true, adopted: false, restoredAt: now() };
        watches.set(threadId, watch);
        armed.add(threadId);
        count += 1;
      }
      return count;
    },

    /** A restarted watch no resumed turn took over settles on what it knows once the grace has passed. */
    sweep(): void {
      for (const [threadId, watch] of watches) {
        if (watch.restarted && !watch.adopted && watch.restoredAt !== undefined && now() - watch.restoredAt >= RESTART_GRACE_MS) {
          watch.lost.push(...Object.values(watch.calls).map((call) => toolLabel(call.name)));
          watch.calls = {};
          giveBack(threadId, watch);
        }
      }
    },
  };
}
