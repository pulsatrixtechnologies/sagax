// @ts-nocheck
/** memberFrameContext (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMemberFrameContext(getHost: () => Host): any {
function memberFrameContext(visible: VisibleSet, viewer: ApprovalViewer) {
  const host = getHost();

  return {
    visible,
    webhookBot: (webhookId) => host.webhooks.list().find((webhook) => webhook.id === webhookId)?.botId,
    freshBot: (botId) => {
      const bot = host.store.bot(botId);
      return bot ? host.publicBot(bot, viewer) : undefined;
    },
    freshGroup: (groupId) => {
      const group = host.store.group(groupId);
      return group ? host.groupWithThread(group, viewer) : undefined;
    }
  };

}
  return memberFrameContext;
}
