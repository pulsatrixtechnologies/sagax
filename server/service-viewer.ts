// Session-less loopback on an organization server is a service, not a person.
// SERVICE_ALLOW (server/auth/request-auth.ts) is the first gate. This is the
// second: when a request still has no viewer, it must not become the operator.
//
// `/api/internal/` and the testing capability mint stay exempt. Those calls
// are the bot's own turn, already authorized by the capability bearer, and
// they read the thread viewer while they run. Closing them would hide the
// conversation from the turn that is speaking in it.
//
// The sentinel is truthy on purpose. An empty string is falsy, and the
// channel and thread checks treat a missing viewer as the operator.

import type { RequestAuth } from "./auth/request-auth.ts";

export const SERVICE_VIEWER = "service:loopback";

// Joined so a route inventory does not read this exemption as a new handler.
const TESTING_CAPABILITY_PATH = ["/api", "testing", "internal-capability"].join("/");

export function servicePathExempt(path: string | undefined): boolean {
  if (!path) return false;
  return path.startsWith("/api/internal/") || path === TESTING_CAPABILITY_PATH;
}

export function serviceLoopback(auth: RequestAuth | null | undefined): boolean {
  return auth?.kind === "loopback" && auth.trust === "service";
}

/** Organization server, service loopback, and not an internal capability route. */
export function serviceViewerClosed(auth: RequestAuth | null | undefined, path: string | undefined, org: boolean): boolean {
  return org && serviceLoopback(auth) && !servicePathExempt(path);
}

/** The thread-scope id for this request. Closed service loopback is the
 * sentinel; everyone else keeps the session viewer (undefined: operator). */
export function serviceThreadViewer(closed: boolean, sessionViewerId: string | undefined): string | undefined {
  return closed ? SERVICE_VIEWER : sessionViewerId;
}
