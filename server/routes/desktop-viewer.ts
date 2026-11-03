// Only the RFB WebSocket crosses the container boundary. The viewer page is
// bundled with the app: serving container-controlled JavaScript on the app's
// origin would give a bot access to the person's authenticated workspace.
import { createHash } from "node:crypto";
import { request, ServerResponse, type IncomingMessage, type Server } from "node:http";
import { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { isSameOrigin, type RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { isDesktopTunnelPath } from "../desktop/desktop-bridge-routes.ts";
import { bridgeWebSocketToStream, websocketAccept } from "../streams/ws-bridge.ts";

// `sandbox/me` is the signed-in person's own server environment desktop
// (organization mode): there is no id that names another person's.
const ROUTE = /^\/api\/desktop-viewer\/(local\/(?:shared|bot-[a-f0-9]{64}|pool-\d+)|vps\/[\w-]+|sandbox\/me)(\/websockify)?$/;
export const SANDBOX_VIEWER_TARGET = "sandbox/me";
const HANDSHAKE_MS = 10_000;
const RECHECK_MS = 5_000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const BOT_ID = /^[\w-]+$/;
const CONTROL_LEASE = /^[A-Za-z0-9_-]{16,120}$/;

/** Providers resolve a managed loopback endpoint, never a browser-supplied URL. */
export interface DesktopConnection {
  /** A websockify endpoint on 127.0.0.1 (Local VM, VPS)... */
  port: number;
  /** ...or a raw RFB byte stream this route frames as WebSocket itself
   * (the server environment's desktop through the provisioner). */
  stream?: () => Promise<Duplex>;
  password: string | null;
  /** Told to the viewer: the password only watches (server-enforced by the
   * VNC server's view-only password). */
  viewOnly?: boolean;
  live?: () => boolean;
  touch?: () => void;
  /** Acquired only by WebSockets; release must not close other viewers. */
  retain?: () => () => void;
}
export interface DesktopTarget {
  key: string;
  /** Who may open it. Default: the admin scope. */
  allows?: (auth: RequestAuth) => boolean;
  resolve: (request: { upgrade: boolean; control: boolean }) => Promise<DesktopConnection>;
}

export function desktopViewerUrl(target: string, threadId?: string): string {
  const params = new URLSearchParams({ target, ...(threadId ? { threadId } : {}) });
  return `/desktop-viewer#${params}`;
}

interface Upgrade { socket: Socket; head: Buffer; release: () => void; close: () => void; owner?: string; botId?: string }

export function createDesktopViewer(deps: {
  target: (id: string, auth: RequestAuth) => DesktopTarget | undefined;
  live: (auth: RequestAuth) => boolean;
  /** Other WebSocket routes that run through the same gates (voice mode's
   * live call, server/voice/voice-mode.ts); they take their socket with upgradeOf. */
  acceptsUpgrade?: (path: string) => boolean;
  /** Bind a viewer to a control lease: a phone driving the Local VM directly,
   * without the companion sidecar. Answers nothing unless `controlLeaseId`
   * holds `botId`'s computer right now and the target is that computer;
   * otherwise a probe that says whether the lease still holds. Shared and pool
   * targets are refused because a bot hold cannot reserve their desktop. */
  lease?: (id: string, botId: string, controlLeaseId: string, threadId?: string) => (() => boolean) | undefined;
}) {
  const upgrades = new Map<IncomingMessage, Upgrade>();
  let stopped = false;

  /** Run upgrades through the very same authentication, hosted-workspace and
   * maintenance gates as HTTP. Only this route can detach the response socket. */
  function attach(server: Server, handle: (req: IncomingMessage, res: ServerResponse) => Promise<unknown>): void {
    server.on("upgrade", (req, socket, head) => {
      // The desktop bridge's tunnel answers its own upgrades
      // (server/desktop/desktop-bridge-routes.ts attachDesktopTunnel).
      try { if (isDesktopTunnelPath(new URL(req.url ?? "", "http://localhost").pathname)) return; } catch { /* answered below */ }
      if (stopped || !(socket instanceof Socket)) { socket.destroy(); return; }
      const res = new ServerResponse(req);
      res.assignSocket(socket);
      // Rejected upgrades end this socket; do not let HTTP clients pool it.
      res.setHeader("connection", "close");
      socket.on("error", () => socket.destroy());
      res.once("finish", () => socket.end(() => socket.destroy()));
      let path: string;
      try { path = new URL(req.url ?? "", "http://localhost").pathname; }
      catch { res.writeHead(400).end(); return; }
      if (!ROUTE.exec(path)?.[2] && !deps.acceptsUpgrade?.(path)) { res.writeHead(404).end(); return; }
      // Keep reading while auth/inspection awaits, so a closed tab's FIN is
      // observed. Bound and preserve any eagerly sent WebSocket bytes.
      const upgrade: Upgrade = { socket, head, release: () => socket.off("data", buffer), close: () => socket.destroy() };
      const buffer = (data: Buffer) => {
        if (upgrade.head.length + data.length > 64 * 1024) socket.destroy();
        else upgrade.head = Buffer.concat([upgrade.head, data]);
      };
      socket.on("data", buffer);
      socket.once("end", () => socket.destroy());
      socket.once("close", () => { upgrade.release(); upgrades.delete(req); });
      upgrades.set(req, upgrade);
      const timeout = setTimeout(() => socket.destroy(), HANDSHAKE_MS);
      timeout.unref();
      socket.once("close", () => clearTimeout(timeout));
      void handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
        else socket.destroy();
      }).finally(() => clearTimeout(timeout));
    });
  }

  const route: RouteHandler = async ({ req, res, url, path, method, auth, json }) => {
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    res.setHeader("cache-control", "private, no-store");
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    // Also enforce at this boundary; the central gate defaults these paths
    // to admin, like the existing Local VM status and control endpoints. A
    // person's own server environment is theirs alone, and (2026-10-26) a
    // bot's VPS desktop is its owner's: their target decides (target.allows).
    // The Local VM desktops (shared, pooled, per bot) stay admin.
    const sandbox = match[1] === SANDBOX_VIEWER_TARGET;
    const ownerServed = sandbox || match[1].startsWith("vps/");
    if ((!ownerServed && !auth.scopes.includes("admin")) || !isSameOrigin(req)) return json(res, 403, { error: "forbidden" });
    // A viewer bound to a control lease: both names or neither, well formed,
    // and holding before anything is inspected. Checked again with every
    // liveness pass, so handing back closes the desktop within seconds. The
    // conversation, when named, picks the VM seat the join picked.
    const botId = url.searchParams.get("botId");
    const controlLeaseId = url.searchParams.get("controlLeaseId");
    const threadId = url.searchParams.get("threadId") ?? undefined;
    if ((botId === null) !== (controlLeaseId === null)) {
      return json(res, 400, { error: "botId and controlLeaseId go together" });
    }
    if (botId !== null && (sandbox || !BOT_ID.test(botId) || !CONTROL_LEASE.test(controlLeaseId!) || !deps.lease
      || (threadId !== undefined && !BOT_ID.test(threadId)))) {
      return json(res, 400, { error: "botId, threadId or controlLeaseId is not valid" });
    }
    if (botId === null && threadId !== undefined) return json(res, 400, { error: "threadId needs botId and controlLeaseId" });
    // Do not let a saved or constructed socket URL bypass the join refusal:
    // a bot's control lease does not exclude other users of a shared desktop.
    if (botId !== null && (match[1] === "local/shared" || match[1].startsWith("local/pool-"))) {
      return json(res, 409, { error: "Phone control requires a per-bot Local VM. Select per-bot mode in Settings → Computers." });
    }
    const bound = botId === null ? undefined : deps.lease!(match[1], botId, controlLeaseId!, threadId);
    if (botId !== null && !bound) return json(res, 409, { error: "Take control of this computer first" });
    const holds = () => bound?.() ?? true;
    const target = deps.target(match[1], auth);
    if (!target) return json(res, 404, { error: "Desktop not found" });
    if (!(target.allows ?? ((who: RequestAuth) => who.scopes.includes("admin")))(auth)) return json(res, 403, { error: "forbidden" });
    let control = false;
    try { control = new URL(req.url ?? "", "http://localhost").searchParams.get("control") === "1"; } catch { /* no query */ }
    const upgrade = upgrades.get(req);
    if (upgrade && auth.kind === "session") upgrade.owner = auth.session.id;
    if (upgrade && botId !== null) upgrade.botId = botId;
    let connection: DesktopConnection;
    try { connection = await target.resolve({ upgrade: Boolean(match[2]), control }); }
    catch (error) {
      const status = error && typeof error === "object" && "status" in error ? error.status : 502;
      // Only the fixed reason codes of the targets (desktop-viewer-targets.ts),
      // so the view can say what to do (an outdated environment).
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[a-z_]{1,32}$/.test(error.code) ? error.code : undefined;
      return json(res, typeof status === "number" && status >= 400 && status < 600 ? status : 502,
        { error: "The desktop is not available. Open it again from Sagax.", ...(code ? { code } : {}) });
    }
    // Inspection may outlive a closed tab or the handshake deadline.
    if (res.destroyed || upgrade?.socket.destroyed) return;
    const live = () => deps.live(auth) && deps.target(match[1], auth)?.key === target.key && (connection.live?.() ?? true);
    if (!live()) return json(res, 401, { error: "Viewer access expired" });
    if (!holds()) return json(res, 409, { error: "Take control of this computer first" });
    if (!connection.stream && (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535)) {
      return json(res, 409, { error: "The desktop viewer is not available." });
    }
    if (!match[2]) return json(res, 200, { password: connection.password, ...(connection.viewOnly !== undefined ? { viewOnly: connection.viewOnly } : {}) });
    if (!upgrade) return json(res, 426, { error: "WebSocket upgrade required" });
    const key = req.headers["sec-websocket-key"];
    if (req.headers.upgrade?.toLowerCase() !== "websocket" || req.headers["sec-websocket-version"] !== "13"
      || typeof key !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(key)) {
      return json(res, 400, { error: "Invalid WebSocket handshake" });
    }
    if (connection.stream) { await bridgeStream(connection, upgrade, res, json, key, () => live() && holds()); return; }
    // Fixed host and path, port from an inspected managed container. Never
    // forward cookies, bearer tokens, query parameters or forwarded headers.
    const upstream = request({
      hostname: "127.0.0.1", port: connection.port, path: "/websockify",
      headers: { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13" },
    });
    const { socket } = upgrade;
    let peer: Duplex | undefined;
    let recheck: ReturnType<typeof setInterval> | undefined;
    const release = connection.retain?.();
    let closed = false;
    const timeout = setTimeout(() => fail(), HANDSHAKE_MS);
    timeout.unref();
    upgrade.close = () => {
      if (closed) return;
      closed = true;
      release?.();
      clearTimeout(timeout);
      clearInterval(recheck);
      upstream.destroy();
      peer?.destroy();
      socket.destroy();
    };
    const fail = () => {
      if (closed) return;
      if (peer || socket.destroyed) { upgrade.close(); return; }
      if (!res.headersSent && !socket.destroyed) json(res, 502, { error: "Could not connect to the desktop viewer" });
      upstream.destroy();
    };
    socket.once("close", upgrade.close);
    upstream.once("error", fail);
    upstream.once("response", (answer) => { answer.resume(); fail(); });
    upstream.once("upgrade", (answer, remote, remoteHead) => {
      const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
      if (!live() || !holds() || socket.destroyed || answer.headers["sec-websocket-accept"] !== accept
        || answer.headers.upgrade?.toLowerCase() !== "websocket") {
        remote.destroy(); fail(); return;
      }
      clearTimeout(timeout);
      peer = remote;
      remote.once("error", upgrade.close);
      remote.once("close", upgrade.close);
      upgrade.release();
      res.detachSocket(socket);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      if (remoteHead.length) socket.write(remoteHead);
      if (upgrade.head.length) remote.write(upgrade.head);
      upgrade.head = Buffer.alloc(0);
      socket.pipe(remote).pipe(socket);
      connection.touch?.();
      recheck = setInterval(() => {
        if (!live() || !holds()) upgrade.close();
        else connection.touch?.();
      }, RECHECK_MS);
      recheck.unref();
    });
    upstream.end();
  };

  /** The server environment's desktop: this route is the WebSocket end
   * itself and splices it to the provisioner's RFB stream. */
  async function bridgeStream(connection: DesktopConnection, upgrade: Upgrade, res: ServerResponse,
    json: (res: ServerResponse, status: number, body: unknown) => unknown, key: string, live: () => boolean): Promise<void> {
    let stream: Duplex;
    try { stream = await connection.stream!(); }
    catch (error) {
      const status = error && typeof error === "object" && "status" in error ? error.status : 502;
      json(res, typeof status === "number" && status >= 400 && status < 600 ? status : 502, { error: "The desktop is not available." });
      return;
    }
    const { socket } = upgrade;
    if (socket.destroyed || !live()) {
      stream.destroy();
      if (!socket.destroyed) json(res, 401, { error: "Viewer access expired" });
      return;
    }
    upgrade.release();
    res.detachSocket(socket);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAccept(key)}\r\n\r\n`);
    const head = upgrade.head;
    upgrade.head = Buffer.alloc(0);
    let recheck: ReturnType<typeof setInterval> | undefined;
    const closeBridge = bridgeWebSocketToStream(socket, stream, () => clearInterval(recheck));
    upgrade.close = () => { clearInterval(recheck); closeBridge(); socket.destroy(); };
    if (head.length) socket.unshift(head);
    connection.touch?.();
    recheck = setInterval(() => {
      if (!live()) upgrade.close();
      else connection.touch?.();
    }, RECHECK_MS);
    recheck.unref();
  }

  return {
    route, attach,
    /** The pending upgrade of a request another route accepted (acceptsUpgrade). */
    upgradeOf: (req: IncomingMessage) => {
      const upgrade = upgrades.get(req);
      return upgrade ? { socket: upgrade.socket, get head() { return upgrade.head; }, release: () => upgrade.release() } : undefined;
    },
    /** Close a session's viewers: all of them (sign-out, revocation), or only
     * those it opened under a lease on one bot (that bot's hand-back). */
    closeForOwner: (owner: string, botId?: string) => {
      let closed = 0;
      for (const upgrade of upgrades.values()) {
        if (upgrade.owner !== owner || (botId !== undefined && upgrade.botId !== botId)) continue;
        // A viewer already closed stays listed until its socket's close
        // event, which arrives later on Windows: not closed or counted again.
        if (upgrade.socket.destroyed) continue;
        upgrade.close();
        closed++;
      }
      return closed;
    },
    closeAll: () => {
      stopped = true;
      for (const upgrade of upgrades.values()) upgrade.close();
    },
  };
}
