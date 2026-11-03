import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import { z } from "zod";

import { isSameOrigin, type RequestAuth } from "../auth/request-auth.ts";
import { encodeWebSocketFrame, websocketAccept, webSocketFrameDecoder } from "../streams/ws-bridge.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { parseTerminalControl } from "../../shared/terminal-resources.ts";
import type { createTerminalSessionManager } from "../terminal/terminal-sessions.ts";
import type { createTerminalRequestService } from "../terminal/terminal-requests.ts";

const SESSION = /^\/api\/terminal\/sessions\/([\w-]+)(?:\/(ws|bot-input|close))?$/;

export interface TerminalRouteDeps {
  requests: Pick<ReturnType<typeof createTerminalRequestService>, "destinations">;
  sessions: ReturnType<typeof createTerminalSessionManager>;
  principalId(auth: RequestAuth): string | undefined;
  live(auth: RequestAuth): boolean;
  /** Pending upgrade from routes/desktop-viewer.ts (authenticated like HTTP). */
  upgrade?(req: IncomingMessage): { socket: Socket; head: Buffer; release(): void } | undefined;
}

function handshake(req: IncomingMessage): { key: string } | { status: number; error: string } {
  if (!isSameOrigin(req)) return { status: 403, error: "forbidden" };
  const wsKey = req.headers["sec-websocket-key"];
  if (req.headers.upgrade?.toLowerCase() !== "websocket" || req.headers["sec-websocket-version"] !== "13"
    || typeof wsKey !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(wsKey)) {
    return { status: 400, error: "Invalid WebSocket handshake" };
  }
  return { key: wsKey };
}

export function createTerminalRoutes(deps: TerminalRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/terminal/resources" && method === "GET") {
      const principalId = deps.principalId(auth);
      if (!principalId) return json(res, 401, { error: "Sign in to list terminal resources." });
      // What THIS person may open for that bot: their own environments and,
      // for an admin, the server's hosts. Nothing of anyone else's.
      const query = new URL(req.url ?? "", "http://x").searchParams;
      const botId = query.get("botId") ?? "";
      const threadId = query.get("threadId") ?? "";
      if (!/^[\w-]{1,80}$/.test(botId) || !/^[\w-]{1,80}$/.test(threadId)) return json(res, 400, { error: "botId and threadId are required" });
      const { resources } = await deps.requests.destinations({ botId, threadId, principalId });
      return json(res, 200, { resources });
    }

    const match = SESSION.exec(path);
    if (!match) return PASS;
    const sessionId = match[1]!;
    const action = match[2];
    const principalId = deps.principalId(auth);
    if (!principalId) return json(res, 401, { error: "Sign in to use the terminal." });

    if (action === "ws" && method === "GET") {
      const upgrade = deps.upgrade?.(req);
      if (!upgrade) return json(res, 426, { error: "WebSocket upgrade required" });
      const shake = handshake(req);
      if ("status" in shake) return json(res, shake.status, { error: shake.error });
      if (!deps.live(auth)) return json(res, 401, { error: "Session expired" });
      const attachment = deps.sessions.attachIo(sessionId, principalId);
      if (!attachment) return json(res, 404, { error: "Session not found" });
      const { socket } = upgrade;
      upgrade.release();
      const head = upgrade.head;
      res.detachSocket(socket);
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAccept(shake.key)}\r\n\r\n`,
      );
      const decode = webSocketFrameDecoder();
      // The widget leaving (closed, reloaded, navigated away) ends the
      // session: audited, and the shell stopped.
      const closeBridge = () => {
        deps.sessions.close(sessionId, principalId);
        socket.destroy();
      };
      attachment.output.on("data", (chunk: Buffer) => {
        if (!socket.destroyed) socket.write(encodeWebSocketFrame(2, chunk));
      });
      const onData = (chunk: Buffer) => {
        deps.sessions.noteActivity(sessionId, principalId);
        const frames = decode(chunk);
        if (!Array.isArray(frames)) {
          closeBridge();
          return;
        }
        for (const frame of frames) {
          // Text: a control message (a resize) when it parses as one;
          // anything else, and every binary frame, is keystrokes.
          if (frame.opcode === 1) {
            const control = parseTerminalControl(frame.payload.toString("utf8"));
            if (control) deps.sessions.resize(sessionId, principalId, control.cols, control.rows);
            else attachment.input.write(frame.payload);
          }
          if (frame.opcode === 2) attachment.input.write(frame.payload);
          if (frame.opcode === 9) socket.write(encodeWebSocketFrame(10, frame.payload));
          if (frame.opcode === 8) closeBridge();
        }
      };
      if (head.length) onData(head);
      socket.on("data", onData);
      socket.on("close", closeBridge);
      attachment.output.on("end", closeBridge);
      return;
    }

    if (action === "bot-input" && method === "POST") {
      const body = z.object({ allowed: z.boolean() }).strict().safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Send { allowed: true|false }" });
      if (!deps.sessions.setBotInput(sessionId, principalId, body.data.allowed)) return json(res, 404, { error: "Session not found" });
      return json(res, 200, { ok: true });
    }

    if (action === "close" && method === "POST") {
      if (!deps.sessions.close(sessionId, principalId)) return json(res, 404, { error: "Session not found" });
      return json(res, 200, { ok: true });
    }

    if (!action && method === "GET") {
      const session = deps.sessions.get(sessionId);
      if (!session) return json(res, 404, { error: "Session not found" });
      return json(res, 200, { session });
    }

    return PASS;
  };
}
