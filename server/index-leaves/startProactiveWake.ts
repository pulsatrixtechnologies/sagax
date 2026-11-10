// @ts-nocheck
/** startProactiveWake (#1388). Pure move from server/index.ts. */
import { peerWakeDigest, proactiveWakePrompt, wakeAlwaysReports } from "../proactive/proactive-wake.ts";
export type Host = Record<string, any>;

export function createStartProactiveWake(getHost: () => Host): any {
function startProactiveWake(batch: ProactiveWakeBatch, accepted = false, runAs?: string) {
  const host = getHost();
  // A person's yes that cannot start says so (answerProactiveProposal).
  if (!host.routines) {
    if (accepted) throw new Error("Routines are not ready yet");
    return;
  }
  const bot = host.store.bot(batch.botId);
  if (!bot) return;
  // Person isolation: explicit runAs when known (e.g. failed run's person),
  // else the bot owner. Never an arbitrary member's credentials.
  const person = runAs || host.effectiveBotOwner(bot) || undefined;
  const sources = [...new Set(batch.events.map((event) => event.source))];
  const peerDigest = peerWakeDigest(batch.events, batch.more);
  const alwaysReport = wakeAlwaysReports(batch.events);
  // #3423: the chosen watches it reports, so the row's "never" stops them
  const watches = batch.events.flatMap((event) => event.source === "watch" && event.watch?.domain ? [{ id: event.watch.id, domain: event.watch.domain }] : []);
  host.routines.enqueueProactive({
    botId: batch.botId,
    name: `Proactive: ${sources.map((source) => host.PROACTIVE_RUN_NAMES[source]).join(", ")}`,
    prompt: proactiveWakePrompt(batch, { accepted, screen: host.screenContextBlock?.(batch.botId) || undefined }),
    proactive: {
      mode: batch.mode,
      hops: batch.hops,
      sources,
      ...(batch.confined ? { confined: true as const } : {}),
      ...(accepted ? { accepted: true as const } : {}),
      ...(peerDigest ? { peerDigest } : {}),
      ...(alwaysReport ? { alwaysReport: true as const } : {}),
      ...(watches.length ? { watches } : {})
    },
    ...(person ? { runAs: person } : {})
  });

}
  return startProactiveWake;
}
