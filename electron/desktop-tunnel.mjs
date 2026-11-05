// The desktop's side of the network tunnel (organization server, desktop
// bridge; the server side is server/desktop/desktop-egress.ts). One WebSocket out to
// the server, signed in as the person (their session cookie) and bound to
// this desktop's private bridge secret. For each connection the server asks
// for, THIS computer decides and connects: through the operating system's
// proxy settings (resolveProxy, which also evaluates a PAC file the system
// names; HTTP, HTTPS, SOCKS4a and SOCKS5 proxies, SOCKS5 with a user name and
// password) and its routes, so a VPN applies. The SOCKS5 user name and
// password come from the app's environment, else from what the person typed
// once in the app (electron/proxy-credentials.mjs). The server and the bot
// get a coarse reason for a failure; the detail stays in the local activity
// log.
//
// Never reachable from elsewhere: no port is opened here. The person's own
// option "local network only" is applied on this side too.
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";

export const TUNNEL = { OPEN: 1, OPENED: 2, FAILED: 3, DATA: 4, END: 5 };
const MAX_STREAMS = 256;
const PAUSE_ABOVE = 4 * 1024 * 1024;

export function tunnelMessage(type, stream, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(5);
  header[0] = type;
  header.writeUInt32BE(stream >>> 0, 1);
  return Buffer.concat([header, Buffer.from(payload)]);
}

const PRIVATE_V4 = [[0x0a000000, 8], [0xac100000, 12], [0xc0a80000, 16], [0x64400000, 10]];
const v4 = address => address.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
const inV4 = (address, [base, bits]) => ((v4(address) & ((~0 << (32 - bits)) >>> 0)) >>> 0) === base;

/** A local-network address (RFC 1918, CGNAT/VPN overlays, IPv6 ULA). */
export function isLanAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return PRIVATE_V4.some(range => inV4(address, range));
  if (family === 6) return /^f[cd][0-9a-f]{2}:/i.test(address);
  return false;
}

/** Addresses no bot reaches through this computer: this computer itself
 * (its own services), link-local (cloud metadata) and the unspecified,
 * multicast and broadcast ranges. */
export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    // 168.63.129.16 is the Azure host endpoint (WireServer / IMDS), which
    // sits outside 169.254/16. Link-local metadata is already in that range.
    if (address === "168.63.129.16") return true;
    return [[0x7f000000, 8], [0xa9fe0000, 16], [0x00000000, 8], [0xe0000000, 4], [0xf0000000, 4]].some(range => inV4(address, range));
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (/^fe[89ab][0-9a-f]:/.test(lower) || lower.startsWith("ff")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    return mapped ? isBlockedAddress(mapped[1]) : false;
  }
  return true;
}

/** Whether this computer opens host:port for a bot, given the person's
 * network option. Resolves names with this computer's own resolver (its
 * VPN's DNS included). */
export async function tunnelVerdict(host, port, network, lookup = dns.lookup, { proxied = false } = {}) {
  if (typeof host !== "string" || !host || host.length > 253 || !Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, code: "bad", message: "Invalid destination" };
  if (/^localhost\.?$|\.localhost\.?$/i.test(host) || /^metadata\.google\.internal\.?$/i.test(host)) return { ok: false, code: "blocked", message: "This computer's own services and link-local addresses are not reachable through it" };
  let addresses;
  try {
    addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map(entry => entry.address);
  } catch {
    addresses = [];
  }
  if (!addresses.length) {
    // A name this computer cannot resolve is refused, including when a proxy
    // would resolve it. CONNECT and SOCKS are pinned to an address we already
    // checked, so an unresolved name must not be handed to the proxy.
    void proxied;
    return { ok: false, code: "unresolved", message: `${host} could not be resolved on this computer` };
  }
  if (addresses.some(isBlockedAddress)) return { ok: false, code: "blocked", message: "This computer's own services and link-local addresses are not reachable through it" };
  if (network === "lan" && !addresses.every(isLanAddress)) return { ok: false, code: "outside-lan", message: "Outside this computer's local network" };
  return { ok: true, address: addresses[0] };
}

/** Parse the operating system's proxy answer for one destination (a PAC
 * result, as Electron's session.resolveProxy gives it: "DIRECT",
 * "PROXY host:port; SOCKS5 host:port; DIRECT", ...) into the routes to try,
 * in order. An empty or unreadable answer is direct. SOCKS is SOCKS4a and
 * SOCKS5 (Chromium's meaning of the PAC keywords). */
export function proxyChain(answer) {
  const chain = [];
  for (const part of String(answer ?? "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (/^DIRECT$/i.test(trimmed)) { chain.push({ type: "direct" }); continue; }
    const match = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(\[[0-9a-f:.]+\]|[^\s:[\]]+):(\d{1,5})$/i.exec(trimmed);
    if (!match) continue;
    const port = Number(match[3]);
    if (port < 1 || port > 65535) continue;
    const keyword = match[1].toUpperCase();
    const type = keyword === "HTTPS" ? "https" : keyword === "SOCKS5" ? "socks5" : keyword.startsWith("SOCKS") ? "socks4" : "http";
    chain.push({ type, host: match[2].replace(/^\[|\]$/g, ""), port });
  }
  return chain.length ? chain : [{ type: "direct" }];
}

/** The proxy credentials named in the environment (ALL_PROXY, SOCKS_PROXY,
 * ... as socks5://user:password@host:port), for the SOCKS proxy the system
 * settings name. The operating system's own proxy passwords are not read:
 * an app started from Finder, the Dock or the Start menu has no such
 * variables, and the person is asked instead (proxy-credentials.mjs). */
export function proxyCredentialsFromEnv(env = process.env) {
  const entries = [];
  for (const key of ["SOCKS5_PROXY", "socks5_proxy", "SOCKS_PROXY", "socks_proxy", "ALL_PROXY", "all_proxy"]) {
    const value = env[key];
    if (!value) continue;
    try {
      const url = new URL(value);
      if (!/^socks(4a?|5h?)?:$/i.test(url.protocol) || !url.username) continue;
      entries.push({ host: url.hostname.replace(/^\[|\]$/g, "").toLowerCase(), port: Number(url.port || 1080), username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) });
    } catch { /* not a URL */ }
  }
  return ({ host, port }) => {
    const found = entries.find(entry => entry.host === String(host).toLowerCase() && entry.port === port);
    return found ? { username: found.username, password: found.password, source: "env" } : null;
  };
}

/** Read a proxy's answer piece by piece, then leave whatever follows on the
 * socket for the stream. */
function proxyReader(socket, timeoutMs = 15_000) {
  let buffered = Buffer.alloc(0);
  let waiting = null;
  let failed = null;
  const settle = () => {
    if (!waiting) return;
    const size = waiting.size(buffered);
    if (size !== null) {
      const { resolve } = waiting; waiting = null;
      const piece = buffered.subarray(0, size); buffered = buffered.subarray(size);
      resolve(piece);
    } else if (failed) { const { reject } = waiting; waiting = null; reject(failed); }
  };
  const onData = chunk => { buffered = Buffer.concat([buffered, chunk]); if (buffered.length > 65_536) failed ??= new Error("proxy answer too long"); settle(); };
  const onEnd = () => { failed ??= new Error("the system proxy closed the connection"); settle(); };
  const onError = error => { failed ??= error; settle(); };
  const timer = setTimeout(() => { failed ??= new Error("the system proxy did not answer in time"); settle(); }, timeoutMs);
  socket.on("data", onData); socket.on("end", onEnd); socket.on("close", onEnd); socket.on("error", onError);
  const take = size => new Promise((resolve, reject) => { waiting = { size, resolve, reject }; settle(); });
  return {
    /** Exactly `count` bytes. */
    read: count => take(data => data.length >= count ? count : null),
    /** An HTTP answer's head, through its blank line. */
    head: () => take(data => { const end = data.indexOf("\r\n\r\n"); return end >= 0 ? end + 4 : null; }),
    done() {
      clearTimeout(timer);
      socket.off("data", onData); socket.off("end", onEnd); socket.off("close", onEnd); socket.off("error", onError);
      // Paused until the stream's own reader takes over: nothing is lost.
      socket.pause();
      if (buffered.length) socket.unshift(buffered);
      buffered = Buffer.alloc(0);
    },
  };
}

/** The 16 bytes of an IPv6 address (net.isIP already said it is one). */
export function ipv6Bytes(address) {
  const text = address.toLowerCase().replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) => `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`);
  const [left, right] = text.split("::");
  const head = left ? left.split(":") : [];
  const tail = right === undefined ? [] : right ? right.split(":") : [];
  const groups = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  return Buffer.from(groups.flatMap(group => { const value = parseInt(group, 16); return [value >> 8, value & 255]; }));
}

function socksAddress(host) {
  const family = net.isIP(host);
  if (family === 4) return Buffer.from([1, ...host.split(".").map(Number)]);
  if (family === 6) return Buffer.concat([Buffer.from([4]), ipv6Bytes(host)]);
  const name = Buffer.from(host, "utf8");
  if (name.length > 255) throw new Error("Destination name too long for the SOCKS proxy");
  return Buffer.concat([Buffer.from([3, name.length]), name]);
}

/** An error that says why, in a code the tunnel turns into a coarse reason. */
const proxyError = (message, code) => Object.assign(new Error(message), { code });

const SOCKS5_REPLIES = { 1: "general failure", 2: "not allowed by its rules", 3: "network unreachable", 4: "host unreachable", 5: "connection refused", 6: "time out", 7: "command not supported", 8: "address type not supported" };

/** SOCKS5 (RFC 1928) CONNECT, with user name and password (RFC 1929) when
 * the proxy asks. Both methods are always offered, so a proxy that wants a
 * password says so (code "proxy-auth") even when none is known yet. */
export async function socks5Connect(socket, host, port, credentials) {
  const reader = proxyReader(socket);
  try {
    socket.write(Buffer.from([5, 2, 0x00, 0x02]));
    const [version, method] = await reader.read(2);
    if (version !== 5) throw new Error("the system proxy is not a SOCKS5 proxy");
    if (method === 0x02 && !credentials) {
      throw proxyError("the system SOCKS proxy asks for a user name and password", "proxy-auth");
    } else if (method === 0x02) {
      const user = Buffer.from(credentials.username ?? "", "utf8");
      const pass = Buffer.from(credentials.password ?? "", "utf8");
      if (user.length > 255 || pass.length > 255) throw new Error("SOCKS user name or password too long");
      socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
      const [, status] = await reader.read(2);
      if (status !== 0) throw proxyError("the system SOCKS proxy refused the user name and password", "proxy-auth-refused");
    } else if (method === 0xff) {
      throw new Error("the system SOCKS proxy accepts none of the offered sign-in methods");
    } else if (method !== 0x00) {
      throw new Error("the system SOCKS proxy asks for an unsupported sign-in method");
    }
    socket.write(Buffer.concat([Buffer.from([5, 1, 0]), socksAddress(host), Buffer.from([port >> 8, port & 255])]));
    const [replyVersion, reply, , type] = await reader.read(4);
    if (replyVersion !== 5) throw new Error("the system SOCKS proxy answered badly");
    if (reply !== 0) throw new Error(`the system SOCKS proxy refused the connection (${SOCKS5_REPLIES[reply] ?? `code ${reply}`})`);
    const length = type === 1 ? 4 : type === 4 ? 16 : type === 3 ? (await reader.read(1))[0] : -1;
    if (length < 0) throw new Error("the system SOCKS proxy answered badly");
    await reader.read(length + 2);
  } finally { reader.done(); }
  return socket;
}

/** SOCKS4a CONNECT (the PAC keyword SOCKS). */
export async function socks4Connect(socket, host, port) {
  const reader = proxyReader(socket);
  try {
    const family = net.isIP(host);
    if (family === 6) throw new Error("a SOCKS4 proxy cannot reach an IPv6 address");
    const ip = family === 4 ? host.split(".").map(Number) : [0, 0, 0, 1];
    const name = family === 4 ? Buffer.alloc(0) : Buffer.concat([Buffer.from(host, "utf8"), Buffer.from([0])]);
    socket.write(Buffer.concat([Buffer.from([4, 1, port >> 8, port & 255, ...ip, 0]), name]));
    const answer = await reader.read(8);
    if (answer[1] !== 0x5a) throw new Error("the system SOCKS proxy refused the connection");
  } finally { reader.done(); }
  return socket;
}

/** HTTP CONNECT through an HTTP(S) proxy. */
export async function httpConnect(socket, host, port) {
  const reader = proxyReader(socket);
  try {
    const target = net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    const head = await reader.head();
    if (!/^HTTP\/1\.[01] 2\d\d/.test(head.toString("latin1"))) throw new Error("the system proxy refused the connection");
  } finally { reader.done(); }
  return socket;
}

/** Open host:port the way this computer's settings say for it: each route
 * of the proxy chain in order (HTTP, HTTPS, SOCKS4a or SOCKS5 proxy, or
 * direct to the verified `address`), the first one that connects wins. A
 * proxy that fails never silently turns into a direct connection unless the
 * chain itself lists DIRECT after it.
 *
 * SOCKS5 sign-in: `credentials(route)` gives what is already known (the
 * environment, or what the person saved). When the proxy asks and nothing
 * is known, or a saved password is refused, `askCredentials(route)` asks
 * the person once and the route is tried again on a fresh connection;
 * `credentialsRefused(route, given)` forgets a saved password the proxy
 * refused. Errors from a proxy route carry `proxy: true`. */
export async function openConnection(host, port, address, chain, { connect = defaultConnect, connectTls = defaultConnectTls, credentials = () => null, askCredentials = null, credentialsRefused = () => {} } = {}) {
  let last = null;
  for (const route of chain) {
    let socket = null;
    try {
      if (!address) throw new Error(`${host} could not be resolved on this computer`);
      if (route.type === "direct") {
        return { socket: await connect({ host: address, port }), via: "direct" };
      }
      const proxy = { type: route.type, host: route.host, port: route.port };
      const open = () => route.type === "https" ? connectTls({ host: route.host, port: route.port }) : connect({ host: route.host, port: route.port });
      try {
        socket = await open();
        if (route.type === "socks5") {
          const known = await credentials(proxy);
          try { await socks5Connect(socket, address, port, known); }
          catch (error) {
            if (error.code === "proxy-auth-refused") await credentialsRefused(proxy, known);
            const ask = askCredentials && (error.code === "proxy-auth" || (error.code === "proxy-auth-refused" && known?.source === "saved"));
            if (!ask) throw error;
            socket.destroy(); socket = null;
            const given = await askCredentials(proxy);
            if (!given) throw error;
            socket = await open();
            try { await socks5Connect(socket, address, port, given); }
            catch (again) { if (again.code === "proxy-auth-refused") await credentialsRefused(proxy, given); throw again; }
          }
        } else if (route.type === "socks4") await socks4Connect(socket, address, port);
        else await httpConnect(socket, address, port);
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { proxy: true });
      }
      return { socket, via: `${route.type} ${route.host}:${route.port}` };
    } catch (error) {
      socket?.destroy();
      last = error;
    }
  }
  throw last ?? new Error("No route to the destination");
}

/** What the server, the bot and the audit learn about a failed connection:
 * a coarse reason, never the proxy's address or the local error text (those
 * stay in this computer's activity log). */
export function coarseFailure(error) {
  if (error?.code === "proxy-auth") return "the system proxy needs a user name and password";
  if (error?.code === "proxy-auth-refused") return "the system proxy refused the user name and password";
  if (error?.proxy) return "the system proxy refused the connection or could not be reached";
  return "the destination refused the connection or could not be reached";
}

/** The URL the system's proxy settings (and a PAC file) are asked about. */
export const proxyQueryUrl = (host, port) => {
  const name = net.isIP(host) === 6 ? `[${host}]` : host;
  return port === 80 ? `http://${name}/` : port === 443 ? `https://${name}/` : `https://${name}:${port}/`;
};

function defaultConnect({ host, port }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.once("connect", () => { socket.off("error", reject); resolve(socket); });
    socket.once("error", reject);
  });
}

function defaultConnectTls({ host, port }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host });
    socket.once("secureConnect", () => { socket.off("error", reject); resolve(socket); });
    socket.once("error", reject);
  });
}

/** One tunnel. `WebSocketImpl` is the platform WebSocket (Node's global in
 * Electron's main process), given headers: the session cookie, the origin
 * and the bridge secret. Resolves once open; `closed` settles when it ends. */
export function openDesktopTunnel({ url, headers, network = () => "all", resolveProxy, proxyCredentials = proxyCredentialsFromEnv(), lookup, connect = defaultConnect, connectTls = defaultConnectTls, record = () => {}, WebSocketImpl = globalThis.WebSocket }) {
  const streams = new Map();
  const socket = new WebSocketImpl(url, { headers });
  socket.binaryType = "arraybuffer";
  let closedResolve;
  const closed = new Promise(resolve => { closedResolve = resolve; });
  const send = (type, stream, payload) => { try { socket.send(tunnelMessage(type, stream, payload)); } catch { /* closing */ } };
  const fail = (stream, code, message) => send(TUNNEL.FAILED, stream, Buffer.from(JSON.stringify({ code, message })));
  const ready = new Promise((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("The tunnel was refused"));
  });
  socket.onclose = () => { for (const entry of streams.values()) entry.destroy(); streams.clear(); closedResolve(); };
  socket.onmessage = event => {
    const data = Buffer.from(event.data);
    if (data.length < 5) return;
    const type = data[0];
    const stream = data.readUInt32BE(1);
    const payload = data.subarray(5);
    if (type === TUNNEL.OPEN) {
      let target;
      try { target = JSON.parse(payload.toString("utf8")); } catch { fail(stream, "bad", "Invalid request"); return; }
      if (streams.size >= MAX_STREAMS) { fail(stream, "busy", "Too many connections"); return; }
      void (async () => {
        const valid = typeof target?.host === "string" && Number.isInteger(target?.port);
        // The system's settings for this destination (proxy, PAC file, or
        // direct), asked before anything else.
        // A failed lookup (a PAC file out of reach, a script error) is
        // direct, and the activity log says so.
        let lookupFailed = false;
        const answer = valid && resolveProxy
          ? await Promise.resolve().then(() => resolveProxy(proxyQueryUrl(target.host, target.port))).catch(() => { lookupFailed = true; return "DIRECT"; })
          : "DIRECT";
        const chain = proxyChain(answer);
        const routeNote = via => lookupFailed && via === "direct" ? "direct (system proxy lookup failed)" : via;
        const verdict = await tunnelVerdict(target?.host, target?.port, network(), lookup, { proxied: chain.some(route => route.type !== "direct") });
        if (!verdict.ok) {
          record({ host: String(target?.host ?? ""), port: Number(target?.port) || 0, ok: false, error: verdict.message, ...(lookupFailed ? { via: routeNote("direct") } : {}) });
          fail(stream, verdict.code, verdict.message);
          return;
        }
        let upstream;
        let via;
        try {
          ({ socket: upstream, via } = await openConnection(target.host, target.port, verdict.address, chain, {
            connect, connectTls, credentials: proxyCredentials,
            askCredentials: proxyCredentials?.ask ?? null, credentialsRefused: proxyCredentials?.refused ?? (() => {}),
          }));
        } catch (error) {
          record({ host: target.host, port: target.port, ok: false, error: error.message, via: routeNote(chain.map(route => route.type).join(",")) });
          fail(stream, "refused", `Could not connect to ${target.host}:${target.port} from this computer (${coarseFailure(error)})`);
          return;
        }
        record({ host: target.host, port: target.port, ok: true, via: routeNote(via) });
        streams.set(stream, upstream);
        upstream.on("data", chunk => {
          send(TUNNEL.DATA, stream, chunk);
          if (socket.bufferedAmount > PAUSE_ABOVE) {
            upstream.pause();
            const wait = setInterval(() => { if (socket.bufferedAmount < PAUSE_ABOVE / 2 || socket.readyState !== 1) { clearInterval(wait); upstream.resume(); } }, 50);
          }
        });
        upstream.on("end", () => send(TUNNEL.END, stream));
        upstream.on("close", () => streams.delete(stream));
        upstream.on("error", () => { streams.delete(stream); send(TUNNEL.END, stream); });
        send(TUNNEL.OPENED, stream);
        upstream.resume();
      })();
    } else if (type === TUNNEL.DATA) {
      streams.get(stream)?.write(payload);
    } else if (type === TUNNEL.END) {
      streams.get(stream)?.end();
    }
  };
  return {
    ready, closed,
    close() { try { socket.close(); } catch { /* gone */ } for (const entry of streams.values()) entry.destroy(); streams.clear(); },
  };
}
