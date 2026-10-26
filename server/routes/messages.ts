// Use Messages, on the solo Mac only.
//
//   GET /api/messages  { useMessages, available: true }
//   PUT /api/messages  { useMessages: boolean }
//
// An organization server and every other host answer 404. There is no
// bridge action behind this route.
import { messagesOnBotMac, type MessagesHost } from "../../shared/imessage.ts";
import { readMessagesSettings, writeMessagesSettings } from "../imessage-settings.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createMessagesRoutes(deps: { dataDir: string; host: () => MessagesHost }): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path !== "/api/messages") return PASS;
    if (!messagesOnBotMac({ ...deps.host(), bridgeAction: false }).ok) {
      return json(res, 404, { error: "Messages is only available on the Mac where this Sagax app runs.", code: "messages_not_on_this_mac" });
    }
    res.setHeader("cache-control", "private, no-store");
    if (method === "GET" && path === "/api/messages") return json(res, 200, { ...readMessagesSettings(deps.dataDir), available: true });
    if (method === "PUT" && path === "/api/messages") {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "content-type must be application/json" });
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as { useMessages?: unknown }).useMessages !== "boolean") {
        return json(res, 400, { error: "send { useMessages: true or false }", code: "invalid_messages" });
      }
      const saved = writeMessagesSettings(deps.dataDir, (body as { useMessages: boolean }).useMessages);
      return json(res, 200, { ...saved, available: true });
    }
    return json(res, 405, { error: "GET or PUT" });
  };
}
