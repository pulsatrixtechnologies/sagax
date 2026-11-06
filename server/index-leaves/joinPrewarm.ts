// @ts-nocheck
/** joinPrewarm (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createJoinPrewarm(getHost: () => Host): any {
async function joinPrewarm(threadId: string) {
  const host = getHost();

  if (!host.threadPrewarm.has(threadId)) return;
  let timer: NodeJS.Timeout | undefined;
  const ready = await Promise.race([
    host.threadPrewarm.join(threadId).then(() => true),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), host.PREWARM_JOIN_MS); }),
  ]);
  if (timer) clearTimeout(timer);
  if (ready) host.threadPrewarm.claim(threadId);
  else host.threadPrewarm.cancel(threadId);

}
  return joinPrewarm;
}
