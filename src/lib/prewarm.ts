// Pre-warm (server/thread-prewarm.ts): ask the server to start a bot
// conversation's engine when the person opens it or starts typing, so the
// first message does not pay the cold start. Best effort and silent: a
// failure changes nothing. One call per thread per REFRESH_MS; the server
// keeps the warm process for its own window (90 s) and closes it if nothing
// is sent.

const REFRESH_MS = 30_000;
const lastCall = new Map<string, number>();

type Api = (path: string, init?: RequestInit & { timeoutMs?: number }) => Promise<unknown>;

export function prewarmConversation(api: Api, botId: string | undefined, threadId: string | undefined, now = Date.now()): boolean {
  if (!botId || !threadId) return false;
  const key = `${botId}:${threadId}`;
  const last = lastCall.get(key);
  if (last !== undefined && now - last < REFRESH_MS) return false;
  lastCall.set(key, now);
  if (lastCall.size > 200) lastCall.clear();
  void api(`/api/bots/${encodeURIComponent(botId)}/warm`, {
    method: "POST",
    body: JSON.stringify({ threadId }),
    timeoutMs: 10_000,
  }).catch(() => {});
  return true;
}

/** Tests only. */
export function resetPrewarmForTests(): void {
  lastCall.clear();
}
