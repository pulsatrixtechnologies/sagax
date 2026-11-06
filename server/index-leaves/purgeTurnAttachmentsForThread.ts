// @ts-nocheck
/** purgeTurnAttachmentsForThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPurgeTurnAttachmentsForThread(getHost: () => Host): any {
function purgeTurnAttachmentsForThread(threadId: string) {
  const host = getHost();
  const { deleteAttachment } = host;

  for (const [key, attachments] of host.turnAttachmentsByTurn) {
    if (!key.startsWith(`${threadId}:`)) continue;
    host.turnAttachmentsByTurn.delete(key);
    for (const attachment of attachments) {
      deleteAttachment(attachment.path);
    }
  }

}
  return purgeTurnAttachmentsForThread;
}
