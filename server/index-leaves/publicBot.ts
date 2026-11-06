// @ts-nocheck
/** publicBot (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPublicBot(getHost: () => Host): any {
function publicBot(bot: NonNullable<ReturnType<typeof host.store.bot>>, viewer?: ApprovalViewer) {
  const host = getHost();
  const { DEFAULT_PAGE, wireBot } = host;
  const coordinated = host.threadsWithActiveCoordination();
  return {
    ...wireBot(bot),
    ...(viewer ? host.messagePage(bot.threadId, DEFAULT_PAGE, null, viewer) : host.transcriptPage(bot.threadId, DEFAULT_PAGE)),
    tasks: host.listedTasks(bot.threadId, host.store.tasks(bot.id)).map((task) => host.wireTask(task, bot.modelSelection, coordinated))
  };

}
  return publicBot;
}
