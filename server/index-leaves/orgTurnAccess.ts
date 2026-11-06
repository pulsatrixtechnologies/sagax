// @ts-nocheck
/** orgTurnAccess (#1388). Pure move from server/index.ts. */
import { materializeEngineAccess } from "../engines/engine-credentials.ts";
export type Host = Record<string, any>;

export function createOrgTurnAccess(getHost: () => Host): any {
async function orgTurnAccess(threadId: string, bot: BotRecord, instance: { instanceId: string; driverKind: string }, speaker: TurnSpeaker, model: string | null | undefined) {
  const host = getHost();
  const { DATA_DIR, resolveEngineAccess } = host;
  if (host.IDENTITY.kind !== "perspicax") return undefined;
  // #1422: a local pi model (the model this turn runs, never the bot's own
  // when they differ) has no key to fetch; it still runs in a pi home of its
  // person's own, never the server's shared one (piLocalTurnAccess).
  // #2024: so does a Perspicax model server's, whose key comes with it.
  if (host.piLocalModel({ instanceId: instance.instanceId, model })) return host.withPiModelServers(host.piLocalTurnAccess(bot, speaker), instance, bot, speaker);
  const input = host.orgEngineInput(bot, instance, speaker);
  const outcome = await materializeEngineAccess(input, resolveEngineAccess(input), {
    dataDir: DATA_DIR,
    resolveKey: (sub, provider) => {
      const person = host.principals.list().find((entry) => entry.subject?.sub === sub && entry.subject.iss === (host.IDENTITY.kind === "perspicax" ? host.IDENTITY.issuer : ""));
      const owner = host.providerAccountOwner(person?.id);
      return owner ? host.providerAccounts.resolve(owner, provider) : Promise.resolve({ ok: false as const, error: "link" as const });
    },
    invalidate: (sub, provider) => host.perspicaxDirectory?.invalidate(sub, provider),
    // the turn's own sign-in on this engine (a second Grok account runs in its own folder)
    loginDir: (principalId, driver) => host.principalLoginDir(principalId, driver, host.turnSlotFor(bot, instance))
  });
  if (!outcome.ok) throw new host.EngineAccessLost(outcome.plan ? host.orgRefusalOf(outcome.plan, speaker) : { reason: outcome.reason }, outcome.detail);
  const { plan } = outcome;
  const provider = plan.provider;
  const payerSub = plan.payerPrincipalId ? (plan.payer === "owner" ? input.owner.sub : input.person?.(plan.payerPrincipalId)?.sub) : undefined;
  host.turnAccessByThread.set(threadId, {
    via: outcome.access.via,
    payer: plan.payer,
    ...(plan.payerPrincipalId ? { payerPrincipalId: plan.payerPrincipalId } : {}),
    ...(plan.routine ? { routine: true as const } : {}),
    ...(payerSub ? { payerSub } : {}),
    ...(provider ? { provider } : {})
  });
  return host.withPiModelServers(outcome.access, instance, bot, speaker);

}
  return orgTurnAccess;
}
