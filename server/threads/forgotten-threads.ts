// Threads whose per-thread logs (events/<thread>.ndjson, native/<thread>.ndjson)
// must not be written again: a deleted confidential thread
// (docs/confidential-threads.md). Its engine process may still announce its
// exit after the thread is gone (a warm process closed at the deletion), and
// that line would otherwise recreate the log the deletion removed.
const forgotten = new Set<string>();
const LIMIT = 10_000;

export function forgetThreadLogs(threadId: string): void {
  if (forgotten.size >= LIMIT) forgotten.delete(forgotten.values().next().value!);
  forgotten.add(threadId);
}

export function threadLogsForgotten(threadId: string): boolean {
  return forgotten.has(threadId);
}
