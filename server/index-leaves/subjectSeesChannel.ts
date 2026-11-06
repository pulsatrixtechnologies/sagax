// @ts-nocheck
/** subjectSeesChannel (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSubjectSeesChannel(getHost: () => Host): any {
function subjectSeesChannel(subject: PathSubject, viewerId: string) {
  const host = getHost();

  if (subject.kind === "group") {
    const group = host.store.group(subject.id);
    return !group || host.groupVisible(group, viewerId);
  }
  if (subject.kind === "thread") {
    const group = host.store.groupByThread(subject.id);
    if (group) return host.groupVisible(group, viewerId);
    // A bot's conversation by its thread id: the same rule as the bot
    // itself, so a direct URL never opens a Direct nobody shared (slice 3).
    const bot = host.store.botByThread(subject.id);
    return !bot || host.listedBotVisible(bot, viewerId);
  }
  if (subject.kind === "bot") {
    const bot = host.store.bot(subject.id);
    return !bot || host.listedBotVisible(bot, viewerId);
  }
  if (subject.kind === "routine") {
    const routine = host.routines?.listRoutines().find((candidate) => candidate.id === subject.id);
    return !routine || host.routineSeenBy(routine, viewerId);
  }
  if (subject.kind === "routine-run") {
    const run = host.routines?.listRuns().find((candidate) => candidate.id === subject.id);
    return !run || host.routineSeenBy(run, viewerId);
  }
  if (subject.kind === "attachment" && host.privateThreads()) return host.attachmentSeenBy(subject.name, viewerId);
  return true;

}
  return subjectSeesChannel;
}
