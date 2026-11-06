// @ts-nocheck
/** routineSeenBy (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineSeenBy(getHost: () => Host): any {
function routineSeenBy(value: { botId?: unknown; groupId?: unknown; runAs?: unknown; sourceThreadId?: unknown }, viewerId: string) {
  const host = getHost();
  const { atLeast, botFacts, botLevel } = host;
  if (typeof value.groupId === "string" && value.groupId) {
    const group = host.store.group(value.groupId);
    if (group) return host.groupVisible(group, viewerId);
  }
  const runAs = typeof value.runAs === "string"
    ? value.runAs
    : value.runAs && typeof value.runAs === "object" ? (value.runAs as { principalId?: unknown }).principalId : undefined;
  if (typeof value.botId === "string" && value.botId) {
    const bot = host.store.bot(value.botId);
    if (bot) {
      if (!host.listedBotVisible(bot, viewerId)) return false;
      if (!host.privateThreads()) return true;
      // Private threads: a bot routine and its runs are the person it runs
      // as (else the bot owner), like the thread it writes; one that reports
      // into a group chat is that group's. The run level keeps its written
      // right to operate every routine that targets the bot (spec section 3,
      // slice 4), so a run holder still lists them; the threads stay private.
      const room = typeof value.sourceThreadId === "string" ? host.store.groupByThread(value.sourceThreadId) : null;
      if (room && host.groupVisible(room, viewerId)) return true;
      const person = typeof runAs === "string" && runAs.trim() ? runAs : host.effectiveBotOwner(bot);
      if (person.trim().toLowerCase() === viewerId.trim().toLowerCase()) return true;
      const viewer = host.authzViewerFromId(viewerId);
      return Boolean(viewer && atLeast(botLevel({ viewer, ...botFacts(bot) }), "run"));
    }
  }
  return typeof runAs === "string" && runAs.trim().toLowerCase() === viewerId.trim().toLowerCase();

}
  return routineSeenBy;
}
