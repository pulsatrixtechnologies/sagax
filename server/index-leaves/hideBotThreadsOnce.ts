// @ts-nocheck
/** hideBotThreadsOnce (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
export type Host = Record<string, any>;

export function createHideBotThreadsOnce(getHost: () => Host): any {
function hideBotThreadsOnce() {
  const host = getHost();
  const { DATA_DIR } = host;

  const marker = join(DATA_DIR, "agent-threads-hidden.v2");
  if (existsSync(marker)) return;
  try {
    const listFile = join(DATA_DIR, "agent-threads-hide.list");
    const listed = existsSync(listFile) ? host.parseHideList(readFileSync(listFile, "utf8")) : [];
    const plan = host.planHiddenBotThreads(host.store.bots.map((bot) => ({ id: bot.id, threadId: bot.threadId, tasks: host.store.tasks(bot.id) })), listed);
    for (const entry of plan) host.store.setTaskHidden(entry.botId, entry.threadId, true);
    writeFileSync(marker, `${new Date().toISOString()} ${plan.length}\n`, { mode: 0o600 });
    console.log(`[agent-threads] ${plan.length} bot-to-bot / listed thread(s) hidden`);
  } catch (error) {
    console.warn(`[agent-threads] could not hide bot-to-bot threads: ${error instanceof Error ? error.message : String(error)}`);
  }

}
  return hideBotThreadsOnce;
}
