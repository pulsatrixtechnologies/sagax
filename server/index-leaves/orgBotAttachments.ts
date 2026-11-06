// @ts-nocheck
/** orgBotAttachments (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgBotAttachments(getHost: () => Host): any {
async function orgBotAttachments(bot: BotRecord) {
  const host = getHost();
  const { listThreadFiles, statMessageFile, store, threadFileRefs } = host;
  // A confidential thread's uploads and outputs are never listed, and a file
  // it shares with an ordinary thread is left out too.
  const confidential = new Set(host.store.tasks(bot.id).filter((task) => task.confidential === true).map((task) => task.threadId));
  const threads = [...new Set([bot.threadId, ...store.tasks(bot.id).map((task) => task.threadId)])].filter((threadId) => !confidential.has(threadId));
  const confidentialFiles = new Set<string>();
  for (const threadId of confidential) {
    for (const ref of threadFileRefs(host.store.messagesFor(threadId), bot.id)) if (ref.source === "upload" || ref.source === "attachment") confidentialFiles.add(ref.path);
  }
  const out: BotAttachment[] = [];
  for (const threadId of threads) {
    const refs = host.threadFileRefsFor(threadId).filter((ref) => (ref.source === "upload" || ref.source === "attachment") && !confidentialFiles.has(ref.path));
    if (!refs.length) continue;
    const files = await listThreadFiles(refs, (ref) => statMessageFile(ref.path, host.threadFileRoots(threadId, ref))).catch(() => []);
    for (const file of files) {
      if (file.available && file.localPath) out.push({ id: file.id, name: file.name, at: file.at, localPath: file.localPath });
    }
  }
  return out;

}
  return orgBotAttachments;
}
