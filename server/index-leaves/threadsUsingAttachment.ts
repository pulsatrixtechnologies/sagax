// @ts-nocheck
/** threadsUsingAttachment (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

function remember(host: Host, name: string, threads: string[]) {
  // "no thread yet" is never kept: the message that uses the file may be
  // sent the next second, and a stale "none" would decide who reads it
  if (!threads.length) {
    host.attachmentThreads.delete(name);
    return threads;
  }
  if (host.attachmentThreads.size >= 2_000) host.attachmentThreads.clear();
  host.attachmentThreads.set(name, { at: Date.now(), threads });
  return threads;
}

export function createThreadsUsingAttachment(getHost: () => Host): any {
function threadsUsingAttachment(name: string) {
  const host = getHost();

  const cached = host.attachmentThreads.get(name);
  if (cached && Date.now() - cached.at < 60_000) return cached.threads;
  return remember(host, name, host.threadsReferencing(name));
}

/** #5343: fill the cache from the search worker so authenticate does not
 * run instr() over messages.db on the server's thread. */
async function primeThreadsUsingAttachment(name: string) {
  const host = getHost();
  const cached = host.attachmentThreads.get(name);
  if (cached && Date.now() - cached.at < 60_000) return cached.threads;
  const found = await host.threadsReferencingAsync([name]);
  return remember(host, name, found.get(name) ?? []);
}

  threadsUsingAttachment.prime = primeThreadsUsingAttachment;
  return threadsUsingAttachment;
}
