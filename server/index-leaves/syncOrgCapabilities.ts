// @ts-nocheck
/** syncOrgCapabilities (#1388). Pure move from server/index.ts. */
import { createHash } from "node:crypto";
export type Host = Record<string, any>;

export function createSyncOrgCapabilities(getHost: () => Host): any {
function syncOrgCapabilities(reason: string) {
  const host = getHost();
  const { configStatus } = host;
  const announce = () => {
    const next = createHash("sha256").update(JSON.stringify(host.orgCapabilities.views())).digest("hex").slice(0, 16);
    if (next === host.orgCapabilitiesRevision) return;
    host.orgCapabilitiesRevision = next;
    host.broadcast({ kind: "config", ...configStatus() });
  };
  // the declarations are visible at once; the installs follow
  announce();
  return host.orgCapabilities.sync(reason).then(announce, () => undefined);

}
  return syncOrgCapabilities;
}
