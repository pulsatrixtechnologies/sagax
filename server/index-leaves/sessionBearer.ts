// @ts-nocheck
/** sessionBearer (#1388). Pure move from server/index.ts. */
import { randomBytes } from "node:crypto";
export type Host = Record<string, any>;

export function createSessionBearer(getHost: () => Host): any {
function sessionBearer(capability: Omit<InternalCapability, "orphanExpiresAt">) {
  const host = getHost();
  
  const credentials = host.sessionCredentials.get(capability.threadId) ?? new Map<string, { grants: string; token: string }>();
  host.sessionCredentials.set(capability.threadId, credentials);
  const slot = `${capability.botId} ${capability.kind}`;
  const grants = host.sessionGrants(capability);
  const held = credentials.get(slot);
  if (held?.grants === grants) return held.token;
  const token = randomBytes(24).toString("hex");
  credentials.set(slot, { grants, token });
  return token;

}
  return sessionBearer;
}
