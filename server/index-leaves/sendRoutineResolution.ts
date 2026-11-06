// @ts-nocheck
/** sendRoutineResolution (#1388). Pure move from server/index.ts. */
import { RoutineRequestService } from "../routines/routine-requests.ts";
export type Host = Record<string, any>;

export function createSendRoutineResolution(getHost: () => Host): any {
function sendRoutineResolution(   res: ServerResponse,   result: ReturnType<RoutineRequestService["resolve"]>,   revealKey = false, ) {
  const host = getHost();
  const { json } = host;

  if (!result.claimed) return false;
  if (result.state === "invalid") {
    json(res, result.status, { error: result.error });
    return true;
  }
  if (result.state === "already_settled") {
    json(res, 200, {
      ok: true,
      outcome: result.behavior === "allow" ? "allowed-once" : result.behavior === "deny" ? "rejected" : "unavailable",
      alreadySettled: true
    });
    return true;
  }
  if (result.state === "denied") {
    json(res, 200, { ok: true, outcome: "rejected" });
    return true;
  }
  const webhookKey = revealKey && result.state === "applied" && result.ownerCopiesKey
    ? host.webhooks.revealForRoutine(result.resultId)?.secret
    : undefined;
  json(res, 200, {
    ok: true,
    outcome: "allowed-once",
    routineAction: result.action,
    resultId: result.resultId,
    ...(webhookKey ? { webhookKey } : {})
  });
  return true;

}
  return sendRoutineResolution;
}
