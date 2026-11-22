// A person's confirmation that this conversation may move onto a paid API
// key (#5180). Memory only, ten minutes: the next resolution of that
// conversation reads it. Nothing here is a credential.

const TTL_MS = 10 * 60_000;
const THREAD = /^[A-Za-z0-9_-]{1,80}$/;
const until = new Map<string, number>();

export function confirmPaidKey(threadId: string, now = Date.now()): boolean {
  if (!THREAD.test(threadId)) return false;
  until.set(threadId, now + TTL_MS);
  return true;
}

export function paidKeyIsConfirmed(threadId: string | undefined, now = Date.now()): boolean {
  if (!threadId) return false;
  const at = until.get(threadId);
  if (at === undefined || at <= now) {
    until.delete(threadId);
    return false;
  }
  return true;
}

/** Tests reset the process-wide set. */
export function clearPaidKeyConfirmations(): void {
  until.clear();
}
