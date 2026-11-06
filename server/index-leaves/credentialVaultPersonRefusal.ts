// @ts-nocheck
/** credentialVaultPersonRefusal (#1388). Pure move from server/index.ts. */
import { isBotActSession } from "../auth/sessions.ts";
export type Host = Record<string, any>;

export function createCredentialVaultPersonRefusal(getHost: () => Host): any {
function credentialVaultPersonRefusal(auth: RequestAuth): { status: number; body: unknown } | null {
  void getHost();

  const refusal = { status: 403, body: { error: "Only the person can move their vault in or out.", code: "not_person" } };
  if (auth.kind === "loopback") return auth.trust === "service" ? refusal : null;
  if (auth.session.ephemeral || isBotActSession(auth.session)) return refusal;
  const principalId = auth.session.principalId?.trim();
  if (!principalId || principalId.startsWith("anon:")) return refusal;
  return null;

}
  return credentialVaultPersonRefusal;
}
