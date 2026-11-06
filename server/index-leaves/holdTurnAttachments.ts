// @ts-nocheck
/** holdTurnAttachments (#1388). Pure move from server/index.ts. */
import { join } from "node:path";

export type Host = Record<string, any>;

export function createHoldTurnAttachments(getHost: () => Host): any {
function holdTurnAttachments(threadId: string, texts: readonly (string | undefined)[], images: readonly TurnImageInput[], options: { picturesByPath?: boolean; videos?: readonly { path: string }[] } = {}) {
  const host = getHost();
  const { ATTACHMENTS_DIR, isArchiveAttachment } = host;
  const solo = host.IDENTITY.kind !== "perspicax";
  const open = async (): Promise<void> => {
    const holder = host.turnHolder(threadId);
    const now = new Set<string>();
    const wait = new Set<string>();
    for (const image of images) {
      now.add(image.path);
      if (options.picturesByPath) wait.add(image.path);
      try { now.add(host.modelImageCopyPath(ATTACHMENTS_DIR, image.path)); } catch { /* not in the attachments folder */ }
    }
    // ffmpeg samples frames from the plain file: wait for each video before the turn reads it.
    for (const video of options.videos ?? []) {
      now.add(video.path);
      wait.add(video.path);
    }
    if (solo) {
      for (const text of texts) for (const name of host.storedNamesIn(text)) {
        for (const path of host.storedFamily(name)) now.add(path);
        if (isArchiveAttachment(name)) wait.add(join(ATTACHMENTS_DIR, name));
      }
      for (const message of host.store.messagesFor(threadId)) {
        for (const name of host.storedNamesIn(message.text)) for (const path of host.storedFamily(name)) now.add(path);
      }
    }
    if (!now.size) return;
    const opening = host.holdPlain(holder, [...now]).catch(() => undefined);
    if (wait.size) await host.waitPlain([...wait]).catch(() => undefined);
    void opening.catch(host.reportBackgroundError);
  };
  // the turn waits only when something is read by path before the engine starts
  const mustWait = Boolean(options.picturesByPath && images.length) || Boolean(options.videos?.length)
    || (solo && texts.some((text) => host.storedNamesIn(text).some(isArchiveAttachment)));
  if (mustWait) return open();
  setImmediate(() => { void open().catch(() => undefined); });
  return undefined;

}
  return holdTurnAttachments;
}
