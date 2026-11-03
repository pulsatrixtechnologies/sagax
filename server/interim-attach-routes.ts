// "People from before Perspicax" (slice 8): on an organization server that
// was used before it signed in with Pulsatrix, an organization admin
// attaches each interim person (known by an address) to the Perspicax person
// who is them. Never automatic: Perspicax lets people edit their own
// addresses, so a matching address is only a suggestion. One time, audited,
// inside a window (30 days from the first organization start that found
// interim people; an admin can shorten or close it, at most 90).
//
//   GET  /api/org/interim-people          { until, people: [...] }
//   POST /api/org/interim-people/attach   { interimPrincipalId, principalId }
import type { Principal } from "./auth/principals.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export const INTERIM_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export interface InterimWindow { since: number; days: number }

/** When the window closes (ms), or null when it never opened or is closed. */
export function interimWindowUntil(window: InterimWindow | undefined, now: number): number | null {
  if (!window) return null;
  const until = window.since + window.days * DAY_MS;
  return now < until ? until : null;
}

/** The window after an admin sets it to `days` (0..90, counted from when
 * it opened; 0 closes it now). */
export function windowWithDays(window: InterimWindow | undefined, days: number, now: number): InterimWindow {
  return { since: window?.since ?? now, days };
}

export interface DirectoryPerson { principalId: string; name: string; login: string; email?: string; disabled: boolean }

/** The one active directory person carrying this address, or null when
 * none or several do (the admin picks). */
export function suggestedPerson(email: string | undefined, people: readonly DirectoryPerson[]): { principalId: string; name: string; login: string } | null {
  const key = email?.trim().toLowerCase();
  if (!key) return null;
  const matches = people.filter((person) => !person.disabled && person.email?.trim().toLowerCase() === key);
  if (matches.length !== 1) return null;
  const { principalId, name, login } = matches[0]!;
  return { principalId, name, login };
}

export interface AttachOutcome {
  rewritten: { bots: number; grants: number; rooms: number; sections: number; routines: number };
  sessionsRevoked: number;
}

export interface InterimAttachRouteDeps {
  isAdmin(auth: RequestAuth): boolean;
  window(): InterimWindow | undefined;
  now?: () => number;
  interim(): Principal[];
  byId(id: string): Principal | null;
  /** A Perspicax person of this server's issuer. */
  isTarget(principal: Principal): boolean;
  directory(): DirectoryPerson[];
  counts(principalId: string): { bots: number; rooms: number; routines: number };
  /** Rewrite every ref, mark merged, revoke sessions, audit. */
  attach(input: { from: string; to: string; auth: RequestAuth }): AttachOutcome;
}

const closed = { error: "The time to attach people from before Perspicax is over.", code: "interim_attach_closed" };

export function createInterimAttachRoutes(deps: InterimAttachRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/org/interim-people" && path !== "/api/org/interim-people/attach") return PASS;
    res.setHeader("cache-control", "no-store");
    if ((path === "/api/org/interim-people" && method !== "GET") || (path.endsWith("/attach") && method !== "POST")) {
      return json(res, 405, { error: "method not allowed" });
    }
    if (!deps.isAdmin(auth)) return json(res, 403, { error: "Only an organization admin can attach people.", code: "forbidden" });
    const until = interimWindowUntil(deps.window(), now());
    if (until === null) return json(res, 410, closed);
    if (method === "GET") {
      const directory = deps.directory();
      return json(res, 200, {
        until,
        people: deps.interim().map((person) => ({
          principalId: person.id,
          email: person.email ?? "",
          ...deps.counts(person.id),
          suggested: suggestedPerson(person.email, directory),
        })),
      });
    }
    const body = await readBody(req) as Record<string, unknown> | null;
    const from = typeof body?.interimPrincipalId === "string" ? body.interimPrincipalId.trim() : "";
    const to = typeof body?.principalId === "string" ? body.principalId.trim() : "";
    const source = from ? deps.byId(from) : null;
    const target = to ? deps.byId(to) : null;
    if (!source || !target) return json(res, 404, { error: "No such person.", code: "unknown_person" });
    if (source.subject || source.local || source.mergedInto) return json(res, 400, { error: "That person is not from before Perspicax.", code: "not_interim" });
    if (!deps.isTarget(target) || target.disabledAt !== undefined || target.local || target.mergedInto) {
      return json(res, 400, { error: "Attach to an active Perspicax person of this organization.", code: "bad_target" });
    }
    const outcome = deps.attach({ from: source.id, to: target.id, auth });
    return json(res, 200, { attached: { from: source.id, to: target.id }, ...outcome });
  };
}
