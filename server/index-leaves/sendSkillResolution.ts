// @ts-nocheck
/** sendSkillResolution (#1388). Pure move from server/index.ts. */
import { json } from "../harness/http.ts";
export type Host = Record<string, any>;

export function createSendSkillResolution(getHost: () => Host): any {
function sendSkillResolution(   res: ServerResponse,   result: ReturnType<typeof resolveSkillRequest>, ) {
  void getHost();

  if (!result.claimed) return false;
  if ("error" in result) {
    json(res, result.status, { error: result.error });
    return true;
  }
  json(res, 200, { ok: true, outcome: result.outcome, alreadySettled: result.alreadySettled });
  return true;

}
  return sendSkillResolution;
}
