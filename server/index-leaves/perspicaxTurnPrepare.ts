// @ts-nocheck
/** perspicaxTurnPrepare (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPerspicaxTurnPrepare(getHost: () => Host): any {
async function perspicaxTurnPrepare(input: {
  bot: BotRecord;
  threadId: string;
  generation: string;
  speaker: TurnSpeaker;
  quiet?: boolean;
}): Promise<{
  live: BotRecord;
  speakerPrincipalId: string;
  routine: boolean;
  plan: { mounted: Array<{ name: "Perspicax" }>; unavailable: Array<{ name: string; reason: PerspicaxUnavailableReason; detail?: string }> };
} | null> {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax" || !host.perspicaxMcp) return null;
  const live = host.store.bot(input.bot.id) ?? input.bot;
  const routine = host.routineLineage(input.speaker);
  // The origin decides whose account connection this is. `operator` and an
  // owner routine already resolve to the owner; an unknown person or peer
  // stays unknown and must never borrow the owner's connection.
  const ownerPrincipalId = host.effectiveBotOwner(live) ?? "";
  const speakerPrincipalId = host.orgSpeakerPrincipal(live, input.speaker).trim();
  const plan = await host.perspicaxMcp.prepareTurn({
    threadId: input.threadId,
    generation: input.generation,
    bot: { id: live.id },
    speakerPrincipalId,
    speakerOrigin: input.speaker.origin,
    ownerPrincipalId,
    ...(routine ? { routine: true } : {})
  });
  // Handshake beside setup: open/verify the MCP session now, so the engine's
  // later tools/list hits the same-session cache. Roles are never auto-picked.
  if (plan.mounted.length) await host.perspicaxMcp.ensureTurnSessions(input.threadId, input.generation);
  if (plan.mounted.length) void host.perspicaxMcp?.refreshApiNames({ threadId: input.threadId, generation: input.generation, botId: live.id }).catch(host.reportBackgroundError);
  return { live, speakerPrincipalId, routine, plan };

}
  return perspicaxTurnPrepare;
}
