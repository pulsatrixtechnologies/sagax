// Live read positions for the open conversation, and this person's own
// report of what they saw (server/messages/read-receipts.ts).
//
// - useThreadReads: GET /api/threads/<id>/read once per thread, then the
//   live `thread.read` frames (store.tsx hands them here). A frame with
//   `reset` (someone changed their read receipt choice) fetches again.
// - useReportRead: while the window has focus and the page is visible, the
//   last message on screen is reported, debounced. A blurred or hidden
//   window reports nothing: a message is seen when it is actually shown.
import { useEffect, useRef, useState, type RefObject } from "react";

import { applyReadFrame, type ThreadReads } from "./read-receipts";
import type { ThreadReadPosition, ThreadReadsResponse } from "../../shared/wire";

type ReadFrame = { threadId: string; participantId?: string; read?: ThreadReadPosition; reset?: true };
const listeners = new Set<(frame: ReadFrame) => void>();

/** The server's live frame: { kind: "thread.read", threadId, participantId, read } or { reset }. */
export function receiveThreadReadFrame(frame: { threadId?: unknown; participantId?: unknown; read?: unknown; reset?: unknown }): void {
  if (typeof frame.threadId !== "string") return;
  const read = frame.read as ThreadReadPosition | undefined;
  const next: ReadFrame = frame.reset === true
    ? { threadId: frame.threadId, reset: true }
    : typeof frame.participantId === "string" && read && typeof read.messageId === "string" && typeof read.at === "number"
      ? { threadId: frame.threadId, participantId: frame.participantId, read }
      : { threadId: "" };
  if (!next.threadId) return;
  for (const listener of listeners) listener(next);
}

const EMPTY: { reads: ThreadReads; self: string | null } = { reads: {}, self: null };

// The last positions seen per thread, so reopening a conversation draws its
// "Seen by" rows on the first frame instead of adding them a fetch later
// (each one a row that pushed the whole transcript up as the room opened).
// The fetch still runs and replaces it. Bounded: the oldest thread goes.
const LAST_KNOWN_LIMIT = 64;
const lastKnown = new Map<string, { reads: ThreadReads; self: string | null }>();
function remember(threadId: string, value: { reads: ThreadReads; self: string | null }): void {
  lastKnown.delete(threadId);
  lastKnown.set(threadId, value);
  if (lastKnown.size > LAST_KNOWN_LIMIT) lastKnown.delete(lastKnown.keys().next().value!);
}
const known = (threadId: string | undefined) => (threadId ? lastKnown.get(threadId) : undefined) ?? EMPTY;

/** Tests only: forget every thread's last positions. */
export function resetThreadReadsCache(): void {
  lastKnown.clear();
}

export function useThreadReads(threadId: string | undefined): { reads: ThreadReads; self: string | null } {
  const [state, setState] = useState<{ threadId: string | undefined; reads: ThreadReads; self: string | null }>(() => ({ threadId, ...known(threadId) }));
  useEffect(() => {
    if (!threadId || typeof fetch !== "function") return;
    let alive = true;
    const load = () => {
      fetch(`/api/threads/${encodeURIComponent(threadId)}/read`, { credentials: "same-origin" })
        .then((response) => (response.ok ? (response.json() as Promise<ThreadReadsResponse>) : null))
        .then((body) => {
          if (!alive || !body || !body.reads || typeof body.reads !== "object") return;
          const loaded = { reads: body.reads, self: body.self ?? null };
          remember(threadId, loaded);
          setState({ threadId, ...loaded });
        })
        .catch(() => { /* offline or refused: no receipts drawn */ });
    };
    const listener = (frame: ReadFrame) => {
      if (frame.threadId !== threadId) return;
      if (frame.reset) return load();
      setState((current) => {
        if (current.threadId !== threadId) return current;
        const next = { ...current, reads: applyReadFrame(current.reads, frame.participantId!, frame.read!) };
        remember(threadId, { reads: next.reads, self: next.self });
        return next;
      });
    };
    setState((current) => (current.threadId === threadId ? current : { threadId, ...known(threadId) }));
    listeners.add(listener);
    load();
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, [threadId]);
  return state.threadId === threadId ? { reads: state.reads, self: state.self } : known(threadId);
}

const REPORT_DEBOUNCE_MS = 700;

/** The id of the last stored `[data-mid]` row the scroller shows, or null.
 * Rows are `display: contents` wrappers, so their drawn children are
 * measured. */
export function lastVisibleMessageId(scroller: HTMLElement): string | null {
  const view = scroller.getBoundingClientRect();
  const rows = scroller.querySelectorAll<HTMLElement>("[data-mid]");
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    // an instant bubble the server has not stored yet is no position
    if (row.getAttribute("data-mid")?.startsWith("optimistic-")) continue;
    const drawn = row.lastElementChild ?? row;
    const box = drawn.getBoundingClientRect();
    if (box.height === 0 && box.width === 0) continue;
    if (box.top < view.bottom && box.bottom > view.top) return row.getAttribute("data-mid");
  }
  return null;
}

function windowLooking(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

/** Report what this person sees in `threadId`, while they look at it. `tick`
 * changes when the transcript changes. */
export function useReportRead(threadId: string | undefined, scrollRef: RefObject<HTMLElement | null>, tick: unknown): void {
  const sent = useRef<{ threadId?: string; messageId?: string }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!threadId || typeof window === "undefined") return;
    const report = () => {
      timer.current = null;
      const scroller = scrollRef.current;
      if (!scroller || !windowLooking()) return;
      const messageId = lastVisibleMessageId(scroller);
      if (!messageId || (sent.current.threadId === threadId && sent.current.messageId === messageId)) return;
      sent.current = { threadId, messageId };
      fetch(`/api/threads/${encodeURIComponent(threadId)}/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ messageId }),
      }).catch(() => {
        sent.current = {};
      });
    };
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(report, REPORT_DEBOUNCE_MS);
    };
    schedule();
    const scroller = scrollRef.current;
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [threadId, scrollRef, tick]);
}
