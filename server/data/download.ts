// The guarded https download behind a confined data_load (organization
// server, 2026-10-16).
//
// A confined DuckDB database has no network at all (engine.ts
// confinementStatements): an https source is fetched here by the server and
// read back from the scope's own folder. The URL comes from a model, so it
// takes the media proxy's destination guard (server/media/media-proxy-guard.ts)
// with an EMPTY allow policy: the operator's SAGAX_MEDIA_PROXY_ALLOW_HOSTS
// never widens Data. Every hop is checked (every address its name resolves
// to must be public), the socket connects to the address that was checked
// (a `lookup` hook, so a rebinding DNS cannot answer differently), redirects
// are followed by hand (5 at most) and must stay on https, and the body is
// capped in bytes and in time. Errors name the host only, never the path,
// the query or a token.
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { dirname } from "node:path";

import {
  MediaProxyBlockedError,
  checkMediaDestination,
  parseMediaProxyAllowList,
  type BlockReason,
  type MediaProxyResolver,
  type ResolvedAddress,
} from "../media/media-proxy-guard.ts";
import { DataFailure } from "./types.ts";

/** The largest body a confined load downloads. */
export const DATA_DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024;
/** The whole download, every hop included. */
export const DATA_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
export const DATA_DOWNLOAD_MAX_REDIRECTS = 5;

/** Nothing private is allowed, whatever the media proxy's environment says. */
const DATA_DOWNLOAD_POLICY = parseMediaProxyAllowList("");

const HINT = "On an organization server, Data downloads only from public https addresses (no private network, loopback, link-local or cloud metadata address, no http redirect). Publish the file at a public https address, or put it in this bot's workspace, and load it again.";

/** One response as the download reads it: a status, headers and the body. */
export type DownloadResponse = Readable & { statusCode?: number; headers: IncomingHttpHeaders };

/** Opens one GET to `target`, connected to `address` (already checked). */
export type DownloadTransport = (target: URL, address: ResolvedAddress, signal: AbortSignal) => Promise<DownloadResponse>;

export interface DownloadOptions {
  /** DNS of the guard (tests pass a fake one). */
  resolver?: MediaProxyResolver;
  /** The request itself (tests pass a fake one). Default: node:https pinned to the checked address. */
  transport?: DownloadTransport;
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DownloadResult {
  bytes: number;
}

const refusal = (message: string, extra: { retryable?: boolean } = {}) =>
  new DataFailure({ code: "source_unsupported", message, hint: HINT, ...extra });

function blockedMessage(reason: BlockReason, host: string): string {
  switch (reason) {
    case "scheme": return `Only https addresses can be downloaded on an organization server (${host}).`;
    case "port": return `The address ${host} uses a port other than 443; Data downloads only from standard https ports.`;
    case "unresolved": return `The address ${host} could not be resolved.`;
    case "too-many-redirects": return `The download from ${host} redirected more than ${DATA_DOWNLOAD_MAX_REDIRECTS} times.`;
    default: return `The address ${host} is not on the public internet (${reason}); Data does not download from it.`;
  }
}

/** The socket's DNS answer is the address the guard checked, and only it. */
export function pinnedLookup(pinned: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) (callback as unknown as (error: null, addresses: ResolvedAddress[]) => void)(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
}

/** One https GET, connected to the checked address. TLS still verifies the
 * certificate against the URL's host name. */
export const httpsDownloadTransport: DownloadTransport = (target, address, signal) =>
  new Promise<DownloadResponse>((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port || 443,
        path: target.pathname + target.search,
        method: "GET",
        headers: { accept: "*/*", "accept-encoding": "identity", "user-agent": "Sagax-Data" },
        agent: false,
        lookup: pinnedLookup(address),
        signal,
      },
      (response) => resolve(response as DownloadResponse),
    );
    req.on("error", reject);
    req.end();
  });

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Downloads `source` (https only) into `destination`, through the guard.
 * Throws DataFailure: source_unsupported for a refused destination, a
 * redirect off https or to a non-public address, a body over the cap;
 * source_not_found for a 404 or 410; timeout or cancelled.
 */
export async function downloadGuarded(source: string, destination: string, options: DownloadOptions = {}): Promise<DownloadResult> {
  const maxBytes = options.maxBytes ?? DATA_DOWNLOAD_MAX_BYTES;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DATA_DOWNLOAD_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const transport = options.transport ?? httpsDownloadTransport;
  let current: URL;
  try {
    current = new URL(source);
  } catch {
    throw refusal("That is not a valid https address.");
  }
  let host = current.hostname;
  try {
    for (let hop = 0; ; hop++) {
      host = current.hostname;
      if (current.protocol !== "https:") throw refusal(blockedMessage("scheme", host));
      let pinned: ResolvedAddress;
      try {
        pinned = await checkMediaDestination(current, DATA_DOWNLOAD_POLICY, options.resolver);
      } catch (error) {
        if (error instanceof MediaProxyBlockedError) throw refusal(blockedMessage(error.reason, error.host));
        throw error;
      }
      signal.throwIfAborted();
      const response = await transport(current, pinned, signal);
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && status !== 304) {
        response.resume();
        const location = headerValue(response.headers.location);
        if (!location) throw refusal(`The server at ${host} answered a redirect without a destination.`);
        if (hop >= DATA_DOWNLOAD_MAX_REDIRECTS) throw refusal(blockedMessage("too-many-redirects", host));
        try {
          current = new URL(location, current);
        } catch {
          throw refusal(`The server at ${host} redirected to an address that is not valid.`);
        }
        continue;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        if (status === 404 || status === 410) throw new DataFailure({ code: "source_not_found", message: `The server at ${host} answered HTTP ${status}.` });
        throw refusal(`The server at ${host} answered HTTP ${status}.`, status >= 500 || status === 429 ? { retryable: true } : {});
      }
      const declared = Number(headerValue(response.headers["content-length"]));
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy();
        throw tooLarge(host, maxBytes);
      }
      let bytes = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > maxBytes) callback(tooLarge(host, maxBytes));
          else callback(null, chunk);
        },
      });
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      try {
        await pipeline(response, counter, createWriteStream(destination, { mode: 0o600 }), { signal });
      } catch (error) {
        await rm(destination, { force: true });
        throw error;
      }
      return { bytes };
    }
  } catch (error) {
    if (error instanceof DataFailure) throw error;
    if (options.signal?.aborted) throw new DataFailure({ code: "cancelled", message: "The download was cancelled." });
    if (timeout.aborted) throw new DataFailure({ code: "timeout", message: `The download from ${host} took too long.`, retryable: true });
    // A network or TLS failure: its text may echo the URL, so only the host goes out.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    throw refusal(`The download from ${host} failed${typeof code === "string" && /^[A-Z_]+$/.test(code) ? ` (${code})` : ""}.`, { retryable: true });
  }
}

function tooLarge(host: string, maxBytes: number): DataFailure {
  return new DataFailure({
    code: "source_unsupported",
    message: `The file at ${host} is larger than ${Math.round(maxBytes / 1024 / 1024)} MiB, the most Data downloads on an organization server.`,
    hint: "Load a smaller extract, or put the file in this bot's workspace and load it from there.",
  });
}
