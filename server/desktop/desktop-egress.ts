// Network egress through the person's own computer (organization server,
// desktop bridge). While a bot works for a person on their computer, the
// network traffic the bot's runtime makes on the server side (the engine's
// own HTTP: remote MCP servers, tool HTTP calls) leaves THROUGH that
// person's PC: their LAN and intranet hosts, their VPN, their IP.
//
//   engine process ──HTTP(S)_PROXY──▶ EgressProxy (127.0.0.1, per-thread
//   credential) ──stream──▶ DesktopTunnels (one WebSocket per connected
//   desktop, multiplexed) ──▶ the desktop opens the TCP connection itself
//   (electron/desktop-tunnel.mjs), through the OS proxy settings and VPN.
//
// Not an open proxy: a credential names one thread and one person; it is
// honoured only while that thread runs a turn for that person whose tools
// target their computer (`active()`), and only that person's own tunnel is
// used. Model traffic (the engine's API) never goes through it (NO_PROXY).
// Destinations are logged (host and port only, never content).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { request as httpRequest, createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect, isIP, type Socket } from "node:net";
import { Duplex } from "node:stream";

import type { BotWorkplaceNetwork } from "../../shared/bot-workplace.ts";

// ── a minimal server side of RFC 6455 (binary messages only) ─────────────

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE = 2 * 1024 * 1024;

export function websocketAccept(key: string): string {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

/** One server-to-client frame (never masked). */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const header = length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  if (length < 126) header[1] = length;
  else if (length < 65536) { header[1] = 126; header.writeUInt16BE(length, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
  return Buffer.concat([header, payload]);
}

/** Parses client frames (always masked) into whole messages. */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentOpcode = 0;
  push(chunk: Buffer): { opcode: number; payload: Buffer }[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out: { opcode: number; payload: Buffer }[] = [];
    for (;;) {
      if (this.buffer.length < 2) break;
      const first = this.buffer[0]!;
      const second = this.buffer[1]!;
      if ((second & 0x80) === 0) throw new Error("client frames must be masked");
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) { if (this.buffer.length < 4) break; length = this.buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) {
        if (this.buffer.length < 10) break;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) throw new Error("frame too large");
        length = Number(big); offset = 10;
      }
      if (length > MAX_MESSAGE) throw new Error("frame too large");
      if (this.buffer.length < offset + 4 + length) break;
      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(this.buffer.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < payload.length; index++) payload[index]! ^= mask[index % 4]!;
      this.buffer = this.buffer.subarray(offset + 4 + length);
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      if (opcode >= 8) { out.push({ opcode, payload }); continue; }
      if (opcode !== 0) { this.fragments = [payload]; this.fragmentOpcode = opcode; }
      else this.fragments.push(payload);
      if (this.fragments.reduce((total, part) => total + part.length, 0) > MAX_MESSAGE) throw new Error("message too large");
      if (fin) { out.push({ opcode: this.fragmentOpcode, payload: Buffer.concat(this.fragments) }); this.fragments = []; }
    }
    return out;
  }
}

// ── the tunnel protocol (one binary message = one frame) ──────────────────

export const TUNNEL = { OPEN: 1, OPENED: 2, FAILED: 3, DATA: 4, END: 5 } as const;

export function tunnelMessage(type: number, stream: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(5);
  header[0] = type;
  header.writeUInt32BE(stream >>> 0, 1);
  return Buffer.concat([header, payload]);
}

export function parseTunnelMessage(message: Buffer): { type: number; stream: number; payload: Buffer } | null {
  if (message.length < 5) return null;
  return { type: message[0]!, stream: message.readUInt32BE(1), payload: message.subarray(5) };
}

const CHUNK = 64 * 1024;
const OPEN_TIMEOUT_MS = 20_000;
const MAX_STREAMS = 256;
const MAX_BUFFERED = 8 * 1024 * 1024;

type Pending = { resolve: (stream: TunnelStream) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

class TunnelStream extends Duplex {
  readonly id: number;
  private tunnel: Tunnel;
  private ended = false;
  constructor(tunnel: Tunnel, id: number) {
    super({ allowHalfOpen: true });
    this.tunnel = tunnel;
    this.id = id;
    // A desktop going away must never crash the server: consumers attach
    // their own listener, this one only keeps an unobserved error quiet.
    this.on("error", () => {});
  }
  _read(): void { /* data is pushed as it arrives */ }
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.tunnel.sendData(this.id, chunk, callback);
  }
  _final(callback: (error?: Error | null) => void): void {
    if (!this.ended) { this.ended = true; this.tunnel.send(TUNNEL.END, this.id); }
    callback();
  }
  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (!this.ended) { this.ended = true; this.tunnel.send(TUNNEL.END, this.id); }
    this.tunnel.forget(this.id);
    callback(error);
  }
}

export class OutsideLan extends Error {
  readonly code = "outside-lan";
}

/** One connected desktop's tunnel. */
class Tunnel {
  readonly person: string;
  readonly session: string;
  readonly bridgeId: string;
  readonly connectedAt = Date.now();
  private socket: Duplex;
  private next = 1;
  private streams = new Map<number, TunnelStream>();
  private pending = new Map<number, Pending>();
  private closed = false;
  private onClose: () => void;
  constructor(socket: Duplex, owner: { person: string; session: string; bridgeId: string }, head: Buffer, onClose: () => void) {
    this.socket = socket;
    this.person = owner.person;
    this.session = owner.session;
    this.bridgeId = owner.bridgeId;
    this.onClose = onClose;
    const reader = new FrameReader();
    const take = (chunk: Buffer) => {
      let messages: { opcode: number; payload: Buffer }[];
      try { messages = reader.push(chunk); } catch { this.close(); return; }
      for (const { opcode, payload } of messages) {
        if (opcode === 8) { this.close(); return; }
        if (opcode === 9) { this.write(encodeFrame(10, payload)); continue; }
        if (opcode !== 2) continue;
        this.receive(payload);
      }
    };
    socket.on("data", take);
    socket.on("close", () => this.close());
    socket.on("error", () => this.close());
    if (head.length) take(head);
  }

  get open(): boolean { return !this.closed; }

  private write(frame: Buffer): boolean {
    if (this.closed) return false;
    return this.socket.write(frame);
  }

  send(type: number, stream: number, payload?: Buffer): boolean {
    return this.write(encodeFrame(2, tunnelMessage(type, stream, payload)));
  }

  sendData(stream: number, chunk: Buffer, callback: (error?: Error | null) => void): void {
    if (this.closed) { callback(new Error("Your computer disconnected.")); return; }
    let ok = true;
    for (let offset = 0; offset < chunk.length; offset += CHUNK) ok = this.send(TUNNEL.DATA, stream, chunk.subarray(offset, offset + CHUNK));
    if (ok) callback();
    else this.socket.once("drain", () => callback());
  }

  forget(stream: number): void { this.streams.delete(stream); }

  private receive(message: Buffer): void {
    const parsed = parseTunnelMessage(message);
    if (!parsed) return;
    const { type, stream, payload } = parsed;
    if (type === TUNNEL.OPENED || type === TUNNEL.FAILED) {
      const waiting = this.pending.get(stream);
      if (!waiting) return;
      this.pending.delete(stream);
      clearTimeout(waiting.timer);
      if (type === TUNNEL.OPENED) {
        const duplex = new TunnelStream(this, stream);
        this.streams.set(stream, duplex);
        waiting.resolve(duplex);
      } else {
        let info: { code?: string; message?: string } = {};
        try { info = JSON.parse(payload.toString("utf8")) as typeof info; } catch { /* plain failure */ }
        const message = typeof info.message === "string" ? info.message.slice(0, 300) : "Your computer could not open this connection.";
        waiting.reject(info.code === "outside-lan" ? new OutsideLan(message) : new Error(message));
      }
      return;
    }
    const duplex = this.streams.get(stream);
    if (!duplex) return;
    if (type === TUNNEL.DATA) {
      if (duplex.readableLength > MAX_BUFFERED) { duplex.destroy(new Error("tunnel buffer overflow")); return; }
      duplex.push(payload);
    } else if (type === TUNNEL.END) {
      duplex.push(null);
    }
  }

  openStream(host: string, port: number): Promise<TunnelStream> {
    if (this.closed) return Promise.reject(new Error("Your computer disconnected."));
    if (this.streams.size + this.pending.size >= MAX_STREAMS) return Promise.reject(new Error("Too many connections through your computer at once."));
    const id = this.next;
    this.next = this.next >= 0x7fffffff ? 1 : this.next + 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Your computer did not open the connection in time.")); }, OPEN_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.send(TUNNEL.OPEN, id, Buffer.from(JSON.stringify({ host, port })));
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiting of this.pending.values()) { clearTimeout(waiting.timer); waiting.reject(new Error("Your computer disconnected.")); }
    this.pending.clear();
    for (const stream of this.streams.values()) stream.destroy(new Error("Your computer disconnected."));
    this.streams.clear();
    try { this.socket.end(encodeFrame(8, Buffer.alloc(0))); } catch { /* gone */ }
    this.socket.destroy();
    this.onClose();
  }
}

/** The connected desktops' tunnels, by person. */
export class DesktopTunnels {
  private tunnels = new Set<Tunnel>();
  private sessionPerson: (session: string) => string | null;
  constructor(sessionPerson: (session: string) => string | null) { this.sessionPerson = sessionPerson; }

  /** Take over an upgraded socket (the 101 answer is written here). */
  accept(socket: Duplex, head: Buffer, key: string, owner: { person: string; session: string; bridgeId: string }): void {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAccept(key)}\r\n\r\n`);
    // A desktop reconnecting replaces its own earlier tunnel only.
    for (const tunnel of this.tunnels) if (tunnel.session === owner.session && tunnel.bridgeId === owner.bridgeId) tunnel.close();
    const person = owner.person.trim().toLowerCase();
    const tunnel = new Tunnel(socket, { ...owner, person }, head, () => this.tunnels.delete(tunnel));
    this.tunnels.add(tunnel);
  }

  /** The person's most recent live tunnel whose session is still theirs. */
  private current(person: string): Tunnel | null {
    const key = person.trim().toLowerCase();
    let best: Tunnel | null = null;
    for (const tunnel of this.tunnels) {
      if (tunnel.person !== key || !tunnel.open) continue;
      if (this.sessionPerson(tunnel.session)?.trim().toLowerCase() !== key) { tunnel.close(); continue; }
      if (!best || tunnel.connectedAt > best.connectedAt) best = tunnel;
    }
    return best;
  }

  connected(person: string | null): boolean { return Boolean(person && this.current(person)); }

  open(person: string, host: string, port: number): Promise<Duplex> {
    const tunnel = this.current(person);
    if (!tunnel) return Promise.reject(Object.assign(new Error("Your computer is not connected, so this connection cannot go through it."), { code: "not_connected" }));
    return tunnel.openStream(host, port);
  }

  closeSession(session: string): void { for (const tunnel of this.tunnels) if (tunnel.session === session) tunnel.close(); }
  close(): void { for (const tunnel of this.tunnels) tunnel.close(); }
}

// ── which destinations go through the person's computer ───────────────────

const PRIVATE_V4: ReadonlyArray<[number, number]> = [
  [0x0a000000, 8], [0xac100000, 12], [0xc0a80000, 16], [0x64400000, 10],
];
function v4(address: string): number { return address.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0; }
function inV4(address: string, [base, bits]: [number, number]): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((v4(address) & mask) >>> 0) === base;
}

/** A local-network address: RFC 1918, CGNAT (100.64/10, VPN overlays) and
 * IPv6 unique local. Loopback and link-local are not "the LAN". */
export function isLanAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return PRIVATE_V4.some((range) => inV4(address, range));
  if (family === 6) return /^f[cd][0-9a-f]{2}:/i.test(address);
  return false;
}

/** Which way a destination goes for a person whose network option is
 * `network`: "desktop" through their computer, "direct" from the server
 * as it would without the tunnel, "ask" through their computer, falling
 * back to direct if their computer says it is outside their LAN. */
export function egressRoute(host: string, network: BotWorkplaceNetwork): "desktop" | "direct" | "ask" {
  if (network === "all") return "desktop";
  const literal = host.replace(/^\[|\]$/g, "");
  if (isIP(literal)) return isLanAddress(literal) ? "desktop" : "direct";
  return "ask";
}

// ── the proxy the engine is pointed at ────────────────────────────────────

export interface EgressGrant {
  person: string;
  botId: string;
  threadId: string;
  /** Honoured only while this returns true: a turn of this thread runs for
   * this person with their computer as its target. */
  active: () => boolean;
  network: () => BotWorkplaceNetwork;
}

export interface EgressAuditEntry { person: string; botId: string; threadId: string; host: string; port: number; via: "desktop" | "direct"; ok: boolean; error?: string }

export interface EgressProxy {
  /** The proxy URL with this thread's credential, for HTTP(S)_PROXY. Stable
   * for a thread and person, so an engine process kept warm between turns
   * keeps the same environment. */
  urlFor(grant: EgressGrant): string;
  revoke(threadId: string): void;
  port(): number;
  close(): Promise<void>;
}

const credentialOf = (header: string | string[] | undefined): string | null => {
  const value = Array.isArray(header) ? header[0] : header;
  const match = value ? /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(value.trim()) : null;
  if (!match) return null;
  const decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon >= 0 ? decoded.slice(colon + 1) : null;
};

function target(value: string, defaultPort: number): { host: string; port: number } | null {
  try {
    const url = new URL(value.includes("://") ? value : `tcp://${value}`);
    const port = url.port ? Number(url.port) : defaultPort;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host, port };
  } catch {
    return null;
  }
}

export async function startEgressProxy(deps: {
  tunnels: DesktopTunnels;
  audit: (entry: EgressAuditEntry) => void;
  /** A direct connection from the server (the "lan" option's outside part). */
  direct?: (host: string, port: number) => Promise<Duplex>;
}): Promise<EgressProxy> {
  const grants = new Map<string, EgressGrant & { token: string }>();
  const byToken = new Map<string, string>();
  const direct = deps.direct ?? ((host: string, port: number) => new Promise<Duplex>((resolve, reject) => {
    const socket: Socket = netConnect({ host, port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  }));

  const grantFor = (header: string | string[] | undefined): (EgressGrant & { token: string }) | null => {
    const presented = credentialOf(header);
    if (!presented || !/^[a-f0-9]{64}$/.test(presented)) return null;
    for (const [token, threadKey] of byToken) {
      if (timingSafeEqual(Buffer.from(token), Buffer.from(presented))) return grants.get(threadKey) ?? null;
    }
    return null;
  };

  const route = async (grant: EgressGrant, host: string, port: number): Promise<{ stream: Duplex; via: "desktop" | "direct" }> => {
    const way = egressRoute(host, grant.network());
    if (way === "direct") return { stream: await direct(host, port), via: "direct" };
    try {
      return { stream: await deps.tunnels.open(grant.person, host, port), via: "desktop" };
    } catch (error) {
      if (way === "ask" && error instanceof OutsideLan) return { stream: await direct(host, port), via: "direct" };
      throw error;
    }
  };

  const refuse = (status: number, message: string) =>
    `HTTP/1.1 ${status} ${status === 407 ? "Proxy Authentication Required" : status === 403 ? "Forbidden" : "Bad Gateway"}\r\n` +
    `${status === 407 ? 'Proxy-Authenticate: Basic realm="sagax"\r\n' : ""}content-type: text/plain\r\ncontent-length: ${Buffer.byteLength(message)}\r\nconnection: close\r\n\r\n${message}`;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const grant = grantFor(req.headers["proxy-authorization"]);
    if (!grant) { res.writeHead(407, { "proxy-authenticate": 'Basic realm="sagax"', connection: "close" }).end("proxy authentication required"); return; }
    if (!grant.active()) { res.writeHead(403, { connection: "close" }).end("this conversation is not working on your computer right now"); return; }
    let url: URL;
    try { url = new URL(req.url ?? ""); } catch { res.writeHead(400).end("absolute http URL required"); return; }
    if (url.protocol !== "http:") { res.writeHead(400).end("use CONNECT for https"); return; }
    const dest = target(url.host, 80);
    if (!dest) { res.writeHead(400).end("bad destination"); return; }
    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    headers.connection = "close";
    void route(grant, dest.host, dest.port).then(({ stream, via }) => {
      deps.audit({ person: grant.person, botId: grant.botId, threadId: grant.threadId, host: dest.host, port: dest.port, via, ok: true });
      const upstream = httpRequest({
        method: req.method, path: `${url.pathname}${url.search}`, headers,
        createConnection: () => stream as unknown as Socket,
      }, (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      });
      upstream.on("error", () => { if (!res.headersSent) res.writeHead(502).end("the connection through your computer failed"); else res.destroy(); });
      req.pipe(upstream);
    }, (error: Error) => {
      deps.audit({ person: grant.person, botId: grant.botId, threadId: grant.threadId, host: dest.host, port: dest.port, via: "desktop", ok: false, error: error.message });
      res.writeHead(502, { connection: "close" }).end(error.message);
    }).catch(() => {});
  });

  server.on("connect", (req: IncomingMessage, client: Duplex, head: Buffer) => {
    client.on("error", () => client.destroy());
    const grant = grantFor(req.headers["proxy-authorization"]);
    if (!grant) { client.end(refuse(407, "proxy authentication required")); return; }
    if (!grant.active()) { client.end(refuse(403, "this conversation is not working on your computer right now")); return; }
    const dest = target(req.url ?? "", 443);
    if (!dest) { client.end(refuse(502, "bad destination")); return; }
    void route(grant, dest.host, dest.port).then(({ stream, via }) => {
      deps.audit({ person: grant.person, botId: grant.botId, threadId: grant.threadId, host: dest.host, port: dest.port, via, ok: true });
      if (client.destroyed) { stream.destroy(); return; }
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) stream.write(head);
      stream.on("error", () => client.destroy());
      client.on("close", () => stream.destroy());
      stream.on("close", () => client.destroy());
      stream.pipe(client);
      client.pipe(stream);
    }, (error: Error) => {
      deps.audit({ person: grant.person, botId: grant.botId, threadId: grant.threadId, host: dest.host, port: dest.port, via: "desktop", ok: false, error: error.message });
      client.end(refuse(502, error.message));
    }).catch(() => {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    urlFor(grant) {
      const key = `${grant.threadId}\n${grant.person.trim().toLowerCase()}`;
      const existing = grants.get(key);
      const token = existing?.token ?? randomBytes(32).toString("hex");
      grants.set(key, { ...grant, person: grant.person.trim().toLowerCase(), token });
      byToken.set(token, key);
      return `http://sagax:${token}@127.0.0.1:${port}`;
    },
    revoke(threadId) {
      for (const [key, grant] of grants) {
        if (grant.threadId !== threadId) continue;
        grants.delete(key);
        byToken.delete(grant.token);
      }
    },
    port: () => port,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

/** Hosts that never go through the person's computer: this server's own
 * loopback (Sagax's internal calls) and the model providers (the engine's
 * own API traffic, which is the organization's, not the person's). */
export const EGRESS_NO_PROXY = [
  "localhost", "127.0.0.1", "::1",
  "api.anthropic.com", ".anthropic.com", "claude.ai", ".claude.ai", "statsig.anthropic.com",
  "api.openai.com", ".openai.com", "chatgpt.com", ".chatgpt.com",
];

/** The environment an engine process gets for a proxied turn. */
export function egressEnvironment(proxyUrl: string, extraNoProxy: readonly string[] = []): Record<string, string> {
  const noProxy = [...new Set([...EGRESS_NO_PROXY, ...extraNoProxy.filter(Boolean)])].join(",");
  return {
    HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl,
    NO_PROXY: noProxy, no_proxy: noProxy,
  };
}
