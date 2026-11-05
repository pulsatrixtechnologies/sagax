// Visible roles, batch 3 (2026-11-05): the composer's role picker.
//
//   GET /api/bots/:id/roles/held?threadId=...
//       the roles the SIGNED-IN PERSON holds now, from a live identity_switch
//       with no argument (never a listing kept from another turn or person),
//       and `current`, the role the live connection of that thread acts as.
//
// Mounted through the `more` hook of server/routes/perspicax-roles.ts, which
// already checked the bot and resolved the actor. The person is always the
// request's own: no query or body field names someone else.
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteContext } from "./table.ts";
import type { HeldRole, RoleCan } from "../../shared/perspicax-roles.ts";

/** One picker row as the client gets it: no profile id (never shown). */
export interface HeldRoleRow {
  slug: string;
  name: string;
  readOnly: boolean;
  explicitOnly: boolean;
  reachable: boolean;
  can?: RoleCan;
}

export interface HeldRolesAnswer {
  /** Whether this bot's turn mounts the Perspicax account connection for
   * this person: the picker shows only then. */
  available: boolean;
  roles: HeldRoleRow[];
  /** The role the live connection of that thread acts as ("" = Moi). */
  current?: string;
}

export interface HeldRolesRouteDeps {
  /** The person's principal as a turn names it, or undefined. */
  principal(auth: RequestAuth, botId: string): string | undefined;
  /** The thread the person may write in (else 404), or undefined. */
  thread(auth: RequestAuth, botId: string, threadId: string): string | undefined;
  /** Whether the bot's engine for that thread mounts custom MCP servers. */
  mounts(botId: string, threadId: string): boolean;
  heldRolesFor(principal: string, botId: string, threadId: string, signal: AbortSignal): Promise<{ roles: HeldRole[]; current?: string } | null>;
}

export function heldRoleRows(roles: readonly HeldRole[]): HeldRoleRow[] {
  return roles.map((role) => ({
    slug: role.slug, name: role.name, readOnly: role.readOnly, explicitOnly: role.explicitOnly, reachable: role.reachable,
    ...(role.can ? { can: role.can } : {}),
  }));
}

/** The `perspicaxRole` of a send: a slug ("" = Moi) or undefined when the
 * person picked nothing. Anything else is ignored, never an error. */
export function perspicaxRoleOf(body: unknown): string | undefined {
  const value = body && typeof body === "object" ? (body as { perspicaxRole?: unknown }).perspicaxRole : undefined;
  if (typeof value !== "string") return undefined;
  const slug = value.trim();
  return slug.length <= 120 && /^[\w.:-]*$/.test(slug) ? slug : undefined;
}

export function createHeldRolesRoute(deps: HeldRolesRouteDeps) {
  return async (ctx: RouteContext, input: { botId: string; rest: string }): Promise<typeof PASS | void> => {
    if (input.rest !== "roles/held") return PASS;
    const { res, json, method, url, auth } = ctx;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    res.setHeader("cache-control", "no-store");
    const asked = url.searchParams.get("threadId") ?? "";
    if (!/^[\w-]+$/.test(asked)) return json(res, 400, { error: "threadId is required" });
    const threadId = deps.thread(auth, input.botId, asked);
    if (!threadId) return json(res, 404, { error: "no such conversation" });
    const principal = deps.principal(auth, input.botId);
    const none: HeldRolesAnswer = { available: false, roles: [] };
    if (!principal || !deps.mounts(input.botId, threadId)) return json(res, 200, none);
    let held: Awaited<ReturnType<HeldRolesRouteDeps["heldRolesFor"]>>;
    try {
      held = await deps.heldRolesFor(principal, input.botId, threadId, AbortSignal.timeout(8_000));
    } catch {
      return json(res, 503, { error: "Perspicax did not answer; try again." });
    }
    if (!held) return json(res, 200, none);
    const answer: HeldRolesAnswer = { available: true, roles: heldRoleRows(held.roles), ...(held.current !== undefined ? { current: held.current } : {}) };
    return json(res, 200, answer);
  };
}
