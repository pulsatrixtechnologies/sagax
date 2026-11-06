// @ts-nocheck
/** requestedBotFields (#1388). Pure move from server/index.ts. */
import { parsedBodyOf } from "../harness/http.ts";
export type Host = Record<string, any>;

export function createRequestedBotFields(getHost: () => Host): any {
function requestedBotFields(req: IncomingMessage, path: string): string[] {
  void getHost();
  if (path.endsWith("/always-allow")) return ["alwaysAllow"];
  if (path.endsWith("/model")) return ["modelSelection"];
  const body = parsedBodyOf(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const fields = new Set(Object.keys(body));
  if (fields.has("autoApprove") || fields.has("approvalMode")) fields.add("autoApprove").add("approvalMode");
  if (fields.has("chiefOfStaff")) fields.add("managedSections");
  return [...fields];
}
  return requestedBotFields;
}
