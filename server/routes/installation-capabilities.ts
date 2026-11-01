// Lot 5: canonical installation capability store surface. Legacy
// /api/marketplaces and /api/skills-library stay as aliases with a
// Deprecation header until 2027-11-01.
import { installationCapabilityBridge } from "../installation-capability-bridge.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface InstallationCapabilityRouteDeps {
  /** Marketplace list the installation already exposes (no secrets). */
  marketplaces: (auth: RequestAuth) => unknown[];
  /** Skills library index summary (names only). */
  skillsLibrary: () => Array<{ name: string; enabled?: boolean }>;
  /** Whether this caller may see installation-wide capability config. */
  mayRead: (auth: RequestAuth) => boolean;
}

export function createInstallationCapabilityRoutes(deps: InstallationCapabilityRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    if (path !== "/api/installation/capabilities") return PASS;
    res.setHeader("cache-control", "private, no-store");
    if (method !== "GET") return json(res, 405, { error: "GET only" });
    if (!deps.mayRead(auth)) return json(res, 403, { error: "forbidden", code: "forbidden" });
    const bridge = installationCapabilityBridge();
    const migrated = bridge ? bridge.read().migrated : [];
    return json(res, 200, {
      store: "installation",
      migrated,
      marketplaces: deps.marketplaces(auth),
      skillsLibrary: deps.skillsLibrary(),
    });
  };
}
