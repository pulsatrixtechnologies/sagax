// HTTP plumbing shared by server/index.ts and the route modules under
// server/routes/. Pure helpers only: nothing here reads harness state, so a
// route module can import them directly.
import type { IncomingMessage, ServerResponse } from "node:http";

import { sendTunnelJson } from "./tunnel-gzip.ts";

export { gzipTunnelReplies } from "./tunnel-gzip.ts";

const jsonHooks = new WeakMap<ServerResponse, (body: unknown) => unknown>();
const parsedBodies = new WeakMap<IncomingMessage, unknown>();

/** Pass every JSON body sent on this response through `hook` first (it may
 * return a narrowed copy). Set once a request is authenticated: index.ts
 * narrows what a member is sent and notes what an admin change answered.
 * Hooks added later run after earlier ones. */
export function onJsonBody(res: ServerResponse, hook: (body: unknown) => unknown): void {
  const previous = jsonHooks.get(res);
  jsonHooks.set(res, previous ? (body) => hook(previous(body)) : hook);
}

/** The JSON body readBody parsed for this request, if it read one. */
export function parsedBodyOf(req: IncomingMessage): unknown {
  return parsedBodies.get(req);
}

export function json(res: ServerResponse, status: number, body: unknown) {
  const hook = jsonHooks.get(res);
  const data = JSON.stringify(hook ? hook(body) : body);
  const headers = { "content-type": "application/json" };
  if (sendTunnelJson(res, status, headers, data)) return;
  // A reply already started (stream, earlier json()) cannot take a second
  // writeHead: throwing ERR_HTTP_HEADERS_SENT here crashed the server (#3216).
  if (res.headersSent || res.writableEnded) {
    console.error(`[request] dropped a ${status} JSON reply: the response was already started`);
    return;
  }
  res.writeHead(status, headers);
  res.end(data);
}

/** Bodies at or above this size yield before JSON.parse / zod (#1750). */
export const BODY_YIELD_BYTES = 32_768;

/** Give the event loop a turn (heartbeats, SSE, other requests). */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Cheap upper bound on a parsed JSON value's UTF-8 size. */
export function estimateJsonBytes(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") return Buffer.byteLength(value);
  if (typeof value === "number" || typeof value === "boolean") return 24;
  if (Array.isArray(value)) {
    let total = 2;
    for (const entry of value) total += estimateJsonBytes(entry) + 1;
    return total;
  }
  if (typeof value === "object") {
    let total = 2;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      total += Buffer.byteLength(key) + estimateJsonBytes(entry) + 4;
    }
    return total;
  }
  return 0;
}

type SafeParseResult<T> = { success: true; data: T } | { success: false; error: unknown };

/** Zod-compatible parse that yields first when the value is large, so a
 * multi-hundred-KB body does not finish JSON.parse and zod on the same
 * busy tick as the rest of the route (#1750). */
export async function safeParseYielding<T>(
  schema: { safeParse: (value: unknown) => SafeParseResult<T> },
  value: unknown,
  yieldOverBytes: number = BODY_YIELD_BYTES,
): Promise<SafeParseResult<T>> {
  if (estimateJsonBytes(value) >= yieldOverBytes) await yieldToEventLoop();
  return schema.safeParse(value);
}

export function readBody(req: IncomingMessage, limit = 1_000_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let done = false;
    const fail = (status: number, msg: string) => {
      if (done) return;
      done = true;
      const err = Object.assign(new Error(msg), { status });
      reject(err);
    };
    req.on("data", (c) => {
      if (done) return;
      bytes += typeof c === "string" ? Buffer.byteLength(c) : c.length;
      if (bytes > limit) {
        // Keep draining the socket, but stop retaining attacker-controlled
        // bytes. Destroying the request here prevents the caller from
        // receiving the useful 413 response.
        return fail(413, "body too large");
      }
      chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    });
    req.on("end", () => {
      if (done) return;
      // Decode once, after the last chunk: a character split across two
      // chunks turns into U+FFFD when each chunk is decoded on its own.
      const finish = (data: string) => {
        let body: any;
        try {
          body = data ? JSON.parse(data) : {};
        } catch {
          return fail(400, "invalid JSON body");
        }
        done = true;
        parsedBodies.set(req, body);
        resolve(body);
      };
      const data = Buffer.concat(chunks).toString("utf8");
      // Large bodies: yield before JSON.parse so heartbeats and other
      // requests get a turn (#1750).
      if (bytes >= BODY_YIELD_BYTES) {
        setImmediate(() => {
          if (done) return;
          finish(data);
        });
        return;
      }
      finish(data);
    });
    req.on("error", (e) => fail(400, e instanceof Error ? e.message : String(e)));
  });
}
