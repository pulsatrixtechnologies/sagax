// Visible roles, batch 5 (2026-11-05): the bot panel's "Rôles" tab, under
// the `more` hook of server/routes/perspicax-roles.ts.
//
//   GET  /api/bots/:id/roles                  graph (7 days) + missing permissions
//   POST /api/bots/:id/roles/missing/send     { id }  a Sagax message to the
//        organization's admins about one missing permission (never a
//        ConnectWise write); the refusal is marked sent
//
// Every read is the asking person's: the local journal by their principal,
// Perspicax's journal with their own bearer (`/api/v1/me/journal/requests`,
// the caller's own rows), then filtered to this bot's connections and to
// the profiles this person holds (shared/role-graph.ts).
import { PASS } from "./table.ts";
import type { PerspicaxRoleRouteDeps } from "./perspicax-roles.ts";
import type { RoleJournal } from "../perspicax/role-journal.ts";
import {
  ROLE_GRAPH_WINDOW_MS,
  botClientName,
  buildRoleGraph,
  missingPermissions,
  type JournalRequestRow,
  type MissingPermission,
  type RolesTabBody,
} from "../../shared/role-graph.ts";

type More = NonNullable<PerspicaxRoleRouteDeps["more"]>;

/** What the person's own bearer call to Perspicax answered. */
export type JournalCall = { ok: true; body: unknown } | { ok: false };

export interface RoleTabDeps {
  journal: RoleJournal;
  /** GET a Perspicax path with this person's own bearer (PerspicaxMemoryNotesClient.call). */
  perspicaxGet(principalId: string, path: string): Promise<JournalCall>;
  /** Tell the organization's admins (a Sagax message); how many it reached. */
  sendToAdmins(input: { actor: string; botId: string; missing: MissingPermission }): Promise<number> | number;
  now?: () => number;
}

const PAGE_SIZE = 200;
const MAX_PAGES = 5;

/** This person's journal rows of this bot in the window, or null when
 * Perspicax did not answer. */
export async function journalRowsFor(deps: Pick<RoleTabDeps, "perspicaxGet">, input: { actor: string; botId: string; since: number }): Promise<JournalRequestRow[] | null> {
  const rows: JournalRequestRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ client: botClientName(input.botId), from: new Date(input.since).toISOString(), page: String(page), page_size: String(PAGE_SIZE) });
    let answer: JournalCall;
    try { answer = await deps.perspicaxGet(input.actor, `/api/v1/me/journal/requests?${query}`); } catch { return page === 1 ? null : rows; }
    if (!answer.ok) return page === 1 ? null : rows;
    const body = answer.body as { items?: unknown; total?: unknown } | null;
    const items = body && Array.isArray(body.items) ? body.items : null;
    if (!items) return page === 1 ? null : rows;
    for (const item of items) if (item && typeof item === "object" && typeof (item as JournalRequestRow).ts === "string") rows.push(item as JournalRequestRow);
    const total = typeof body!.total === "number" ? body!.total : 0;
    if (items.length < PAGE_SIZE || rows.length >= total) break;
  }
  return rows;
}

export async function rolesTabBody(deps: RoleTabDeps, input: { actor: string; botId: string }): Promise<RolesTabBody> {
  const now = (deps.now ?? Date.now)();
  const since = now - ROLE_GRAPH_WINDOW_MS;
  const roles = deps.journal.rolesOf(input.actor);
  const rows = await journalRowsFor(deps, { actor: input.actor, botId: input.botId, since });
  const local = deps.journal.transitionsFor(input.actor, input.botId, ROLE_GRAPH_WINDOW_MS);
  const graph = buildRoleGraph({ botId: input.botId, roles, rows, local, now });
  const missing = missingPermissions(deps.journal.refusalsFor(input.actor, input.botId));
  return { ...graph, missing };
}

export function createRoleTabRoutes(deps: RoleTabDeps): More {
  return async (ctx, { botId, rest, actor }) => {
    const { req, res, method, json, readBody } = ctx;
    if (rest === "roles") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      return json(res, 200, await rolesTabBody(deps, { actor, botId }));
    }
    if (rest === "roles/missing/send") {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = await readBody(req) as { id?: unknown } | null;
      if (!body || typeof body.id !== "string" || !body.id) return json(res, 400, { error: "id is required" });
      const id = body.id;
      // the person's own refusals for this bot only
      const missing = missingPermissions(deps.journal.refusalsFor(actor, botId)).find((entry) => entry.id === id);
      if (!missing) return json(res, 404, { error: "no such missing permission" });
      const reached = await deps.sendToAdmins({ actor, botId, missing });
      if (!reached) return json(res, 409, { error: "No administrator of this organization can be reached." });
      const record = deps.journal.markSent(actor, id);
      return json(res, 200, { ok: true, reached, sentAt: record?.sentAt ?? (deps.now ?? Date.now)() });
    }
    return PASS;
  };
}

/** Several `more` handlers, tried in order (other batches add their own). */
export function chainRoleRoutes(...handlers: More[]): More {
  return async (ctx, input) => {
    for (const handler of handlers) {
      const answer = await handler(ctx, input);
      if (answer !== PASS) return answer;
    }
    return PASS;
  };
}

