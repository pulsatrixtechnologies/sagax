// A person's custom label (shared/person-label.ts), the people counterpart
// of a bot's label:
//
//   GET /api/people/labels              { labels: { <principalId>: label } }
//                                       every labeled person this server
//                                       lists (the directory's people on an
//                                       organization server, the operator
//                                       on a solo one)
//   PUT /api/people/<principalId>/label { label: string | null }
//                                       set or clear it; null or blank text
//                                       clears
//
// Who may change a label: the person themselves, an organization admin (the
// operator at this computer on a solo server) for anyone, and a team manager
// for the people of a team they manage. Anyone else gets 403
// `person_label_forbidden`. The label is Sagax's own field on the principal,
// never sent to Perspicax. Each change reaches every stream as a
// `person.label` frame; a change made for someone else is audited by the
// caller of `changed`.
import { normalizePersonLabel, PERSON_LABEL_MAX } from "../../shared/person-label.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export type PersonLabelRight = "self" | "admin" | "manager";

export interface PersonLabelCaller {
  /** The person asking; null for the server console or a service. */
  principalId: string | null;
  /** An organization admin, or the operator at this computer. */
  admin: boolean;
  /** The teams the caller manages (Perspicax managers). */
  managedTeamIds: readonly string[];
}

export interface PersonLabelTarget {
  id: string;
  label?: string;
  teams?: readonly { id: string }[];
}

export interface PersonLabelRouteDeps {
  caller(auth: RequestAuth): PersonLabelCaller;
  /** A person this server lists, or null (unknown, merged, not listed). */
  person(principalId: string): PersonLabelTarget | null;
  /** Every listed person's label, by principal id. */
  labels(): Record<string, string>;
  /** Store the normalized label (null clears). False when it could not be written. */
  save(principalId: string, label: string | null): boolean;
  /** After a change: broadcast it, and audit a change made for someone else. */
  changed(change: { principalId: string; before: string | null; after: string | null; right: PersonLabelRight; auth: RequestAuth }): void;
}

const LABEL_PATH = /^\/api\/people\/(pr_[0-9a-f-]{36})\/label$/;

/** Why the caller may change this person's label (the strongest reason),
 * or null when they may not. */
export function personLabelRight(caller: PersonLabelCaller, target: PersonLabelTarget): PersonLabelRight | null {
  if (caller.principalId && caller.principalId.toLowerCase() === target.id.toLowerCase()) return "self";
  if (caller.admin) return "admin";
  const managed = new Set(caller.managedTeamIds);
  if (managed.size && (target.teams ?? []).some((team) => managed.has(team.id))) return "manager";
  return null;
}

export function createPersonLabelRoutes(deps: PersonLabelRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/people/")) return PASS;
    if (path === "/api/people/labels") {
      if (method !== "GET") return PASS;
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { labels: deps.labels() });
    }
    const match = LABEL_PATH.exec(path);
    if (!match || method !== "PUT") return PASS;
    const target = deps.person(match[1]!.toLowerCase());
    if (!target) return json(res, 404, { error: "No such person.", code: "unknown_person" });
    const right = personLabelRight(deps.caller(auth), target);
    if (!right) return json(res, 403, { error: "Only this person, an organization admin or their team manager can change this label.", code: "person_label_forbidden", permission: "people.labelAnyone" });
    const body = await readBody(req).catch(() => undefined);
    if (!body || typeof body !== "object" || Array.isArray(body) || !Object.hasOwn(body, "label") || Object.keys(body).length !== 1) {
      return json(res, 400, { error: "send { label: string | null }", code: "label_type" });
    }
    const normalized = normalizePersonLabel((body as { label: unknown }).label);
    if (!normalized.ok) {
      const error = normalized.code === "label_too_long" ? `A label has at most ${PERSON_LABEL_MAX} characters.` : normalized.code === "label_one_line" ? "A label fits on one line." : "send { label: string | null }";
      return json(res, 400, { error, code: normalized.code });
    }
    const before = target.label ?? null;
    if (before !== normalized.label) {
      if (!deps.save(target.id, normalized.label)) return json(res, 500, { error: "The label could not be saved." });
      deps.changed({ principalId: target.id, before, after: normalized.label, right, auth });
    }
    return json(res, 200, { principalId: target.id, label: normalized.label });
  };
}
