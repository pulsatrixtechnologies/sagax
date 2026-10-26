// My Chrome settings and the Stop switch (server/browser/my-chrome/).
//
//   POST /api/my-chrome/status                       what is allowed, and which bot drives which tab
//   POST /api/my-chrome/enable   { enabled }         off by default
//   POST /api/my-chrome/sites    { site }            allow one site (origin)
//   POST /api/my-chrome/sites/revoke { site }        take it back, at once
//   POST /api/my-chrome/address  { address }         where Chrome listens, when not found by itself
//   POST /api/my-chrome/stop                         end every bot's driving now
//   POST /api/my-chrome/resume
//
// POST only, reads included: on the desktop a loopback change needs the app's
// own capability, so a bot's shell on the same machine reaches none of it.
// The person (or an admin on an organization server); never a bot's tool
// (server/tool-policy.generated.ts keeps /api/my-chrome admin and off).
import type { MyChromeService, MyChromeStatus } from "../browser/my-chrome/service.ts";
import { MyChromeSettingsError } from "../browser/my-chrome/settings.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface MyChromeRouteDeps {
  service(): MyChromeService;
  /** The person, or an admin. */
  allowed(auth: RequestAuth): boolean;
  /** The bot an engine session belongs to, for the status. */
  botFor(session: string): { id: string; name: string } | null;
  /** Ids of the bots with a shell on this computer: they never get My Chrome. */
  botsWithShell(): string[];
}

export type MyChromeStatusBody = Omit<MyChromeStatus, "gate"> & {
  connected: boolean;
  lastActionAt: number;
  /** Bots with a terminal on this computer: they keep their own browser. */
  shellBotIds: string[];
  driving: Array<{ botId: string; botName: string; tabs: Array<{ url: string; title: string }> }>;
};

export function myChromeStatusBody(status: MyChromeStatus, botFor: MyChromeRouteDeps["botFor"], shellBotIds: string[] = []): MyChromeStatusBody {
  const { gate, ...rest } = status;
  return {
    ...rest,
    connected: gate.connected,
    lastActionAt: gate.lastActionAt,
    shellBotIds,
    driving: gate.clients.map((client) => {
      const bot = botFor(client.label);
      return { botId: bot?.id ?? "", botName: bot?.name ?? "", tabs: client.tabs };
    }),
  };
}

const PREFIX = "/api/my-chrome/";

export function createMyChromeRoutes(deps: MyChromeRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/my-chrome/")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.allowed(auth)) return json(res, 403, { error: "Only the person at this computer (or an admin) can change My Chrome." });
    const service = deps.service();
    const action = path.slice(PREFIX.length);
    let body: Record<string, unknown> = {};
    try {
      const raw = await readBody(req, 4_096);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) body = raw as Record<string, unknown>;
    } catch {
      return json(res, 400, { error: "Invalid request." });
    }
    try {
      let status: MyChromeStatus;
      switch (action) {
        case "status": status = service.status(); break;
        case "enable":
          if (typeof body.enabled !== "boolean") return json(res, 400, { error: "enabled must be true or false" });
          status = await service.setEnabled(body.enabled);
          break;
        case "sites": status = service.allowSite(body.site); break;
        case "sites/revoke": status = service.revokeSite(body.site); break;
        case "address": status = service.setChromeAddress(body.address); break;
        case "stop": status = await service.stop(); break;
        case "resume": status = service.resume(); break;
        default: return json(res, 404, { error: "unknown My Chrome action" });
      }
      return json(res, 200, myChromeStatusBody(status, deps.botFor, deps.botsWithShell()));
    } catch (error) {
      if (error instanceof MyChromeSettingsError) return json(res, 400, { error: error.message });
      return json(res, 409, { error: error instanceof Error ? error.message : "My Chrome could not do that." });
    }
  };
}
