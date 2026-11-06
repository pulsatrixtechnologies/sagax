// @ts-nocheck
/** autoComputerStateFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAutoComputerStateFor(getHost: () => Host): any {
function autoComputerStateFor(decision: WorkplaceDecision, worksOn: { auto: boolean; fixed?: FixedWorksOn }, routine: boolean, start: AutoStart | null, browserAvailable: boolean) {
  const host = getHost();

  if (host.IDENTITY.kind !== "perspicax" || !decision.principal) return null;
  if (decision.reason === "no-person" || decision.reason === "unknown") return null;
  const routinesAllowed = host.workplacePreference(decision.principal).routines;
  const desktopMounted = worksOn.auto && host.desktopBridges.connected(decision.principal) && (!routine || routinesAllowed);
  // The start follows the decision: a computer place only when the turn
  // really landed on the person's computer.
  const onDesktop = decision.target === "user-desktop";
  const selected: AutoComputerTarget | null = !worksOn.auto ? null
    : start?.target && (start.target === "this_computer" || start.target === "local_vm") === onDesktop ? start.target
    : decision.target === "user-sandbox" ? "cloud" : null;
  return {
    auto: worksOn.auto,
    ...(worksOn.fixed ? { fixed: worksOn.fixed } : {}),
    selected,
    routine,
    sandboxConfigured: Boolean(host.userSandbox),
    desktopMounted,
    routinesAllowed,
    browserAvailable
  };

}
  return autoComputerStateFor;
}
