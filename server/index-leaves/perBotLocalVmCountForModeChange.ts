// @ts-nocheck
/** perBotLocalVmCountForModeChange (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPerBotLocalVmCountForModeChange(getHost: () => Host): any {
async function perBotLocalVmCountForModeChange() {
  const host = getHost();
  const { containerRuntimeStatus, existsSync, perBotLocalVmTarget } = host;
  const targets = [...new Map(host.store.bots.map((bot) => {
    const target = perBotLocalVmTarget(bot.id);
    return [target.key, target] as const;
  })).values()];
  if (targets.length === 0) return 0;
  const runtime = await containerRuntimeStatus();
  if (!runtime.runtime || !runtime.daemonUp) {
    return targets.some((target) => existsSync(target.workspaceDir)) ? null : 0;
  }
  return host.existingPerBotLocalVmCount(runtime.runtime);

}
  return perBotLocalVmCountForModeChange;
}
