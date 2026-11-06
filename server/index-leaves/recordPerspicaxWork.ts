// @ts-nocheck
/** recordPerspicaxWork (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRecordPerspicaxWork(getHost: () => Host): any {
function recordPerspicaxWork(bot: BotRecord, threadId: string, speaker: TurnSpeaker, principalId: string, profiles: readonly string[]) {
  const host = getHost();

  const person = host.perspicaxSubOf(principalId);
  if (!person || !host.perspicaxMemory) return;
  // The organization's work log is shared: a confidential thread leaves no row.
  if (host.store.isConfidentialThread(threadId)) return;
  const routine = host.routineLineage(speaker);
  const origin = host.IDENTITY.kind === "perspicax" ? host.IDENTITY.publicOrigin.replace(/\/+$/, "") : "";
  host.perspicaxMemory.recordWork({
    person,
    actor_kind: routine || speaker.origin === "peer" ? "bot" : "person",
    intent: `${routine ? "Routine run" : "Turn"} on ${bot.name} with ${profiles.join(", ")}`,
    action: routine ? "run" : "turn",
    objects: [`sagax:bot:${bot.id}`, `sagax:thread:${threadId}`],
    // the turn just started: in progress
    result: "partial",
    ...(origin ? { link: `${origin}/#thread=${encodeURIComponent(threadId)}&bot=${encodeURIComponent(bot.id)}` } : {})
  });

}
  return recordPerspicaxWork;
}
