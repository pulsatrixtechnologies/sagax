// Post-gate health, the bots' browser-engine install, edition and brand.
//
//   GET  /api/health                    readiness + engines (after the auth gate)
//   POST /api/browser-engine/install    install agent-browser + Chrome for Testing
//   GET  /api/edition                   which edition this server runs
//   GET  /api/brand                     deployment brand (read per request)
//
// Leaf helpers are imported; index.ts locals (probes, install state, config
// broadcast) arrive through deps.
import { HEALTH_IDENTITY } from "../../electron/legacy-names.mjs";
import { loadBrand } from "../brand.ts";
import {
  browserEngineStatus,
  ensureChrome,
  installAgentBrowserBinary,
  resolveAgentBrowserBinary,
} from "../browser-engine.ts";
import { editionForMembers, editionStatus } from "../enterprise.ts";
import { healthzUnreadyBody } from "../healthz.ts";
import { healthDetail } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** One cached CLI probe, as GET /api/health lists it. */
export interface HealthEngineProbe {
  instanceId: string;
  driver: string;
  installed: boolean;
  version?: string;
  at: number;
  pinned?: boolean;
}

export interface BrowserEngineRouteDeps {
  isShuttingDown: () => boolean;
  isOrganization: () => boolean;
  sharedWorkspaceFullAccessEnabled: () => boolean;
  engineProbes: () => ReadonlyMap<string, HealthEngineProbe>;
  registryEntries: () => ReadonlyArray<{ instanceId: string }>;
  probeEngines: () => Promise<void>;
  settledWithin: (promise: Promise<unknown>, ms: number) => Promise<void>;
  engineNotAvailableReason: (instanceId: string) => string | undefined;
  ENGINE_PROBE_TTL_MS: number;
  ENGINE_PROBE_TIMEOUT_MS: number;
  /** Truthy when a static UI directory is configured. */
  staticDir: () => string | null | undefined;
  /** True while an install promise is in flight. */
  isInstalling: () => boolean;
  /**
   * Clear the prior error, mark installing, run `work`, record its error
   * (if any), clear installing and broadcast on settle. The route broadcasts
   * once more right after this returns so listeners see `installing: true`.
   */
  startInstall: (work: () => Promise<void>) => void;
  broadcastConfig: () => void;
  log?: (line: string) => void;
}

const OWN = new Set(["/api/health", "/api/browser-engine/install", "/api/edition", "/api/brand"]);

export function createBrowserEngineRoutes(deps: BrowserEngineRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json }) => {
    if (!OWN.has(path)) return PASS;

    if (method === "GET" && path === "/api/health") {
      // Unready during graceful shutdown so Caddy health checks and k8s
      // readiness stop routing while in-flight work drains.
      if (deps.isShuttingDown()) return json(res, 503, healthzUnreadyBody());
      // What this caller may learn (request-auth.ts healthDetail): a
      // session-less bot shell on an organization server learns the app name
      // only, as a stranger does.
      const detail = healthDetail(auth, { organization: deps.isOrganization() });
      const capabilities = {
        guardedMessages: 1, guardedRequests: 1, guardedFullAccess: 1, guardedOnBehalfOf: 1,
        ...(deps.sharedWorkspaceFullAccessEnabled() ? { sharedWorkspaceFullAccess: 1 } : {}),
        // Slice 7: /api/org/admin/* answers the Perspicax console.
        ...(deps.isOrganization() ? { orgAdminApi: 1, orgAdminFiles: 1 } : {}),
      };
      if (detail === "app") return json(res, 200, { ...HEALTH_IDENTITY });
      if (detail === "capabilities") return json(res, 200, { ...HEALTH_IDENTITY, capabilities });
      // The engines installed on this server (slice 3, D16), from the CLI
      // probes: refreshed here when stale, within a bounded wait.
      const probes = deps.engineProbes();
      const stale = !probes.size || [...probes.values()].some((probe) => !probe.pinned && Date.now() - probe.at > deps.ENGINE_PROBE_TTL_MS)
        || deps.registryEntries().some((entry) => !probes.has(entry.instanceId));
      // Solo servers (the desktop's boot probe polls this route) never wait
      // and never probe from here: they list what an earlier probe found.
      if (stale && deps.isOrganization()) await deps.settledWithin(deps.probeEngines(), deps.ENGINE_PROBE_TIMEOUT_MS + 1_000);
      const engines = [...deps.engineProbes().values()]
        .map(({ instanceId, driver, installed, version }) => {
          const notAvailable = installed ? undefined : deps.engineNotAvailableReason(instanceId);
          return { instanceId, driver, installed, ...(version ? { version } : {}), ...(notAvailable ? { notAvailable } : {}) };
        })
        .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
      // app: "openmausbot" stays one release beside product: "sagax" (deployed
      // health checks grep the body for it; legacy-names.mjs HEALTH_IDENTITY).
      return json(res, 200, { ...HEALTH_IDENTITY, pid: process.pid, static: Boolean(deps.staticDir()), capabilities, engines });
    }

    // The bots' browser engine: install it on this machine (agent-browser +
    // a Chrome for Testing, a one-time download), or ask how that is going.
    // One install at a time; the config frame's browserEngine tells the rest.
    // JSON only, so a form posted from another local page cannot start it.
    if (method === "POST" && path === "/api/browser-engine/install") {
      const mediaType = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
      if (mediaType !== "application/json") {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      if (!deps.isInstalling()) {
        const status = browserEngineStatus();
        if (status.kind === "unavailable" && !status.installable) return json(res, 409, { error: status.reason });
        const log = deps.log ?? ((line: string) => console.log(line));
        deps.startInstall(async () => {
          const binary = resolveAgentBrowserBinary() ?? await installAgentBrowserBinary({ log });
          await ensureChrome(binary, { log });
        });
        deps.broadcastConfig();
      }
      return json(res, 202, { installing: true });
    }

    // Which edition this server runs and why (see server/enterprise.ts). Read-only.
    if (method === "GET" && path === "/api/edition") {
      // A member learns what is entitled; when the key lapses is for admins.
      const status = editionStatus();
      return json(res, 200, auth.scopes.includes("admin") ? status : editionForMembers(status));
    }
    // The brand for this deployment (server/brand.ts): read per request so edits show on reload.
    if (method === "GET" && path === "/api/brand") {
      return json(res, 200, loadBrand());
    }

    return PASS;
  };
}
