// @ts-nocheck
/** resolveReplyTarget (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResolveReplyTarget(getHost: () => Host): any {
function resolveReplyTarget(threadId: string, value: unknown) {
  const host = getHost();

  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw Object.assign(new Error("replyToId must be a message id"), { status: 400 });
  const target = host.store.messagesFor(threadId).find((message) => message.id === value);
  if (!target || (target.kind !== "text" && target.kind !== "widget") || !target.text?.trim()) {
    throw Object.assign(new Error("the message being replied to is no longer available"), { status: 404 });
  }
  return target;

}
  return resolveReplyTarget;
}
