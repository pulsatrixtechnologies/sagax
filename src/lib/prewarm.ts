// Pre-warm (server/threads/thread-prewarm.ts): ask the server to start a bot
// conversation's engine when the person opens it or starts typing, so the
// first message does not pay the cold start. Best effort and silent: a
// failure changes nothing. One call per thread per REFRESH_MS; the server
// keeps the warm process for its own window (90 s) and closes it if nothing
// is sent.

const REFRESH_MS = 30_000;
const lastCall = new Map<string, number>();

type Api = (path: string, init?: RequestInit & { timeoutMs?: number }) => Promise<unknown>;

/** `typing`: the person is writing a message (not only looking): the server
 * may also wake the bot's cloud computer so the first command does not wait
 * for it (2026-10-26). Opening a conversation never wakes a computer. */
export function prewarmConversation(api: Api, botId: string | undefined, threadId: string | undefined, now = Date.now(), typing = false): boolean {
  if (!botId || !threadId) return false;
  // Typing has its own refresh: an open just before must not swallow it.
  const key = `${botId}:${threadId}${typing ? ":typing" : ""}`;
  const last = lastCall.get(key);
  if (last !== undefined && now - last < REFRESH_MS) return false;
  lastCall.set(key, now);
  if (lastCall.size > 200) lastCall.clear();
  void api(`/api/bots/${encodeURIComponent(botId)}/warm`, {
    method: "POST",
    body: JSON.stringify(typing ? { threadId, typing: true } : { threadId }),
    timeoutMs: 10_000,
  }).catch(() => {});
  return true;
}

/** Tests only. */
export function resetPrewarmForTests(): void {
  lastCall.clear();
}
