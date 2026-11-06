// @ts-nocheck
/** resolveImessageCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResolveImessageCard(getHost: () => Host): any {
async function resolveImessageCard(res: ServerResponse, threadId: string, requestId: string, behavior: string) {
  const host = getHost();
  const { DATA_DIR, TASK_WORKSPACES_DIR, json, workspaceDir } = host;
  if (!requestId.startsWith("imsg-")) return false;
  const message = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId);
  const card = message?.card;
  if (!message || !card) {
    json(res, 409, { error: "The request is no longer open." });
    return true;
  }
  if (card.answered || card.dismissed || card.expired) {
    json(res, 409, { error: "The request is no longer open." });
    return true;
  }
  const pending = host.takeImessageSend(requestId, threadId);
  if (behavior !== "allow" || !pending) {
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "deny", subtitle: pending ? card.subtitle : "This send expired. Nothing was sent." } });
    json(res, 200, { ok: true, outcome: "rejected" });
    return true;
  }
  const hostnameHostLocal = host.messagesOnBotMac({ platform: process.platform, identityKind: host.IDENTITY.kind, bridgeAction: false });
  if (!hostnameHostLocal.ok || !host.readMessagesSettings(DATA_DIR).useMessages) {
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "deny", subtitle: "Messages is not available on this Mac. Nothing was sent." } });
    json(res, 409, { error: "Messages is not available on this Mac.", code: "messages_not_on_this_mac" });
    return true;
  }
  let file = pending.file;
  if (file) {
    const inside = host.fileInsideRoots([workspaceDir(pending.botId), join(TASK_WORKSPACES_DIR, pending.botId, pending.threadId)], file);
    if (!inside) {
      host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "deny", subtitle: "That file is not in this bot's folder. Nothing was sent." } });
      json(res, 409, { error: "That file is not in this bot's folder.", code: "messages_file_outside" });
      return true;
    }
    file = inside;
  }
  try {
    await host.imessageSender.send({ to: pending.to, text: pending.text, service: pending.service, ...(file ? { file } : {}) });
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "allow", subtitle: `Sent to ${pending.to}.` } });
    json(res, 200, { ok: true, outcome: "allowed-once" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Messages did not send.";
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "allow", subtitle: detail } });
    json(res, 200, { ok: true, outcome: "allowed-once", send: "failed" });
  }
  return true;

}
  return resolveImessageCard;
}
