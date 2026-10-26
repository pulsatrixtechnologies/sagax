// The harness's own MCP servers (built-in browser, cloud computer, Data)
// over MCP streamable HTTP, for an engine that connects to an HTTP server
// itself. Before, each of them was a Node process per server and per session
// (harness-mcp-proxy, about 21 MB each) whose only job was to turn stdio
// frames into one POST to /api/internal/<kind>/mcp. This route answers the
// same frames with the same function (harnessMcpRequest), so the engine
// talks to the harness directly and nothing is spawned.
//
// Same guarantees as the stdio proxy, on purpose:
// - The turn's capability rides the Authorization header (never the URL).
//   Every tools/list and tools/call is forwarded with that bearer to the
//   unchanged /api/internal/<kind>/mcp route, so the capability check, the
//   bot and thread scope, the confidential gate, the browser navigation
//   refusals and the approvals are the very same code.
// - initialize and ping are answered here, without a capability, as the
//   proxy answered them; a failure is a JSON-RPC result (HTTP 200), never an
//   HTTP 401: an engine reads a 401 from an MCP URL as "sign in to this
//   server" and drops it for the rest of the session.
// - Same limits: 1 MiB per request, 16 pending requests per bearer, 130 s
//   per forwarded call, 16 MiB per answer (harnessMcpRequest).
import type { IncomingMessage, ServerResponse } from "node:http";

import type { RemoteMcpSpec, StdioMcpSpec } from "./contracts.ts";
import { harnessMcpRequest, type HarnessMcpKind } from "./harness-mcp-proxy.ts";

const MAX_INPUT_BYTES = 1_048_576;
const MAX_PENDING = 16;
const PATH = /^\/api\/internal\/(browser|computer|data)\/mcp-http$/;
/** Versions this route speaks. Tools only, so every one answers the same. */
export const HARNESS_MCP_HTTP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export function harnessMcpHttpPath(kind: HarnessMcpKind): string {
  return `/api/internal/${kind}/mcp-http`;
}

/** The kind a request path names, or null when it is not this route. */
export function harnessMcpHttpKind(path: string): HarnessMcpKind | null {
  const match = PATH.exec(path);
  return match ? match[1] as HarnessMcpKind : null;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The streamable HTTP form of a harness-mcp-proxy stdio spec, or null when
 * the spec is anything else (then the engine keeps the stdio server). The
 * proxy's own env names the harness URL and the bearer; the bearer goes in
 * a header, like any remote server's credential. SAGAX_HARNESS_MCP_HTTP=0
 * keeps every engine on the stdio proxy. */
export function harnessMcpHttpSpec(spec: StdioMcpSpec | undefined, kind: HarnessMcpKind, env: NodeJS.ProcessEnv = process.env): RemoteMcpSpec | null {
  if (env.SAGAX_HARNESS_MCP_HTTP === "0" || !spec) return null;
  const script = spec.args?.[0] ?? "";
  if (!/(^|[\\/])harness-mcp-proxy(\.[cm]?[jt]s)?$/.test(script) || spec.args.at(-1) !== kind || spec.args.length !== 2) return null;
  const token = spec.env?.SAGAX_MCP_TOKEN ?? "";
  const base = spec.env?.SAGAX_HARNESS_URL ?? "";
  let url: URL;
  try { url = new URL(base); } catch { return null; }
  if (!token || /[\s\r\n]/.test(token) || url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
  return { type: "http", url: new URL(harnessMcpHttpPath(kind), url).href, headers: { Authorization: `Bearer ${token}` } };
}

const pending = new Map<string, number>();

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(text);
}

async function readLimited(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_INPUT_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** One request on /api/internal/<kind>/mcp-http. `harnessUrl` is the
 * loopback base the stdio proxy was given (SAGAX_HARNESS_URL). */
export async function serveHarnessMcpHttp(req: IncomingMessage, res: ServerResponse, kind: HarnessMcpKind, harnessUrl: string): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  // No server-to-client stream and no session to end: the spec's answer
  // for both is 405.
  if (method !== "POST") return send(res, 405, undefined, { allow: "POST" });
  const header = req.headers.authorization;
  const match = typeof header === "string" ? /^Bearer ([^\s]+)$/.exec(header) : null;
  if (!match) return send(res, 401, { error: "unauthorized" });
  const token = match[1]!;
  const raw = await readLimited(req);
  if (raw === null) return send(res, 413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request exceeded the size limit." } });
  let frame: unknown;
  try { frame = JSON.parse(raw.toString("utf8")); }
  catch { return send(res, 200, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }); }
  const count = pending.get(token) ?? 0;
  if (count >= MAX_PENDING) {
    const request = frame as { id?: unknown; method?: unknown } | null;
    if (!request || typeof request !== "object" || !Object.hasOwn(request, "id")) return send(res, 202);
    const id = request.id ?? null;
    return send(res, 200, request.method === "tools/call"
      ? { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Too many pending ${kind} requests.` }], isError: true } }
      : { jsonrpc: "2.0", id, error: { code: -32603, message: `Too many pending ${kind} requests.` } });
  }
  pending.set(token, count + 1);
  // A tool call can outlast an engine's HTTP request timeout (Claude Code
  // gives up on an HTTP MCP request after 60 s, where its stdio servers had
  // no limit and browser calls take up to 130 s). When the client sent a
  // progress token, the answer is an event stream that reports progress
  // every 15 s and ends with the result, which keeps the request alive.
  // Without a progress token the stream still carries a comment line every
  // 15 s, so no byte-idle timeout cuts a long call either.
  const call = isToolCall(frame);
  const progressToken = callProgressToken(frame);
  let ticker: NodeJS.Timeout | undefined;
  if (call) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    let progress = 0;
    ticker = setInterval(() => {
      progress += 1;
      if (res.writableEnded) return;
      res.write(progressToken !== undefined
        ? sseEvent({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken, progress } })
        : ": still working\n\n");
    }, PROGRESS_EVERY_MS);
    ticker.unref?.();
    res.once("close", () => clearInterval(ticker));
  }
  let reply: unknown;
  try {
    reply = await harnessMcpRequest(frame, { url: harnessUrl, token, kind }, { protocolVersions: HARNESS_MCP_HTTP_VERSIONS });
  } finally {
    if (ticker) clearInterval(ticker);
    const left = (pending.get(token) ?? 1) - 1;
    if (left > 0) pending.set(token, left);
    else pending.delete(token);
  }
  if (call) {
    if (!res.writableEnded) res.end(sseEvent(reply));
    return;
  }
  // A notification gets no answer: 202 with no body.
  if (reply === undefined) return send(res, 202);
  return send(res, 200, reply);
}

const PROGRESS_EVERY_MS = 15_000;

function sseEvent(message: unknown): string {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

/** A tools/call request (it has an id): answered as an event stream. */
function isToolCall(frame: unknown): boolean {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return false;
  const message = frame as { method?: unknown; id?: unknown };
  return message.method === "tools/call" && message.id !== undefined && message.id !== null;
}

/** The progress token of a tools/call request, when it carries one. */
function callProgressToken(frame: unknown): string | number | undefined {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return undefined;
  const message = frame as { method?: unknown; id?: unknown; params?: { _meta?: { progressToken?: unknown } } };
  if (message.method !== "tools/call" || message.id === undefined || message.id === null) return undefined;
  const token = message.params?._meta?.progressToken;
  return typeof token === "string" || (typeof token === "number" && Number.isFinite(token)) ? token : undefined;
}

/** NO_PROXY entries an engine needs to reach the harness on loopback when
 * its environment names an HTTP proxy (the stdio proxy ran in Node, whose
 * fetch ignores HTTP_PROXY; an engine's own HTTP client may not). Empty
 * when no proxy is set or loopback is already excluded. */
export function loopbackNoProxy(env: Record<string, string | undefined>): Record<string, string> {
  if (!env.HTTP_PROXY && !env.http_proxy && !env.HTTPS_PROXY && !env.https_proxy) return {};
  const current = env.NO_PROXY ?? env.no_proxy ?? "";
  const entries = current.split(",").map((entry) => entry.trim()).filter(Boolean);
  const missing = ["127.0.0.1", "localhost", "::1"].filter((host) => !entries.includes(host));
  if (!missing.length) return {};
  const value = [...entries, ...missing].join(",");
  return { NO_PROXY: value, no_proxy: value };
}
