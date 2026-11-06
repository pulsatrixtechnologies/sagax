// @ts-nocheck
/** personalMcpNamesForGuard (#1388). Pure move from server/index.ts. */
import { collectPersonalMcpNames } from "../mcp/mcp-personal-shared-guard.ts";
export type Host = Record<string, any>;

export function createPersonalMcpNamesForGuard(getHost: () => Host): any {
function personalMcpNamesForGuard() {
  const host = getHost();

  const ids = new Set(host.principals.list().map((person) => person.id));
  try {
    const local = host.localPrincipalId();
    if (local) ids.add(local);
  } catch { /* solo without a local principal yet */ }
  return collectPersonalMcpNames([...ids], (id) => host.personConnections.servers(id));

}
  return personalMcpNamesForGuard;
}
