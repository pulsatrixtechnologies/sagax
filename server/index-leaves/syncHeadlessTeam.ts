// @ts-nocheck
/** syncHeadlessTeam (#1388). Pure move from server/index.ts. */
import { MAX_WORKSPACE_BOTS } from "../routes/bots-core-deps.ts";
export type Host = Record<string, any>;

export function createSyncHeadlessTeam(getHost: () => Host): any {
async function syncHeadlessTeam(bots: HeadlessBot[]) {
  const host = getHost();

  const missing = bots.filter((bot) => !host.headlessBotByName(bot.name));
  if (!missing.length) return;
  if (host.enginesRead) await host.enginesRead;
  for (const entry of missing) {
    if (host.headlessBotByName(entry.name)) continue;
    if (host.store.bots.length >= host.MAX_WORKSPACE_BOTS) throw new Error(`this workspace is limited to ${MAX_WORKSPACE_BOTS} bots`);
    const bot = host.store.createBot({ name: entry.name, ...(entry.title ? { title: entry.title } : {}), modelSelection: await host.defaultSelection() });
    const approvalMode = host.newBotApprovalMode();
    host.store.patchBot(bot.id, { approvalMode, autoApprove: approvalMode === "auto" });
    host.store.patchTask(bot.id, bot.threadId, { approvalMode, autoApprove: approvalMode === "auto" });
    console.log(`headless team: created bot ${bot.name}`);
  }

}
  return syncHeadlessTeam;
}
