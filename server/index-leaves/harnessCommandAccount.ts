// @ts-nocheck
/** harnessCommandAccount (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createHarnessCommandAccount(getHost: () => Host): any {
function harnessCommandAccount(   bot: BotRecord,   instance: { instanceId: string; driverKind: string },   speaker: TurnSpeaker,   access?: TurnAccess, ) {
  const host = getHost();
  const { resolveEngineAccess } = host;

  let listing = commandListAccess(access);
  let via = access?.via;
  if (host.IDENTITY.kind === "perspicax" && !access) {
    const plan = resolveEngineAccess(host.orgEngineInput(bot, instance, speaker));
    if (plan.ok) {
      via = plan.via;
      const payer = plan.payerPrincipalId;
      if (plan.via === "subscription" && payer && (instance.driverKind === "claudeAgent" || instance.driverKind === "codex")) {
        const dir = host.principalLoginDir(payer, instance.driverKind);
        listing = { via: "subscription", identity: `subscription:${payer}`, ...(instance.driverKind === "claudeAgent" ? { claudeConfigDir: dir } : { codexHome: dir }) };
      }
    }
  }
  const connectors = host.claudeAiConnectorsFor(bot, instance, speaker, via);
  return { ...(listing ? { access: listing } : {}), ...(connectors ? { claudeAiConnectors: true } : {}) };

}
  return harnessCommandAccount;
}
