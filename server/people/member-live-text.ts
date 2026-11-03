// The words a bot is writing right now, per thread, for the member API's
// streamed turn (Perspicax master plan 2026-10-09, lot C.3): an AI client
// watching `sagax_send` sees the reply grow before the message lands.
//
// Fed by the runtime bus: an assistant text delta adds to the thread's
// buffer, a finished assistant item, a new turn or the end of the turn
// clears it (the finished words are in the thread by then). Reasoning text
// is never kept. Memory only; at most MEMBER_LIVE_TEXT_MAX characters per
// thread, the newest kept.
import type { RuntimeEvent } from "../../shared/runtime-events.ts";

/** The most of a thread's partial text kept. */
export const MEMBER_LIVE_TEXT_MAX = 4_000;
/** Threads tracked at once; the oldest are dropped first. */
export const MEMBER_LIVE_THREADS_MAX = 500;

export class MemberLiveText {
  private readonly buffers = new Map<string, string>();

  observe(event: RuntimeEvent): void {
    const threadId = event.threadId;
    if (!threadId) return;
    if (event.type === "content.delta") {
      if (event.streamKind !== "assistant_text" || !event.delta) return;
      const before = this.buffers.get(threadId) ?? "";
      const next = before + event.delta;
      // Re-insert so the map's order is the most recently written last.
      this.buffers.delete(threadId);
      this.buffers.set(threadId, next.length > MEMBER_LIVE_TEXT_MAX ? next.slice(-MEMBER_LIVE_TEXT_MAX) : next);
      while (this.buffers.size > MEMBER_LIVE_THREADS_MAX) {
        const oldest = this.buffers.keys().next().value;
        if (oldest === undefined) break;
        this.buffers.delete(oldest);
      }
      return;
    }
    if (
      event.type === "turn.started" ||
      event.type === "turn.completed" ||
      (event.type === "item.completed" && event.itemType === "assistant_text")
    ) {
      this.buffers.delete(threadId);
    }
  }

  /** The partial text of the thread's running reply, or null. */
  partial(threadId: string): string | null {
    const text = this.buffers.get(threadId);
    return text && text.trim() ? text : null;
  }

  clear(threadId: string): void {
    this.buffers.delete(threadId);
  }
}
