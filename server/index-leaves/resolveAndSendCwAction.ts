// @ts-nocheck
/** resolveAndSendCwAction (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResolveAndSendCwAction(getHost: () => Host): any {
async function resolveAndSendCwAction(   res: ServerResponse,   auth: RequestAuth,   threadId: string,   requestId: string,   behavior: string, ) {
  const host = getHost();
  const { json } = host;

  const message = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId && row.card.cwActionRequest);
  const card = message?.card;
  if (!message || !card?.cwActionRequest) return false;
  if (card.answered || card.dismissed || card.expired) {
    json(res, 409, { error: "The request is no longer open." });
    return true;
  }
  const action = host.parseCwAction(card.cwActionRequest.action);
  const actor = host.cwActionActor(auth);
  if (behavior !== "allow" || !action || !actor) {
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "deny" } });
    json(res, 200, { ok: true, outcome: "rejected" });
    return true;
  }
  const botId = message.from?.botId ?? host.store.botByThread(threadId)?.id;
  const bot = botId ? host.store.bot(botId) : undefined;
  if (!bot) {
    json(res, 409, { error: "This bot is no longer here." });
    return true;
  }
  const done = await host.allowCwAction(actor, threadId, message.id, card, bot, action, host.languageOfRequest(auth));
  json(res, done.status, done.body);
  return true;

}
  return resolveAndSendCwAction;
}
