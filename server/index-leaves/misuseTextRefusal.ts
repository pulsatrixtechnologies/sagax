// @ts-nocheck
/** misuseTextRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMisuseTextRefusal(getHost: () => Host): any {
function misuseTextRefusal(   text: string,   principalId: string | undefined | null,   surface: "message" | "shell" | "file" | "terminal" | "mcp" | "flow",   extra?: { botId?: string; threadId?: string; tool?: string; origin?: string }, ) {
  const host = getHost();
  const { misuseRefusal } = host;

  const actor = host.misuseActor(principalId, extra?.origin);
  return misuseRefusal(text, { ...actor, surface, botId: extra?.botId, threadId: extra?.threadId, tool: extra?.tool })?.message ?? null;

}
  return misuseTextRefusal;
}
