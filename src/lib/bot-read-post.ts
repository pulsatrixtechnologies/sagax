// Reading the open thread from the live stream, once per change (#4187).
// A bot frame that shows the thread on screen unread posts its read. While
// a bot streams, frames come several a second and each one the server sent
// before it handled the read still shows the thread unread, so every frame
// posted the read again and each read made more frames. Now a thread has at
// most one read in flight. What lands meanwhile (an unread frame, a new
// line) is kept, not dropped: when the answer comes back, one more read goes
// out for it. A read the server answered with the thread still unread, or
// refused for good (403, 404), is not posted again until a new line lands in
// that thread: nothing changed, so a second read would not change anything.
// A read that failed (network, 5xx, a proxy 499) changed nothing on the
// server: the hold is released, so the next unread frame posts it again.

type ReadBot = { tasks?: ReadonlyArray<{ threadId: string; unread?: boolean }> };
type Post = (botId: string, threadId: string) => Promise<{ bot?: ReadBot } | undefined>;

export type BotReadPoster = {
  /** Post the read of `threadId` unless one is in flight or would change nothing. */
  read(botId: string, threadId: string): boolean;
  /** A new line in `threadId`: its next read may change something again. */
  noteLine(threadId: string): void;
};

/** The error a post throws for an HTTP answer that is not ok. */
export class BotReadError extends Error {
  constructor(readonly status: number) {
    super(`read ${status}`);
  }
}

// A refusal that the same read will get again until something changes.
const definitive = (error: unknown) => error instanceof BotReadError && (error.status === 403 || error.status === 404);

type Flight = { kind: "flight"; botId: string; unreadFrame: boolean; line: boolean };

export function createBotReadPoster(post: Post): BotReadPoster {
  // in flight (with what landed meanwhile), or answered without the thread turning read
  const held = new Map<string, Flight | { kind: "settled" }>();
  const send = (botId: string, threadId: string) => {
    const flight: Flight = { kind: "flight", botId, unreadFrame: false, line: false };
    held.set(threadId, flight);
    const done = (outcome: "read" | "unread" | "refused" | "failed") => {
      held.delete(threadId);
      // a new line, or an unread frame, landed while the read was out:
      // one more read covers it (one in flight still bounds the count)
      if (flight.line || (flight.unreadFrame && outcome !== "unread" && outcome !== "refused")) {
        send(flight.botId, threadId);
        return;
      }
      if (outcome === "unread" || outcome === "refused") held.set(threadId, { kind: "settled" });
    };
    post(botId, threadId).then(
      (answer) => done(answer?.bot?.tasks?.find((task) => task.threadId === threadId)?.unread === true ? "unread" : "read"),
      (error: unknown) => done(definitive(error) ? "refused" : "failed"),
    );
  };
  return {
    read(botId, threadId) {
      const hold = held.get(threadId);
      if (hold?.kind === "flight") {
        hold.unreadFrame = true;
        hold.botId = botId;
        return false;
      }
      if (hold) return false;
      send(botId, threadId);
      return true;
    },
    noteLine(threadId) {
      const hold = held.get(threadId);
      if (hold?.kind === "flight") hold.line = true;
      else if (hold) held.delete(threadId);
    },
  };
}

/** The desktop's own poster: POST /api/bots/:id/read. */
export const botReadPoster = createBotReadPoster(async (botId, threadId) => {
  const response = await fetch(`/api/bots/${botId}/read`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId }) });
  if (!response.ok) throw new BotReadError(response.status);
  return await response.json() as { bot?: ReadBot };
});
