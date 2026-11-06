// Messages setup on the solo Mac only (Connect apps > Mac > Messages).
//
//   GET  /api/messages              setup status + live permission checks
//   PUT  /api/messages              { useMessages: boolean }
//   POST /api/messages/test         conversation name count only
//   POST /api/messages/permissions/open  { pane: "fullDiskAccess" | "automation" }
//   POST /api/messages/permissions/ask   the macOS Automation prompt for Messages
//
// An organization server and every other host answer 404. There is no
// bridge action behind these routes. The test never returns message bodies.
import { messagesOnBotMac, type MessagesHost } from "../../shared/imessage.ts";
import { messagesPrivacyAnchor, type MessagesPrivacyPane } from "../../shared/mac-messages-setup.ts";
import { writeMessagesSettings } from "../imessage/imessage-settings.ts";
import { messagesReadErrorText } from "../../electron/mac-apps.mjs";
import {
  askMessagesAutomation,
  buildMessagesSetupStatus,
  testMessagesConversationNames,
} from "../imessage/imessage-permissions.ts";
import { PASS, type RouteHandler } from "./table.ts";

const OPEN_PANES = new Set<MessagesPrivacyPane>(["fullDiskAccess", "automation"]);

export type MessagesRoutesDeps = {
  dataDir: string;
  host: () => MessagesHost;
  /** Open a macOS Privacy pane. Absent outside the Electron solo app. */
  openPrivacyPane?: (anchor: string) => Promise<boolean> | boolean;
  /** Tests: the Automation prompt (mocked native layer). */
  askAutomation?: (dataDir: string) => Promise<unknown>;
};

const PATHS = new Set(["/api/messages", "/api/messages/test", "/api/messages/permissions/open", "/api/messages/permissions/ask"]);

export function createMessagesRoutes(deps: MessagesRoutesDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (!PATHS.has(path)) return PASS;
    if (!messagesOnBotMac({ ...deps.host(), bridgeAction: false }).ok) {
      return json(res, 404, {
        error: "Messages is only available on the Mac where this Sagax app runs.",
        code: "messages_not_on_this_mac",
      });
    }
    res.setHeader("cache-control", "private, no-store");

    if (method === "GET" && path === "/api/messages") {
      const status = await buildMessagesSetupStatus({ dataDir: deps.dataDir, host: deps.host() });
      return json(res, 200, status);
    }

    if (method === "PUT" && path === "/api/messages") {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as { useMessages?: unknown }).useMessages !== "boolean") {
        return json(res, 400, { error: "send { useMessages: true or false }", code: "invalid_messages" });
      }
      const saved = writeMessagesSettings(deps.dataDir, (body as { useMessages: boolean }).useMessages);
      const status = await buildMessagesSetupStatus({ dataDir: deps.dataDir, host: deps.host() });
      return json(res, 200, { ...status, useMessages: saved.useMessages });
    }

    if (method === "POST" && path === "/api/messages/test") {
      const status = await buildMessagesSetupStatus({ dataDir: deps.dataDir, host: deps.host() });
      if (status.permissions.fullDiskAccess !== "granted") {
        return json(res, 409, {
          error: "Full Disk Access is required before the Messages test can run.",
          code: "messages_fda_required",
          permissions: status.permissions,
        });
      }
      let result;
      try {
        result = testMessagesConversationNames();
      } catch (cause) {
        // A read error is not a permission refusal: say what failed.
        return json(res, 500, { error: messagesReadErrorText(cause), code: "messages_read_failed" });
      }
      // Log count only: never conversation names or bodies.
      console.info("[messages] test conversationCount=%d", result.conversationCount);
      return json(res, 200, result);
    }

    if (method === "POST" && path === "/api/messages/permissions/ask") {
      await (deps.askAutomation ?? askMessagesAutomation)(deps.dataDir);
      return json(res, 200, await buildMessagesSetupStatus({ dataDir: deps.dataDir, host: deps.host() }));
    }

    if (method === "POST" && path === "/api/messages/permissions/open") {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const body = await readBody(req);
      const pane = body && typeof body === "object" && !Array.isArray(body)
        ? (body as { pane?: unknown }).pane
        : undefined;
      if (typeof pane !== "string" || !OPEN_PANES.has(pane as MessagesPrivacyPane)) {
        return json(res, 400, { error: 'send { pane: "fullDiskAccess" or "automation" }', code: "invalid_pane" });
      }
      if (!deps.openPrivacyPane) {
        return json(res, 501, {
          error: "Open System Settings from the Sagax Mac app.",
          code: "messages_helper_unavailable",
        });
      }
      const opened = await deps.openPrivacyPane(messagesPrivacyAnchor(pane as MessagesPrivacyPane));
      return json(res, 200, { opened: Boolean(opened), pane });
    }

    return json(res, 405, { error: "GET, PUT or POST" });
  };
}
