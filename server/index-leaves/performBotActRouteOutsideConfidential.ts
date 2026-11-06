// @ts-nocheck
/** performBotActRouteOutsideConfidential (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPerformBotActRouteOutsideConfidential(getHost: () => Host): any {
async function performBotActRouteOutsideConfidential(actor: PerformActor, target: RouteTarget, confirmed?: ActConfirmation, maxChars = 8000): Promise<{ status: number; text: string }> {
  const host = getHost();

  const ids = host.confidentialThreadIds();
  const mark: InternalRequestMark = { onBehalf: true, ...(confirmed ? { confirmed } : {}) };
  if (!ids.size) return host.performBotActRoute(actor, target, maxChars, mark);
  if (host.namesConfidentialThread(JSON.stringify([target.path, target.query ?? {}, target.body ?? null]), ids)) {
    return { status: 404, text: JSON.stringify({ error: "no such conversation" }) };
  }
  // read whole: a cut answer could not be cleaned
  const answer = await host.performBotActRoute(actor, target, 4_000_000, mark);
  if (!host.namesConfidentialThread(answer.text, ids)) return { status: answer.status, text: answer.text.slice(0, maxChars) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.text);
  } catch {
    return { status: 403, text: JSON.stringify({ error: "That answer names a confidential thread." }) };
  }
  const text = JSON.stringify(host.scrubConfidentialThreads(parsed, ids));
  if (host.namesConfidentialThread(text, ids)) return { status: 403, text: JSON.stringify({ error: "That answer names a confidential thread." }) };
  return { status: answer.status, text: text.slice(0, maxChars) };

}
  return performBotActRouteOutsideConfidential;
}
