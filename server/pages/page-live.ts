// Who is reading a published page right now, and its annotations as they
// change (2026-10-28, the reader's bar). One event stream per open reader's
// bar (GET /api/pages/:id/live, server/routes/published-pages.ts), for the
// people who may annotate the page only:
//   event: presence  { people: [{ id, name }] }  who has the page open
//   event: threads   {}                          the annotations changed: read them again
//   event: state     {}                          the page's shared state changed (#1544)
// The stream carries no comment: a bar reads the threads with its own rights
// (GET /api/pages/:id/threads). Nothing is stored; a stream that closes
// leaves at once. Comment lines every 25 s keep proxies from closing it.
import type { ServerResponse } from "node:http";

export interface LiveReader {
  id: string;
  name: string;
}

interface Listener extends LiveReader {
  res: Pick<ServerResponse, "write" | "end">;
}

export const LIVE_LIMITS = {
  /** Open streams on one page, and by one person on one page. */
  perPage: 100,
  perPerson: 6,
  heartbeatMs: 25_000,
} as const;

/** Who has the page open: each person once, in the order they came. Pure. */
export function presenceOf(listeners: Iterable<LiveReader>): LiveReader[] {
  const seen = new Map<string, LiveReader>();
  for (const entry of listeners) {
    const key = entry.id.toLowerCase();
    if (!seen.has(key)) seen.set(key, { id: entry.id, name: entry.name });
  }
  return [...seen.values()];
}

export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class PageLive {
  private readonly rooms = new Map<string, Set<Listener>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  /** A reader's bar opened; null when the page or the person has too many
   * streams. The returned function leaves. */
  join(pageId: string, reader: LiveReader, res: Listener["res"]): (() => void) | null {
    const room = this.rooms.get(pageId) ?? new Set<Listener>();
    const mine = [...room].filter((entry) => entry.id.toLowerCase() === reader.id.toLowerCase()).length;
    if (room.size >= LIVE_LIMITS.perPage || mine >= LIVE_LIMITS.perPerson) return null;
    const listener: Listener = { ...reader, res };
    room.add(listener);
    this.rooms.set(pageId, room);
    this.ensureHeartbeat();
    this.presence(pageId);
    let left = false;
    return () => {
      if (left) return;
      left = true;
      room.delete(listener);
      if (!room.size) this.rooms.delete(pageId);
      else this.presence(pageId);
      if (!this.rooms.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  /** The people who have this page open now. */
  people(pageId: string): LiveReader[] {
    return presenceOf(this.rooms.get(pageId) ?? []);
  }

  /** The page's annotations changed: every open bar reads them again. */
  changed(pageId: string): void {
    this.send(pageId, sseEvent("threads", {}));
  }

  /** The page's shared state changed: every open bar reads it again. */
  stateChanged(pageId: string): void {
    this.send(pageId, sseEvent("state", {}));
  }

  /** The page is gone or no longer readable: every stream closes. */
  close(pageId: string): void {
    for (const entry of this.rooms.get(pageId) ?? []) entry.res.end();
    this.rooms.delete(pageId);
  }

  private presence(pageId: string): void {
    this.send(pageId, sseEvent("presence", { people: this.people(pageId) }));
  }

  private send(pageId: string, frame: string): void {
    for (const entry of this.rooms.get(pageId) ?? []) {
      try {
        entry.res.write(frame);
      } catch { /* a closed stream leaves on its own close */ }
    }
  }

  private ensureHeartbeat(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const room of this.rooms.values()) for (const entry of room) {
        try {
          entry.res.write(": keep\n\n");
        } catch { /* closed */ }
      }
    }, LIVE_LIMITS.heartbeatMs);
    this.timer.unref?.();
  }
}
