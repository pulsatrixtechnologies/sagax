// @ts-nocheck
/** resetMemberAutoLevelsOnce (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResetMemberAutoLevelsOnce(getHost: () => Host): any {
function resetMemberAutoLevelsOnce() {
  const host = getHost();
  const { cfg, saveConfig } = host;
  if (!memberAutoResetPending(host.IDENTITY.kind, host.cfg.organization)) return;
  const reset = memberAutoLevelResets(host.store.bots, (bot) => host.memberOwnedInOrg(bot as BotRecord));
  const ask = { approvalMode: "ask" as const, autoApprove: false };
  for (const thread of reset.threads) host.store.patchTask(thread.botId, thread.threadId, { ...ask, approvalOwn: "safety" });
  for (const botId of reset.bots) host.store.patchBot(botId, ask);
  const total = reset.bots.length + reset.threads.length;
  console.log(`organization: ${total} saved Auto or Auto-accept edits level(s) of members' bots set back to Ask (${reset.bots.length} bot default(s), ${reset.threads.length} thread(s)); automatic levels are off for members' bots`);
  const at = Date.now();
  try {
    saveConfig({ organization: { ...cfg.organization, memberAutoResetAt: at } });
    host.cfg.organization = { ...cfg.organization, memberAutoResetAt: at };
  } catch (error) {
    console.warn("organization: the members' automatic levels marker was not saved", error);
  }

}
  return resetMemberAutoLevelsOnce;
}
