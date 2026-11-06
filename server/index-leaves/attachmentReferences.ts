// @ts-nocheck
/** attachmentReferences (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAttachmentReferences(getHost: () => Host): any {
function attachmentReferences(file: string): { person?: string; at: number }[] {
  const host = getHost();

  const out: { person?: string; at: number }[] = [];
  for (const threadId of host.threadsUsingAttachment(file)) {
    for (const message of host.store.messagesFor(threadId)) {
      if (!message.text?.includes(file)) continue;
      const person = message.role === "user" ? host.linePersonKey(message) : undefined;
      out.push({ person: person?.trim().toLowerCase(), at: message.at });
    }
  }
  return out;

}
  return attachmentReferences;
}
