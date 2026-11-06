// @ts-nocheck
/** captureTurnFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCaptureTurnFor(getHost: () => Host): any {
function captureTurnFor(threadId: string, turnId: string) {
  const host = getHost();

  const path = host.store.activePath(threadId);
  const replyAt = path.findLastIndex((message) => message.role === "bot" && message.kind === "text" && message.turnId === turnId);
  if (replyAt < 0) return null;
  const asked = path.slice(0, replyAt).findLast((message) => message.role === "user" && message.kind === "text");
  if (!asked || asked.peerAsk) return null;
  return {
    person: host.extractTurnImages(asked.text ?? "").text,
    bot: path[replyAt]!.text ?? "",
    owner: !asked.sender,
    turnId
  };

}
  return captureTurnFor;
}
