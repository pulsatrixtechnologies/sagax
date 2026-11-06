// @ts-nocheck
/** terminalWorkPlace (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTerminalWorkPlace(getHost: () => Host): any {
function terminalWorkPlace(botId: string, threadId: string, principalId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot) return null;
  const plan = host.turnSurfacePlan(bot, undefined, threadId).computer;
  const fixed = (computer: typeof plan): TerminalWorkPlace => computer === "cloud" ? "sandbox" : computer === "vm" ? "local-vm" : computer === "local" ? "desktop" : null;
  if (host.IDENTITY.kind !== "perspicax") return fixed(plan) ?? "local-vm";
  const live = host.turnWorkplaces.get(threadId);
  if (live?.botId === botId) {
    const selected = live.auto?.auto ? live.auto.selected : null;
    if (selected === "cloud") return "sandbox";
    if (selected === "local_vm") return "local-vm";
    if (selected === "this_computer") return "desktop";
    if (live.decision.target === "user-sandbox") return "sandbox";
    if (live.decision.target === "user-desktop") return plan === "vm" ? "local-vm" : "desktop";
  }
  return fixed(plan) ?? (host.workplacePreference(principalId).place === "computer" && host.desktopBridges.connected(principalId) ? "desktop" : "sandbox");

}
  return terminalWorkPlace;
}
