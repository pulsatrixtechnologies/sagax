// HTTP side of the desktop bridge (organization server). The desktop app,
// signed in to this server as a person, connects out:
//
//   POST /api/desktop-bridge/connect                 register this desktop
//   POST /api/desktop-bridge/<id>/poll|lease|progress|result|disconnect
//   GET  /api/desktop-bridge/<id>/tunnel   (WebSocket) network egress
//   GET  /api/me/desktop-bridge            the person's own status + activity
//   POST /api/desktop-bridge/<id>/system   coarse OS, CPU, memory, disk facts
//   POST /api/me/desktop-bridge/computers/rename|remove
//                                          { computer: id or name, name? }: the person's
//                                          other computers (remove: offline only)
//   POST /api/me/desktop-bridge/local-vm   the person's own Local VM through
//                                          their desktop: { action: status|start }
//   GET/PUT /api/me/local-models           this person's expose and share switches
//   POST /api/desktop-bridge/<id>/local-models
//                                          catalog the desktop probed (ids only)
//
// Every call is the session's own person: the person is read from the
// session, never from the body, and a private secret (x-sagax-bridge-secret,
// held by the desktop's main process only) binds poll and results to the
// exact desktop that registered. Answers 404 on a solo server.
import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import { Socket } from "node:net";
import type { Duplex } from "node:stream";

import { localVmDesktopSpec } from "./container-computer.ts";
import { desktopBridgeRegistration, desktopSystemInfo, type DesktopBridgeOperation, type DesktopBridges } from "./desktop-bridge.ts";
import type { DesktopTunnels } from "./desktop-egress.ts";
import type { DesktopTerminals } from "./desktop-terminal.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

const ID_ROUTE = /^\/api\/desktop-bridge\/([0-9a-f-]{36})\/(poll|lease|progress|result|disconnect|system)$/;
const LOCAL_VM_ROUTE = "/api/me/desktop-bridge/local-vm";
/** Settings > Computer > Other computers: rename or remove one of the person's computers. */
const COMPUTER_ROUTE = /^\/api\/me\/desktop-bridge\/computers\/(rename|remove)$/;
const LOCAL_MODELS_ROUTE = "/api/me/local-models";
const LOCAL_MODELS_PUBLISH = /^\/api\/desktop-bridge\/([0-9a-f-]{36})\/local-models$/;
/** What the person's Computer tab may ask of their own Local VM. */
const LOCAL_VM_ACTIONS: Record<string, DesktopBridgeOperation["action"]> = {
  status: "vm_status", start: "vm_start", stop: "vm_stop", pause: "vm_pause", resume: "vm_resume",
  setup: "vm_setup", install: "vm_install", screenshot: "vm_screenshot",
};
const TUNNEL_ROUTE = /^\/api\/desktop-bridge\/([0-9a-f-]{36})\/tunnel$/;
/** The person's app calling back for an in-chat terminal (server/desktop-terminal.ts). */
const TERMINAL_ROUTE = /^\/api\/desktop-bridge\/([0-9a-f-]{36})\/terminal\/([a-f0-9]{48})$/;

/** The desktop bridge answers these upgrades itself (tunnel, terminal). */
export function isDesktopTunnelPath(path: string): boolean {
  return TUNNEL_ROUTE.test(path) || TERMINAL_ROUTE.test(path);
}

export interface BridgeAuditEntry {
  at: number;
  person: string;
  botId?: string;
  threadId?: string;
  /** Where it ran: "user-desktop" (their computer) or "direct". */
  target: string;
  kind: "tool" | "network" | "connect";
  /** A tool's action, or "host:port" for the network (never content). */
  detail: string;
  ok: boolean;
  error?: string;
}

/** Append-only audit of what bots did on, and through, people's computers.
 * Bounded: rotates once at 5 MB (one previous file kept). */
export function createBridgeAudit(file: string) {
  const MAX = 5 * 1024 * 1024;
  return {
    record(entry: Omit<BridgeAuditEntry, "at">): void {
      try {
        if (existsSync(file) && statSync(file).size > MAX) renameSync(file, `${file}.1`);
        appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...entry, error: entry.error?.slice(0, 300) })}\n`, { mode: 0o600 });
      } catch { /* the audit never stops a tool */ }
    },
    recent(person: string, limit = 25): BridgeAuditEntry[] {
      const key = person.trim().toLowerCase();
      try {
        const lines = readFileSync(file, "utf8").trimEnd().split("\n").slice(-2000);
        const out: BridgeAuditEntry[] = [];
        for (let index = lines.length - 1; index >= 0 && out.length < limit; index--) {
          try {
            const entry = JSON.parse(lines[index]!) as BridgeAuditEntry;
            if (entry.person === key) out.push(entry);
          } catch { /* skip */ }
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}
export type BridgeAudit = ReturnType<typeof createBridgeAudit>;

export function createDesktopBridgeRoutes(deps: {
  organization: () => boolean;
  bridges: DesktopBridges;
  tunnels: DesktopTunnels;
  audit: BridgeAudit;
  /** The person's workplace preference as the server applies it. */
  workplace: (person: string) => unknown;
  /** This person's Mac models. Absent in tests that only exercise the Local VM. */
  localModels?: {
    read(person: string): unknown;
    update(person: string, body: unknown): { ok: true; value: unknown } | { ok: false; error: string };
    publish(person: string, body: unknown): { ok: true } | { ok: false; error: string };
  };
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const publishMatch = LOCAL_MODELS_PUBLISH.exec(path);
    if (path !== "/api/me/desktop-bridge" && path !== "/api/desktop-bridge/connect" && path !== LOCAL_VM_ROUTE && !COMPUTER_ROUTE.test(path) && path !== LOCAL_MODELS_ROUTE && !publishMatch && !ID_ROUTE.test(path)) return PASS;
    res.setHeader("cache-control", "no-store");
    if (!deps.organization()) return json(res, 404, { error: `no route: ${method} ${path}` });
    const person = auth.kind === "session" ? auth.session.principalId?.trim().toLowerCase() : undefined;
    if (!person || auth.kind !== "session") return json(res, 403, { error: "Sign in with Pulsatrix to connect your computer.", code: "identity_perspicax" });
    if (path === "/api/me/desktop-bridge") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      return json(res, 200, {
        connected: deps.bridges.connected(person),
        tunnel: deps.tunnels.connected(person),
        desktops: deps.bridges.status(person),
        workplace: deps.workplace(person),
        activity: deps.audit.recent(person),
      });
    }
    if (path === LOCAL_MODELS_ROUTE) {
      if (!deps.localModels) return json(res, 404, { error: `no route: ${method} ${path}` });
      if (method === "GET") return json(res, 200, deps.localModels.read(person));
      if (method !== "PUT") return json(res, 405, { error: "method not allowed" });
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "JSON required" });
      const updated = deps.localModels.update(person, await readBody(req, 64_000));
      if (!updated.ok) return json(res, 400, { error: updated.error });
      return json(res, 200, updated.value);
    }
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "JSON required" });
    const body = await readBody(req, 4_000_000) as Record<string, unknown> | null;
    const computerRoute = COMPUTER_ROUTE.exec(path);
    if (computerRoute) {
      if (typeof body?.computer !== "string") return json(res, 400, { error: "computer must be the id or the name of one of your computers", code: "computer_missing" });
      try {
        if (computerRoute[1] === "rename") {
          if (typeof body.name !== "string") return json(res, 400, { error: "name must be text", code: "computer_name" });
          return json(res, 200, { ok: true, ...deps.bridges.rename(person, body.computer, body.name) });
        }
        return json(res, 200, { ok: true, ...deps.bridges.remove(person, body.computer) });
      } catch (error) {
        const status = Number((error as { status?: number }).status) || 400;
        return json(res, status, { error: (error as Error).message, ...((error as { code?: string }).code ? { code: (error as { code: string }).code } : {}) });
      }
    }
    if (path === LOCAL_VM_ROUTE) {
      // The person's own Local VM on their own connected computer, asked by
      // that person from their Computer tab (never a bot, never another's).
      const action = typeof body?.action === "string" && Object.hasOwn(LOCAL_VM_ACTIONS, body.action) ? LOCAL_VM_ACTIONS[body.action] : undefined;
      if (!action) return json(res, 400, { error: `action must be one of ${Object.keys(LOCAL_VM_ACTIONS).join(", ")}` });
      const operation: DesktopBridgeOperation = action === "vm_setup"
        // The server's own hardened recipe (one source of truth); the
        // desktop checks it and fills in its own folder and password.
        ? { action, arguments: { spec: localVmDesktopSpec() } }
        : action === "vm_install"
          ? { action, arguments: { choice: typeof body?.choice === "string" ? body.choice.slice(0, 40) : "" } }
          : { action };
      // A person with several computers names the one they are looking at
      // (its id from GET /api/me/desktop-bridge); without it, the current one.
      const desktopId = typeof body?.desktopId === "string" && /^[0-9a-f-]{36}$/.test(body.desktopId) ? body.desktopId : undefined;
      if (body?.desktopId !== undefined && desktopId === undefined) return json(res, 400, { error: "desktopId must be a desktop id from GET /api/me/desktop-bridge" });
      try {
        return json(res, 200, { result: await deps.bridges.request(person, operation, () => true, undefined, desktopId) });
      } catch (error) {
        const status = (error as { status?: number }).status;
        return json(res, typeof status === "number" && status >= 400 && status < 600 ? status : 502, { error: (error as Error).message, code: (error as { code?: string }).code });
      }
    }
    const secret = String(req.headers["x-sagax-bridge-secret"] ?? "");
    try {
      if (publishMatch) {
        if (!deps.localModels) return json(res, 404, { error: `no route: ${method} ${path}` });
        if (!deps.bridges.owns(publishMatch[1]!, auth.session.id, secret)) return json(res, 403, { error: "This desktop is not connected as you." });
        const published = deps.localModels.publish(person, body);
        if (!published.ok) return json(res, 400, { error: published.error });
        return json(res, 200, { ok: true });
      }
      if (path === "/api/desktop-bridge/connect") {
        const parsed = desktopBridgeRegistration.safeParse(body);
        if (!parsed.success) return json(res, 400, { error: "Invalid desktop registration" });
        deps.bridges.register(parsed.data, auth.session.id, secret);
        deps.audit.record({ person, target: "user-desktop", kind: "connect", detail: `${parsed.data.platform} ${parsed.data.name}`.slice(0, 160), ok: true });
        return json(res, 200, { ok: true, person });
      }
      const [, id, action] = ID_ROUTE.exec(path)!;
      if (action === "poll") {
        let open = true;
        res.once("close", () => { open = false; });
        req.once("aborted", () => { open = false; });
        const job = await deps.bridges.poll(id!, auth.session.id, secret, undefined, () => open && !res.destroyed);
        if (!open || res.destroyed) {
          // Nobody is listening: a job taken now would be lost, so put it back.
          if (job) deps.bridges.requeue(id!, auth.session.id, secret, job.id);
          return;
        }
        return json(res, 200, { job });
      }
      if (action === "lease") return json(res, 200, { active: deps.bridges.liveJob(id!, auth.session.id, secret, String(body?.jobId)) });
      if (action === "progress") return json(res, 200, { ok: deps.bridges.progress(id!, auth.session.id, secret, String(body?.jobId), body?.message) });
      if (action === "result") deps.bridges.complete(id!, auth.session.id, secret, String(body?.jobId), body?.result);
      if (action === "disconnect") deps.bridges.disconnect(id!, auth.session.id, secret);
      if (action === "system") {
        const parsed = desktopSystemInfo.safeParse(body);
        if (!parsed.success) return json(res, 400, { error: "Invalid system information" });
        deps.bridges.setSystem(id!, auth.session.id, secret, parsed.data);
      }
      return json(res, 200, { ok: true });
    } catch (error) {
      const status = (error as { status?: number }).status;
      return json(res, typeof status === "number" && status >= 400 && status < 600 ? status : 500, { error: (error as Error).message });
    }
  };
}

/** The tunnel WebSocket. Authenticated here, before any byte is relayed:
 * the session cookie must be live and signed in as the person whose desktop
 * registered `id` with this secret. */
export function attachDesktopTunnel(server: Server, deps: {
  organization: () => boolean;
  /** The live session behind the request's cookie, or null. */
  session: (req: IncomingMessage) => { id: string; person: string } | null;
  /** The request comes from this server's own origin (or carries none). */
  sameOrigin: (req: IncomingMessage) => boolean;
  /** The desktop `id` is registered by this session with this secret. */
  bridgeOwner: (id: string, session: string, secret: string) => boolean;
  tunnels: DesktopTunnels;
}): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let path: string;
    try { path = new URL(req.url ?? "", "http://localhost").pathname; } catch { return; }
    const match = TUNNEL_ROUTE.exec(path);
    if (!match) return;
    const refuse = (status: number, text: string) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!(socket instanceof Socket)) { socket.destroy(); return; }
    socket.on("error", () => socket.destroy());
    if (!deps.organization()) return refuse(404, "Not Found");
    const key = req.headers["sec-websocket-key"];
    if (req.method !== "GET" || req.headers.upgrade?.toLowerCase() !== "websocket" || req.headers["sec-websocket-version"] !== "13"
      || typeof key !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return refuse(400, "Bad Request");
    if (!deps.sameOrigin(req)) return refuse(403, "Forbidden");
    const session = deps.session(req);
    if (!session) return refuse(401, "Unauthorized");
    const secret = String(req.headers["x-sagax-bridge-secret"] ?? "");
    if (!deps.bridgeOwner(match[1]!, session.id, secret)) return refuse(403, "Forbidden");
    deps.tunnels.accept(socket, head, key, { person: session.person, session: session.id, bridgeId: match[1]! });
  });
}

/** The app's callback socket for an in-chat terminal: authenticated exactly
 * like the tunnel (live session cookie of the person whose desktop
 * registered `id` with this secret), then matched to a ticket this server
 * issued for that same person. Anything else is refused before a byte. */
export function attachDesktopTerminal(server: Server, deps: {
  organization: () => boolean;
  session: (req: IncomingMessage) => { id: string; person: string } | null;
  sameOrigin: (req: IncomingMessage) => boolean;
  bridgeOwner: (id: string, session: string, secret: string) => boolean;
  terminals: DesktopTerminals;
}): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let path: string;
    try { path = new URL(req.url ?? "", "http://localhost").pathname; } catch { return; }
    const match = TERMINAL_ROUTE.exec(path);
    if (!match) return;
    const refuse = (status: number, text: string) => {
      socket.end(`HTTP/1.1 ${status} ${text}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!(socket instanceof Socket)) { socket.destroy(); return; }
    socket.on("error", () => socket.destroy());
    if (!deps.organization()) return refuse(404, "Not Found");
    const key = req.headers["sec-websocket-key"];
    if (req.method !== "GET" || req.headers.upgrade?.toLowerCase() !== "websocket" || req.headers["sec-websocket-version"] !== "13"
      || typeof key !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return refuse(400, "Bad Request");
    if (!deps.sameOrigin(req)) return refuse(403, "Forbidden");
    const session = deps.session(req);
    if (!session) return refuse(401, "Unauthorized");
    const secret = String(req.headers["x-sagax-bridge-secret"] ?? "");
    if (!deps.bridgeOwner(match[1]!, session.id, secret)) return refuse(403, "Forbidden");
    if (!deps.terminals.accept(socket, head, key, { person: session.person, ticket: match[2]! })) return refuse(404, "Not Found");
  });
}
