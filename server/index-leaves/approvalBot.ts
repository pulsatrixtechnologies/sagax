// @ts-nocheck
/** approvalBot (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createApprovalBot(getHost: () => Host): any {
function approvalBot(input: { threadId?: unknown; botId?: unknown }) {
  const host = getHost();

  if (typeof input.botId === "string") {
    const named = host.store.bot(input.botId);
    if (named) return named;
  }
  if (typeof input.threadId !== "string") return undefined;
  return host.botForApproval(input.threadId, {});

}
  return approvalBot;
}
