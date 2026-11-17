// A section the app shows before its server has the route behind it: a newer
// app against an older server. That server answers a route it does not know
// with "no route: METHOD /path" (404). A member's session on that server is
// refused by the gate as admin-only (403: code "admin_route" since #4471,
// "lacks the admin scope" before; never a handler's own refusal), because
// the route was not yet
// on its member list. Neither is a failure the person can fix: the section
// says it arrives with the server update, never a red error.
//
// api() already swaps the "no route" text for the neutral line
// (src/lib/no-route.ts), so the server's own words are read from the body.
import { isNoRouteText } from "@/lib/no-route";
import { noteServerFeature } from "@/lib/server-features";
import type { ServerFeature } from "../../shared/server-features";

/** An ApiError (src/state/store.tsx), read by its shape so this file needs
 * no store import. */
type ServerError = Error & { status: number; body?: Record<string, unknown> };

function isServerError(error: unknown): error is ServerError {
  return error instanceof Error && typeof Reflect.get(error, "status") === "number";
}

export function routeMissingOnServer(error: unknown): boolean {
  if (!isServerError(error)) return false;
  const said = typeof error.body?.error === "string" ? error.body.error : error.message;
  if (error.status === 404) return isNoRouteText(said) || isNoRouteText(error.message);
  if (error.status === 403) return error.body?.code === "admin_route" || /lacks the admin scope/.test(said) || /lacks the admin scope/.test(error.message);
  return false;
}

/** routeMissingOnServer, and the feature is marked missing for every
 * surface that offers it. */
export function featureMissingOnServer(feature: ServerFeature, error: unknown): boolean {
  if (!routeMissingOnServer(error)) return false;
  noteServerFeature(feature, false);
  return true;
}
