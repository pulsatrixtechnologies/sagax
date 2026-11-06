// @ts-nocheck
/** runDispatchKpiSource (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRunDispatchKpiSource(getHost: () => Host): any {
async function runDispatchKpiSource(artifact: Artifact, args: Record<string, unknown>) {
  const host = getHost();
  const { isPrincipalId } = host;

  const live = host.store.bot(artifact.botId);
  if (!live) return { ok: false, blocked: true, error: "The bot that saved this artifact is gone." };
  const principalId = artifact.ownerPrincipalId ?? host.effectiveBotOwner(live);
  const personZone = isPrincipalId(principalId) ? host.botSettings.person(principalId).timeZone : null;
  const parsed = host.parseDispatchKpiArgs(args, personZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const force = host.dispatchKpiForced.delete(artifact.id);
  const result = await host.dispatchKpi.snapshot({ botId: live.id, principalId, args: parsed.value, force });
  return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };

}
  return runDispatchKpiSource;
}
