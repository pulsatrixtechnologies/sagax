// @ts-nocheck
/** bookTurnUsage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBookTurnUsage(getHost: () => Host): any {
function bookTurnUsage(row: Omit<UsageRow, "at" | "costSource">, tokensReported = true) {
  const host = getHost();
  const { DATA_DIR, appendUsage, buildSpendNotification, noteSpend, orgUsageFacts, spendAlertText, spendState, takeSpendAlert } = host;
  // Missing helper usage is unpriced, not an estimated zero-dollar call.
  const cost = tokensReported || row.costUsd !== null ? host.ledgerCost(row, host.operatorPrices()) : { costUsd: null };
  const booked = { ...row, ...orgUsageFacts(row), ...cost, at: new Date().toISOString() };
  // A model the engine gave no figure for is estimated like the row would be.
  if (row.models?.length) {
    booked.models = row.models.map((share) => {
      if (share.costUsd !== null) return share;
      const cached = share.cachedInputTokens ?? 0;
      const input = share.inputTokens + cached + (share.cacheWriteTokens ?? 0);
      return { ...share, costUsd: host.ledgerCost({ driverKind: row.driverKind, model: share.model, input, output: share.outputTokens, cachedInput: cached, costUsd: null }, host.operatorPrices()).costUsd };
    });
  }
  // The append lands asynchronously; the cap counts the row from memory
  // until it does, so the check below (and the next turn start) sees it.
  noteSpend(DATA_DIR, booked, appendUsage(DATA_DIR, booked));
  // #5014: the demand the account planner forecasts, and the spend the account meter scales by
  try { host.noteAccountDemand?.(booked); } catch (error) { host.reportBackgroundError?.(error); }
  // #2609: the turn's OpenTelemetry span and its per-model chat spans.
  try { host.agentSpans?.settleTurn(booked); } catch (error) { host.reportBackgroundError?.(error); }
  // #5147: a spend notice reaches the admins, who act on the limit, and names
  // no bot: the turn that crossed the line may be a member's (buildSpendNotification)
  const state = spendState(host.cfg, DATA_DIR);
  const alert = takeSpendAlert(DATA_DIR, state);
  if (alert && state) host.broadcast({ kind: "notify", notification: buildSpendNotification(spendAlertText(alert, state)) }, { adminOnly: true });
  const personal = host.personalCapNotice(DATA_DIR);
  if (personal) host.broadcast({ kind: "notify", notification: buildSpendNotification(personal) }, { adminOnly: true });

}
  return bookTurnUsage;
}
