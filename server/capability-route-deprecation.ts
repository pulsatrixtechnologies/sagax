// Capabilities lot 5: legacy fragmented capability routes stay as aliases
// for one year (until 2027-11-01) with a Deprecation response header. The
// canonical surfaces are the Capabilities APIs and the three stores.
import type { ServerResponse } from "node:http";

import { CAPABILITY_ROUTE_DEPRECATION } from "../shared/capability-stores.ts";

/** Successor path for a legacy capability route (documentation / Link). */
export const CAPABILITY_ROUTE_SUCCESSORS: Readonly<Record<string, string>> = {
  "/api/me/connections": "/api/me/capabilities",
  "/api/me/mcp/servers": "/api/me/capabilities",
  "/api/me/github": "/api/me/capabilities",
  "/api/skills-library": "/api/installation/capabilities",
  "/api/marketplaces": "/api/installation/capabilities",
  "/api/bots/:id/plugins": "/api/bots/:id/capabilities",
  "/api/me/plugins": "/api/me/capabilities",
};

/** Set Deprecation and Link headers on a legacy capability route response. */
export function setCapabilityDeprecationHeaders(res: ServerResponse, successor: string): void {
  if (res.getHeader(CAPABILITY_ROUTE_DEPRECATION.header)) return;
  res.setHeader(CAPABILITY_ROUTE_DEPRECATION.header, CAPABILITY_ROUTE_DEPRECATION.headerValue);
  res.setHeader(
    "Link",
    `<${successor}>; rel="${CAPABILITY_ROUTE_DEPRECATION.linkRel}"; title="Capabilities store API"`,
  );
  res.setHeader(
    "Warning",
    `299 sagax "Legacy capability route; use ${successor} before ${CAPABILITY_ROUTE_DEPRECATION.until}"`,
  );
}

/** True while the one-year alias window is open. */
export function capabilityRouteAliasActive(now = Date.now()): boolean {
  return now < Date.parse(`${CAPABILITY_ROUTE_DEPRECATION.until}T00:00:00Z`);
}
