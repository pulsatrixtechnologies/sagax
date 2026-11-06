// @ts-nocheck
/** finalScreenFrame (#1388). Pure move from server/index.ts. */
import { settledFrameIsNews } from "../computer/screen-frame-gate.ts";
export type Host = Record<string, any>;

export function createFinalScreenFrame(getHost: () => Host): any {
async function finalScreenFrame(_botId: string, threadId: string) {
  const host = getHost();
  const { screenFrameHash } = host;

  const entry = host.screenPollers.get(threadId);
  const owner = host.turnResourceOwners.get(threadId);
  if (!entry) return null;
  if (entry.timer) clearInterval(entry.timer);
  host.screenPollers.delete(threadId);
  if (!entry.touched) return null;
  await entry.capture(true);
  if (!owner || host.turnResourceOwners.get(threadId)?.generation !== owner.generation ||
      !host.store.taskByThread(_botId, threadId)) return null;
  const frame = entry.last;
  if (!frame || !settledFrameIsNews(host.shownScreenHash(threadId), frame.png)) return null;
  host.settledScreenHashes.set(threadId, screenFrameHash(frame.png));
  return frame;

}
  return finalScreenFrame;
}
