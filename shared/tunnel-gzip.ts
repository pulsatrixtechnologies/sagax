// Port of OpenMausBot #3009, rewritten: gzip large JSON replies on the phone
// tunnel listeners only (the hop up the home connection to Cloudflare). Other
// listeners are untouched. One copy for the harness and the companion.
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { gzip } from "node:zlib";

/** Under this size the framing and a zlib pass cost more than they save. */
export const GZIP_MIN_BYTES = 1024;
const JSON_TYPE = /^application\/json\s*(;|$)/i;
const tunnelReplies = new WeakSet<ServerResponse>();

/** Wrap a tunnel listener's request handler (upgrades never pass here). */
export function gzipTunnelReplies<T>(handle: (req: IncomingMessage, res: ServerResponse) => T) {
  return (req: IncomingMessage, res: ServerResponse): T => {
    tunnelReplies.add(res);
    return handle(req, res);
  };
}

/** Accept-Encoding takes gzip: named or via `*`, q above 0; a named gzip beats `*`. */
export function acceptsGzip(header: string | string[] | undefined): boolean {
  let named: number | undefined;
  let wildcard: number | undefined;
  for (const entry of [header ?? ""].flat().join(",").split(",")) {
    const [coding, ...params] = entry.split(";").map((part) => part.trim().toLowerCase());
    const q = params.find((param) => param.startsWith("q="));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    if (coding === "gzip" || coding === "x-gzip") named = weight;
    else if (coding === "*") wildcard = weight;
  }
  return (named ?? wildcard ?? 0) > 0;
}

/** `vary` with Accept-Encoding added once (`*` already covers it). */
export function varyOnEncoding(vary: number | string | string[] | undefined): string {
  const names = [vary ?? ""].flat().join(",").split(",").map((name) => name.trim()).filter(Boolean);
  if (!names.some((name) => name === "*" || name.toLowerCase() === "accept-encoding")) names.push("Accept-Encoding");
  return names.join(", ");
}

/** A tunnel reply with a JSON body of 1 KB or more that nothing encoded yet. */
export function gzipCandidate(res: ServerResponse, status: number, headers: OutgoingHttpHeaders, body: string): boolean {
  return tunnelReplies.has(res) && res.req.method !== "HEAD" && status !== 204 && status !== 206 && status !== 304
    && headers["content-length"] === undefined && headers["content-range"] === undefined && !res.hasHeader("content-length")
    && JSON_TYPE.test(String(headers["content-type"] ?? "")) && !headers["content-encoding"] && !res.hasHeader("content-encoding")
    && typeof body === "string" && Buffer.byteLength(body) >= GZIP_MIN_BYTES;
}

/** Send a whole JSON `body` (headers carry no content-length), gzipped when the
 * client takes it. False: not a candidate, nothing was sent, reply as before. */
export function sendTunnelJson(res: ServerResponse, status: number, headers: OutgoingHttpHeaders, body: string): boolean {
  if (!gzipCandidate(res, status, headers, body)) return false;
  const vary = varyOnEncoding(headers.vary ?? res.getHeader("vary"));
  if (!acceptsGzip(res.req.headers["accept-encoding"])) {
    res.writeHead(status, { ...headers, vary, "content-length": Buffer.byteLength(body) }).end(body);
    return true;
  }
  res.writeHead(status, { ...headers, vary, "content-encoding": "gzip" });
  gzip(body, (error, zipped) => (error ? res.destroy() : res.end(zipped)));
  return true;
}
