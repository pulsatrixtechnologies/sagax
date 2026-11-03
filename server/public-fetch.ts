// Fetch that does not follow a redirect until the target is a public address,
// then connects to the address that check resolved. The first request is
// unchanged: a probe of 127.0.0.1 in a test still runs. Only a Location is
// re-checked. 301/302/303 become GET. 307/308 keep the method and body.

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { isPublicDomainAddress } from "./custom-domain.ts";
import { personalMcpHostRefusal } from "./people/person-connections.ts";

const MAX_HOPS = 3;
const REDIRECT = new Set([301, 302, 303, 307, 308]);

export async function guardedFetch(input: Parameters<typeof fetch>[0], init: RequestInit = {}, inner: typeof fetch = fetch): Promise<Response> {
  const first = await inner(input, { ...init, redirect: "manual" });
  if (!REDIRECT.has(first.status)) return first;
  const location = first.headers.get("location");
  await first.body?.cancel().catch(() => undefined);
  if (!location) throw new Error("Too many redirects.");
  return followRedirect(new URL(location, requestUrl(input)), init, first.status, 1);
}

async function followRedirect(next: URL, init: RequestInit, status: number, hops: number): Promise<Response> {
  if (hops > MAX_HOPS) throw new Error("Too many redirects.");
  if (next.protocol !== "http:" && next.protocol !== "https:") throw new Error("That address is not valid.");
  const refusal = await personalMcpHostRefusal(next.href);
  if (refusal) throw new Error(refusal);
  const pinned = await pinPublicAddress(next.hostname);
  const becomeGet = status === 301 || status === 302 || status === 303;
  const nextInit: RequestInit = becomeGet ? { ...init, method: "GET", body: undefined } : init;
  const response = await pinnedRequest(next, nextInit, pinned);
  if (!REDIRECT.has(response.status)) return response;
  const location = response.headers.get("location");
  if (!location) throw new Error("Too many redirects.");
  return followRedirect(new URL(location, next), nextInit, response.status, hops + 1);
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function pinPublicAddress(hostname: string): Promise<string> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
  const pinned = addresses.find((address) => isPublicDomainAddress(address));
  if (!pinned) throw new Error("A personal MCP server must be on the public internet: this address is private to the server's network.");
  return pinned;
}

function headerRecord(headers: RequestInit["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const pairs = headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [key, value] of pairs) out[key] = String(value);
  return out;
}

function bodyBuffer(body: RequestInit["body"]): Buffer | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  throw new Error("This redirect cannot be followed.");
}

function pinnedRequest(url: URL, init: RequestInit, address: string): Promise<Response> {
  const family = isIP(address) === 6 ? 6 : 4;
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const method = init.method ?? "GET";
  const payload = method === "GET" || method === "HEAD" ? undefined : bodyBuffer(init.body);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method,
      headers: headerRecord(init.headers),
      agent: false,
      lookup: (_hostname, options, callback) => {
        const done = typeof options === "function" ? options : callback;
        if (options && typeof options === "object" && options.all) done(null, [{ address, family }]);
        else done(null, address, family);
      },
      signal: init.signal ?? undefined,
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("error", reject);
      incoming.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value === undefined) continue;
          if (Array.isArray(value)) for (const item of value) headers.append(key, item);
          else headers.set(key, value);
        }
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 502, headers }));
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
