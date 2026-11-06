// @ts-nocheck
/** openTurnMessage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOpenTurnMessage(getHost: () => Host): any {
function openTurnMessage(message: Message): OpenTurnMessage {
  const host = getHost();
  return {
    id: message.id,
    text: message.text,
    status: message.status,
    card: message.card ? { answered: message.card.answered } : undefined
  };
}
  return openTurnMessage;
}
