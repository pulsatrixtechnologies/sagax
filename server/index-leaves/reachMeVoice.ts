// @ts-nocheck
/** reachMeVoice (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReachMeVoice(getHost: () => Host): any {
async function reachMeVoice(person: string, botId: string, tool: "voice_line" | "voice_sms", args: Record<string, unknown>): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const host = getHost();
  const { store } = host;

  if (host.IDENTITY.kind !== "perspicax" || !host.perspicaxMcp) return { ok: false, error: "Perspicax is not linked on this server" };
  const candidates = [host.store.bot(botId), ...store.bots.filter((bot) => bot.chiefOfStaff && host.effectiveBotOwner(bot) === person)]
    .filter((bot): bot is BotRecord => Boolean(bot) && host.effectiveBotOwner(bot!) === person);
  let last = "no bot belongs to this person";
  for (const bot of candidates.slice(0, 3)) {
    const threadId = `reach-me-${randomBytes(6).toString("hex")}`;
    const generation = "1";
    try {
      const plan = await host.perspicaxMcp.prepareTurn({
        threadId, generation, bot: { id: bot.id },
        speakerPrincipalId: person, speakerOrigin: "owner-routine", routine: true,
        ownerPrincipalId: host.effectiveBotOwner(bot),
      });
      if (!plan.mounted.length) { last = plan.unavailable[0]?.reason ?? "not mounted"; continue; }
      const answer = await host.perspicaxMcp.callTool({ threadId, generation, botId: bot.id, name: tool, args });
      if (answer.ok && !answer.isError) return { ok: true, value: answer.value };
      last = answer.ok ? (typeof answer.value === "string" ? answer.value : "refused") : answer.error;
    } finally {
      await host.perspicaxMcp.endGeneration(threadId, generation).catch(host.reportBackgroundError);
    }
  }
  return { ok: false, error: last.slice(0, 200) };

}
  return reachMeVoice;
}
