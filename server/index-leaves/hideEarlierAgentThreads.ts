// @ts-nocheck
/** hideEarlierAgentThreads (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createHideEarlierAgentThreads(getHost: () => Host): any {
function hideEarlierAgentThreads() {
  const host = getHost();
  const { DATA_DIR, existsSync, writeFileSync } = host;

  if (host.IDENTITY.kind !== "perspicax") return;
  const marker = join(DATA_DIR, "agent-threads-hidden.v1");
  if (existsSync(marker)) return;
  try {
    const to = new Date();
    const rows = readAdminActivityRange(DATA_DIR, { from: new Date(to.getTime() - 120 * 24 * 60 * 60_000), to });
    const plan = host.planHiddenAgentThreads(rows, (botId, threadId) => host.store.taskByThread(botId, threadId) ?? undefined);
    for (const entry of plan) host.store.setTaskHidden(entry.botId, entry.threadId, true);
    writeFileSync(marker, `${new Date().toISOString()} ${plan.length}\n`, { mode: 0o600 });
    console.log(`[agent-threads] ${plan.length} AI client thread(s) hidden`);
  } catch (error) {
    console.warn(`[agent-threads] could not hide earlier AI client threads: ${error instanceof Error ? error.message : String(error)}`);
  }

}
  return hideEarlierAgentThreads;
}
