// @ts-nocheck
/** botForViewer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBotForViewer(getHost: () => Host): any {
function botForViewer<T extends Record<string, unknown>>(bot: T, viewerId: string | undefined): T{
  const host = getHost();
  const { store, wireTask } = host;

  if (!viewerId || !host.privateThreads() || typeof bot.id !== "string") return bot;
  const record = host.store.bot(bot.id);
  if (!record) return bot;
  const mine = host.viewerThreadOf(record, viewerId);
  const mineTask = mine ? host.store.taskByThread(record.id, mine) : undefined;
  const narrowedBase = host.narrowBotForViewer(bot, {
    viewerId,
    botOwnerPrincipalId: host.effectiveBotOwner(record),
    activity: host.viewerBotActivity(record, viewerId),
    ...(mine ? { mine } : {}),
    ...(mineTask ? { mineTask: { ...wireTask(mineTask, record.modelSelection), ...store.projectBotForTask(record.id, mine!) } as unknown as Record<string, unknown> } : {}),
    ...(mineTask ? { mineWireTask: host.wireTask(mineTask, record.modelSelection) as unknown as Record<string, unknown> } : {})
  });
  // Only the bot-to-bot conversations this viewer may read, on both bots.
  const viewerFacts = host.authzViewerFromId(viewerId);
  const conversations = host.interBotConversations(record.id, host.store.bots, (owner, task, other) => {
    const ownerRecord = host.store.bot(owner.id);
    // an outside agent's conversation: its person's, like any thread of theirs
    if (host.isAgentConversation(task)) return Boolean(ownerRecord) && host.botThreadReadable(ownerRecord!, task.threadId, viewerId) && host.canOnBot(viewerFacts, "bot.use", host.botFacts(ownerRecord!));
    const otherRecord = other ? host.store.bot(other.id) : undefined;
    return Boolean(ownerRecord && otherRecord)
      && host.botThreadReadable(ownerRecord!, task.threadId, viewerId)
      && host.canOnBot(viewerFacts, "bot.use", host.botFacts(ownerRecord!))
      && host.canOnBot(viewerFacts, "bot.use", host.botFacts(otherRecord!));
  }, (ownerId, threadId) => host.threadBusy(ownerId, threadId), host.threadHasMessages);
  const narrowed: T = { ...narrowedBase };
  // the level the viewer's own conversation runs at, never another person's
  if (typeof narrowed.threadId === "string" && narrowed.threadId !== bot.threadId) {
    const level = narrowed.threadId ? host.approvalLevelOf(record.id, narrowed.threadId) : null;
    if (level?.applied) (narrowed as Record<string, unknown>).approvalApplied = level.applied;
    else delete (narrowed as Record<string, unknown>).approvalApplied;
  }
  if (conversations.length) (narrowed as Record<string, unknown>).botConversations = conversations;
  else delete (narrowed as Record<string, unknown>).botConversations;
  // #4493: what the bot waits on (the card's thread, message and words) and
  // the teammates it waits for, read over this viewer's own threads only.
  // Worked out over every thread of the bot, it handed another person the
  // id and the plain sentence of a card waiting in someone's confidential
  // (or simply private) thread.
  // (a wire bot only: wireBot always writes waitingForTeammates)
  if ("waitingForTeammates" in narrowed) {
    const shownIds = new Set<string>(Array.isArray(narrowed.tasks)
      ? (narrowed.tasks as Array<{ threadId?: unknown }>).map((task) => String(task.threadId ?? "")) : []);
    const viewerThreadId = typeof narrowed.threadId === "string" ? narrowed.threadId : "";
    if (viewerThreadId) shownIds.add(viewerThreadId);
    const viewerTasks = (record.tasks ?? []).filter((task) => shownIds.has(task.threadId));
    const viewerRecord = { ...record, threadId: viewerThreadId };
    const waitingOn = host.botWaitingOn(viewerRecord, narrowed.activity, viewerTasks);
    if (waitingOn) (narrowed as Record<string, unknown>).waitingOn = waitingOn;
    else delete (narrowed as Record<string, unknown>).waitingOn;
    const coordinated = host.threadsWithActiveCoordination();
    const selectedWaits = Boolean(viewerThreadId) && coordinated.has(viewerThreadId) && !host.threadBusy(record.id, viewerThreadId);
    (narrowed as Record<string, unknown>).waitingForTeammates = selectedWaits;
    const teammates = host.botWaitingOnTeammates(viewerRecord, selectedWaits, viewerTasks, coordinated);
    if (teammates.length) (narrowed as Record<string, unknown>).waitingOnTeammates = teammates;
    else delete (narrowed as Record<string, unknown>).waitingOnTeammates;
  }
  // Only the bot-to-bot cards this viewer answers (approvalOwnerId).
  if (!("waitingApprovals" in narrowed)) return narrowed;
  const viewerKey = viewerId.trim().toLowerCase();
  // and only in conversations they may read (the card is answered from there)
  const waiting = host.interBotWaiting(record.id, record.tasks, (task) =>
    host.approvalOwnerId(record, task.threadId).trim().toLowerCase() === viewerKey && host.botThreadReadable(record, task.threadId, viewerId));
  const out: Record<string, unknown> = { ...narrowed };
  if (waiting.length) out.waitingApprovals = waiting;
  else delete out.waitingApprovals;
  return out as T;

}
  return botForViewer;
}
