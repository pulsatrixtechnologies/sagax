// @ts-nocheck
/** confidentialThreadAttachments (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
import { existsSync } from "node:fs";
export type Host = Record<string, any>;

export function createConfidentialThreadAttachments(getHost: () => Host): any {
function confidentialThreadAttachments(botId: string, threadId: string) {
  const host = getHost();
  const { ATTACHMENTS_DIR, threadFileRefs } = host;
  const names = new Set<string>();
  const consider = (path: string | undefined) => {
    if (!path) return;
    // The store's own names only (an opaque id and an extension), as the bot
    // zip reads them: never a path outside it.
    const name = path.replaceAll("\\", "/").split("/").pop() ?? "";
    if (!/^[A-Za-z0-9-]+\.[a-z0-9]{1,8}$/.test(name) || !existsSync(join(ATTACHMENTS_DIR, name))) return;
    names.add(name);
  };
  const messages = host.store.messagesFor(threadId);
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) consider(attachment.path);
    // a link to a stored file written in the text (an image in Markdown)
    for (const match of (message.text ?? "").matchAll(/\/api\/attachments\/([A-Za-z0-9-]+\.[a-z0-9]{1,8})/g)) consider(match[1]);
  }
  for (const ref of threadFileRefs(messages, botId)) if (ref.source === "upload" || ref.source === "attachment") consider(ref.path);
  return [...names];

}
  return confidentialThreadAttachments;
}
