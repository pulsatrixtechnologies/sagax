// Imported first by server/index.ts: no request from this server reaches the
// original OpenMausBot services, the upstream author's repositories or an
// analytics host (electron/upstream-hosts.mjs holds the list). Covers fetch
// and node:http(s) request/get; refused before any socket opens.
import http from "node:http";
import https from "node:https";

import { BlockedHostError, installFetchGuard, isBlockedHost, reportBlocked } from "../../electron/upstream-hosts.mjs";

type RequestFn = typeof http.request;

function targetHost(args: unknown[]): string {
  const [first, second] = args;
  if (typeof first === "string" || first instanceof URL) {
    try {
      return new URL(String(first)).hostname;
    } catch {
      return "";
    }
  }
  const options = (first ?? second) as { hostname?: string | null; host?: string | null } | undefined;
  return String(options?.hostname ?? options?.host ?? "").replace(/:\d+$/, "");
}

function guardRequest<T extends RequestFn>(original: T): T {
  if ((original as { sagaxGuarded?: boolean }).sagaxGuarded) return original;
  const guarded = function (this: unknown, ...args: unknown[]) {
    const host = targetHost(args);
    if (host && isBlockedHost(host)) {
      reportBlocked(`https://${host}/`);
      throw new BlockedHostError(`https://${host}/`);
    }
    return (original as (...a: unknown[]) => unknown).apply(this, args);
  } as unknown as T;
  Object.defineProperty(guarded, "sagaxGuarded", { value: true });
  return guarded;
}

export function installNetworkGuard(): void {
  installFetchGuard(globalThis);
  http.request = guardRequest(http.request);
  http.get = guardRequest(http.get as RequestFn) as typeof http.get;
  https.request = guardRequest(https.request);
  https.get = guardRequest(https.get as RequestFn) as typeof https.get;
}

installNetworkGuard();
