// @ts-nocheck
/** retireProviderTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRetireProviderTurn(getHost: () => Host): any {
function retireProviderTurn(turnId: string) {
  const host = getHost();
  const { deleteAttachment } = host;

  host.retiredProviderTurns.retire(turnId);
  // A stopped/replaced turn is never folded again. Delete only staged files
  // (images, voice notes) that were parked for that exact provider turn so
  // unattached output does not accumulate invisibly on disk.
  for (const [key, attachments] of host.turnAttachmentsByTurn) {
    if (!key.endsWith(`:${turnId}`)) continue;
    host.turnAttachmentsByTurn.delete(key);
    for (const attachment of attachments) {
      deleteAttachment(attachment.path);
    }
  }

}
  return retireProviderTurn;
}
