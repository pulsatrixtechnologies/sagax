// @ts-nocheck
/** botSkillsRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBotSkillsRefusal(getHost: () => Host): any {
function botSkillsRefusal(auth: RequestAuth, botId: string, change: boolean): { status: number; body: Record<string, unknown> } | null {
  const host = getHost();

  const target = host.store.bot(botId);
  if (!target) return { status: 404, body: { error: "no such bot" } };
  if (host.IDENTITY.kind !== "perspicax") return null;
  const level = host.viewerBotLevel(auth, target);
  if (level === null && !host.orgAdminCaller(auth)) return { status: 404, body: { error: "no such bot" } };
  if (change && level !== "owner" && level !== "manage" && !host.orgAdminCaller(auth)) return { status: 403, body: { error: "Only the bot's owner, or someone who manages it, can change its skills.", code: "skills_owner_only" } };
  return null;

}
  return botSkillsRefusal;
}
