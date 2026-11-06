// The Apple apps of the solo Mac (Plugins > This Mac), one switch each.
//
//   GET  /api/mac-apps                    status of every app
//   PUT  /api/mac-apps                    { app, enabled }
//   POST /api/mac-apps/test               { app } : names and a count, never content
//   POST /api/mac-apps/permissions/open   { pane: "automation" | "fullDiskAccess" }
//   POST /api/mac-apps/permissions/ask    { app } : the macOS Automation prompt
//
// Outside the solo Mac this answers 404 mac_apps_not_on_this_mac: with an
// organization server the desktop app answers the same over IPC.
import { messagesOnBotMac, type MessagesHost } from "../../shared/imessage.ts";
import { MESSAGES_PRIVACY_PANES } from "../../shared/mac-messages-setup.ts";
import { macAppsStatusLive, requestMacAppAutomation, testMacApp, writeMacAppSettings, MAC_APP_IDS, type MacAppId } from "../../electron/mac-apps.mjs";
import { readMessagesSettings, writeMessagesSettings } from "../imessage/imessage-settings.ts";
import { probeFullDiskAccess } from "../imessage/imessage-permissions.ts";
import { PASS, type RouteHandler } from "./table.ts";

export type MacAppsRoutesDeps = {
  dataDir: string;
  host: () => MessagesHost;
  openPrivacyPane?: (anchor: string) => Promise<boolean> | boolean;
  /** Tests: the app call (default electron/mac-apps.mjs testMacApp). */
  test?: typeof testMacApp;
  /** Tests: the live status and the Automation prompt (mocked native layer). */
  statusLive?: typeof macAppsStatusLive;
  askAutomation?: typeof requestMacAppAutomation;
};

const PATHS = new Set(["/api/mac-apps", "/api/mac-apps/test", "/api/mac-apps/permissions/open", "/api/mac-apps/permissions/ask"]);
const app = (body: unknown): MacAppId | null => {
  const value = body && typeof body === "object" && !Array.isArray(body) ? (body as { app?: unknown }).app : undefined;
  return typeof value === "string" && (MAC_APP_IDS as string[]).includes(value) ? value as MacAppId : null;
};

/** Live: the Automation grant of every app is read from macOS (no prompt). */
export async function soloMacAppsStatus(dataDir: string, statusLive: typeof macAppsStatusLive = macAppsStatusLive) {
  const status = await statusLive(dataDir, { platform: "darwin", messagesAccess: () => probeFullDiskAccess() });
  // Messages keeps its own switch (imessage-settings.ts).
  const useMessages = readMessagesSettings(dataDir).useMessages;
  return { ...status, apps: status.apps.map((row) => (row.id === "messages" ? { ...row, enabled: useMessages } : row)) };
}

export function createMacAppsRoutes(deps: MacAppsRoutesDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (!PATHS.has(path)) return PASS;
    if (!messagesOnBotMac({ ...deps.host(), bridgeAction: false }).ok) {
      return json(res, 404, { error: "The Apple apps are set up in the Sagax app on the Mac itself.", code: "mac_apps_not_on_this_mac" });
    }
    res.setHeader("cache-control", "private, no-store");
    if (method === "GET" && path === "/api/mac-apps") return json(res, 200, await soloMacAppsStatus(deps.dataDir, deps.statusLive));
    if (method !== "POST" && method !== "PUT") return json(res, 405, { error: "GET, PUT or POST" });
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const body = await readBody(req);
    if (method === "PUT" && path === "/api/mac-apps") {
      const id = app(body);
      const enabled = (body as { enabled?: unknown } | null)?.enabled;
      if (!id || typeof enabled !== "boolean") return json(res, 400, { error: "send { app, enabled: true or false }", code: "invalid_mac_app" });
      if (id === "messages") writeMessagesSettings(deps.dataDir, enabled);
      else writeMacAppSettings(deps.dataDir, id, { enabled });
      return json(res, 200, await soloMacAppsStatus(deps.dataDir, deps.statusLive));
    }
    if (method === "POST" && path === "/api/mac-apps/test") {
      const id = app(body);
      if (!id) return json(res, 400, { error: "send { app }", code: "invalid_mac_app" });
      const result = await (deps.test ?? testMacApp)(deps.dataDir, id);
      // Log the app and the count only, never names or content.
      console.info("[mac-apps] test app=%s ok=%s count=%d", id, result.ok, result.count);
      return json(res, 200, result);
    }
    if (method === "POST" && path === "/api/mac-apps/permissions/ask") {
      const id = app(body);
      if (!id) return json(res, 400, { error: "send { app }", code: "invalid_mac_app" });
      await (deps.askAutomation ?? requestMacAppAutomation)(deps.dataDir, id, { platform: "darwin" });
      return json(res, 200, await soloMacAppsStatus(deps.dataDir, deps.statusLive));
    }
    if (method === "POST" && path === "/api/mac-apps/permissions/open") {
      const pane = (body as { pane?: unknown } | null)?.pane;
      if (pane !== "automation" && pane !== "fullDiskAccess") return json(res, 400, { error: 'send { pane: "automation" or "fullDiskAccess" }', code: "invalid_pane" });
      if (!deps.openPrivacyPane) return json(res, 501, { error: "Open System Settings from the Sagax Mac app.", code: "mac_apps_helper_unavailable" });
      const opened = await deps.openPrivacyPane(MESSAGES_PRIVACY_PANES[pane]);
      return json(res, 200, { opened: Boolean(opened), pane });
    }
    return json(res, 405, { error: "GET, PUT or POST" });
  };
}
