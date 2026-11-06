// @ts-nocheck
/** threadsUsingAttachment (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createThreadsUsingAttachment(getHost: () => Host): any {
function threadsUsingAttachment(name: string) {
  const host = getHost();

  const cached = host.attachmentThreads.get(name);
  if (cached && Date.now() - cached.at < 60_000) return cached.threads;
  const threads = host.threadsReferencing(name);
  if (host.attachmentThreads.size >= 2_000) host.attachmentThreads.clear();
  host.attachmentThreads.set(name, { at: Date.now(), threads });
  return threads;

}
  return threadsUsingAttachment;
}
