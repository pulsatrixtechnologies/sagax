// @ts-nocheck
/** settleBotActCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleBotActCard(getHost: () => Host): any {
async function settleBotActCard(
  auth: RequestAuth,
  threadId: string,
  requestId: string,
  behavior: string,
  via?: "call",
  rule?: "allow",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const host = getHost();

  let settled: { status: number; body: Record<string, unknown> } | null = null;
  await host.answeringCardAs(auth, threadId, requestId, async () => {
    settled = await host.finishBotAct(threadId, requestId, behavior, auth, rule);
  }, via);
  return settled ?? { status: 409, body: { error: "The request is no longer open." } };

}
  return settleBotActCard;
}
