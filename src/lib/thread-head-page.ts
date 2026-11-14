// The newest page of a thread that waits on the person, read once per change
// of that thread (#4187). The inline questions of a parallel card and the
// approvals that join the open conversation both read the same page each
// time the task changes (keyed on the task's updatedAt): two requests for one
// change, re-run on every task update while a bot streams. They share one
// request now: same thread and same version, same answer. A task's waiting
// cards read through the same helper with their own version stamps, so they
// share only between their own callers.
import { api, type Message } from "@/state/store";

export const THREAD_HEAD_LIMIT = 60;

type Page = { messages?: Message[] };

/** Recent thread versions kept, newest last; an older one is read again. */
const KEPT = 64;
const pages = new Map<string, Promise<Page>>();

/** The newest `THREAD_HEAD_LIMIT` messages of `threadId` as of `version`
 * (the task's `updatedAt`, a poll tick): one request per thread and version,
 * shared by every caller; a failed read is asked again next time. */
export function threadHeadPage(threadId: string, version: string | number): Promise<Page> {
  const key = `${threadId}@${String(version)}`;
  const held = pages.get(key);
  if (held) return held;
  const page = api<Page>(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=${THREAD_HEAD_LIMIT}`);
  pages.set(key, page);
  page.catch(() => { if (pages.get(key) === page) pages.delete(key); });
  while (pages.size > KEPT) pages.delete(pages.keys().next().value!);
  return page;
}

/** Tests: forget every page. */
export function resetThreadHeadPages(): void {
  pages.clear();
}
