// @ts-nocheck
/** perspicaxReadAlone (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPerspicaxReadAlone(getHost: () => Host): any {
async function perspicaxReadAlone(input: { botId: string; principalId: string; threadId: string; tool: string; args: Record<string, unknown>; clientName: string }): Promise<ToolAnswer | { error: string }> {
  const host = getHost();

  const answer = await host.perspicaxSessionAlone(input, (call) => call(input.tool, input.args));
  return answer;

}
  return perspicaxReadAlone;
}
