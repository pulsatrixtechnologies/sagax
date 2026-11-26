// The organization's engines the console adds to and removes from (#5351,
// Perspicax #2421; owner request of 2026-11-25: "Je devrais pouvoir
// supprimer des model provider et en ajouter"):
//
//   GET  /api/org/admin/engines                    admin
//   POST /api/org/admin/engines/{id}/remove        admin
//   POST /api/org/admin/engines/{id}/key           admin, { key }
//   POST /api/org/admin/engines/{id}/key/remove    admin
//   POST /api/org/admin/engines/{id}/hide          admin
//   POST /api/org/admin/engines/{id}/restore       admin
//
// The rows are the organization-wide engines `GET capabilities` lists (never
// a person's own account or server), each saying what it is:
//
// - `catalog`: an engine this server always carries (server/config.ts
//   instanceConfigs: the subscription engines and the key engines). It is
//   never deleted: `hide` takes it out of the organization's list and of
//   everyone's model menus, `restore` puts it back with what it had
//   (owner decision of 2026-11-25). Hidden is for new choices only
//   (D-20261126-018): a bot already on it keeps its engine and model and
//   runs on it, and neither `hide` nor `restore` moves a bot. The stored
//   `allowedEngines` and the models turned off are not touched.
// - `added`: an account added beside a provider's first one
//   (shared/added-account.ts addedAccount). `remove` takes it away through
//   the removal the instance routes use, its bots moved first.
//
// On a key engine the thing an organization adds and removes is its key:
// `takesKey` says the engine has one place for it in the server's
// configuration, `orgKey` that it is set. The key is never answered, never
// logged and never written in the audit row.
//
// A workspace whose provider settings are managed for it refuses `remove`,
// `key` and `key/remove`: its rows say `removable: false` and `takesKey:
// false`, so the console offers neither. An engine that is not (or no
// longer) here answers `404 engine_not_found`, never the generic
// `not_found` a console reads as a route this server does not have.
import { addedAccount } from "../../shared/added-account.ts";
import { engineKeyTarget } from "../engines/engine-api-keys.ts";
import type { AdminEngine } from "./org-admin-routes.ts";
import { badRequest, fail, objectBody, ok, onlyKeys, type ConsoleAnswer, type ConsoleContext, type ConsoleRoute } from "./org-admin-console.ts";

export interface OrgEngineRow {
  id: string;
  name: string;
  kind: "cloud" | "local";
  installed: boolean;
  auth: AdminEngine["auth"];
  /** The organization's key serves this engine. Never the key. */
  orgKey: boolean;
  source: "catalog" | "added";
  /** `POST engines/{id}/remove` takes it. */
  removable: boolean;
  /** `POST engines/{id}/key` takes a key for it. */
  takesKey: boolean;
  /** The organization hid it: in no menu for a new choice, back with
   * `restore`; a bot already on it keeps it. */
  hidden: boolean;
  /** `POST engines/{id}/hide` takes it (a catalog engine). */
  hideable: boolean;
}

/** One row from what `GET capabilities` says of an engine, its driver and
 * its access (`api` for a key engine). */
export function orgEngineRow(engine: Pick<AdminEngine, "id" | "name" | "kind" | "installed" | "auth" | "orgKey">, driver: string, access: string | undefined, hidden = false): OrgEngineRow {
  // A key engine of the same tool is a key, not an account (removeAddedAccount).
  const added = access !== "api" && addedAccount(engine.id, driver);
  return {
    id: engine.id, name: engine.name, kind: engine.kind, installed: engine.installed, auth: engine.auth,
    orgKey: Boolean(engine.orgKey),
    source: added ? "added" : "catalog",
    removable: added,
    // A key kept in a person's file store belongs to that person on an
    // organization server (engineKeyScope): only a configuration key is
    // the organization's.
    takesKey: engineKeyTarget(engine.id, driver)?.kind === "config",
    hidden: !added && hidden,
    hideable: !added,
  };
}

export type EngineRemoval =
  | { ok: true; moved?: unknown; noEngine?: boolean }
  | { ok: false; status: number; body: { error: string; code?: string } };

export type EngineKeySaved =
  | { ok: true; configured: boolean }
  | { ok: false; status: number; error: string; code?: string };

export interface EnginesDeps {
  /** The organization-wide engines, never a person's own. */
  engines(): OrgEngineRow[];
  /** Why this server takes no change to its providers (a workspace whose
   * models are managed for it), else null. */
  refusal(): string | null;
  /** Removes an added account; its bots move first. */
  remove(id: string): Promise<EngineRemoval>;
  /** Saves (or, with an empty key, clears) the organization's key. */
  setKey(id: string, key: string): Promise<EngineKeySaved>;
  /** Hides a catalog engine from the organization, or puts it back. The
   * list of allowed engines, the models turned off and every bot stay as
   * they are. */
  setHidden(id: string, hidden: boolean): void;
}

/** An engine that is not here: its own code, never the generic `not_found`
 * a console reads as a route this server does not have yet. */
const engineNotFound = (): ConsoleAnswer => fail(404, "engine_not_found", "No such engine.");

const refused = (status: number, message: string, code?: string): ConsoleAnswer =>
  status === 404 ? engineNotFound()
    : fail(status, code ?? (status === 409 ? "conflict" : status === 403 ? "forbidden" : status === 400 ? "bad_request" : "error"), message);

export function enginesRoutes(deps: EnginesDeps): ConsoleRoute[] {
  // A managed workspace takes no removal and no key: its rows offer neither.
  const rows = (): OrgEngineRow[] => (deps.refusal()
    ? deps.engines().map((row) => ({ ...row, removable: false, takesKey: false }))
    : deps.engines());
  const rowOf = (ctx: ConsoleContext): OrgEngineRow | ConsoleAnswer => {
    const managed = deps.refusal();
    if (managed) return fail(403, "forbidden", managed);
    return deps.engines().find((row) => row.id === ctx.params.id) ?? engineNotFound();
  };
  const isRow = (value: OrgEngineRow | ConsoleAnswer): value is OrgEngineRow => typeof (value as OrgEngineRow).source === "string";
  const saveKey = async (ctx: ConsoleContext, key: string): Promise<ConsoleAnswer> => {
    const row = rowOf(ctx);
    if (!isRow(row)) return row;
    if (!row.takesKey) return fail(400, "engine_takes_no_key", "This engine takes no organization key.");
    const saved = await deps.setKey(row.id, key);
    if (!saved.ok) return refused(saved.status, saved.error, saved.code);
    ctx.record({ category: "engine", action: key ? "engines.key.set" : "engines.key.remove", target: { kind: "engine", id: row.id, name: row.name }, before: { orgKey: row.orgKey }, after: { orgKey: saved.configured } });
    return ok({ configured: saved.configured, engines: rows() });
  };
  // As `allowedEngines` in POST settings: the organization's own choice of
  // what it offers, so a managed workspace takes it too.
  const setHidden = (ctx: ConsoleContext, hidden: boolean): ConsoleAnswer => {
    const row = deps.engines().find((candidate) => candidate.id === ctx.params.id);
    if (!row) return engineNotFound();
    if (!row.hideable) return fail(400, "added_engine", "This is an added account. Remove it instead.");
    if (row.hidden !== hidden) {
      deps.setHidden(row.id, hidden);
      ctx.record({ category: "engine", action: hidden ? "engines.hide" : "engines.restore", target: { kind: "engine", id: row.id, name: row.name }, before: { hidden: row.hidden }, after: { hidden } });
    }
    return ok({ ok: true, hidden, engines: rows() });
  };
  return [
    {
      method: "GET",
      path: "engines",
      min: "admin",
      handle() {
        return ok({ engines: rows() });
      },
    },
    {
      method: "POST",
      path: "engines/{id}/remove",
      min: "admin",
      async handle(ctx) {
        const row = rowOf(ctx);
        if (!isRow(row)) return row;
        if (!row.removable) return fail(400, "catalog_engine", "This engine is part of the server's catalog. Hide it instead.");
        const removed = await deps.remove(row.id);
        if (!removed.ok) return refused(removed.status, removed.body.error, removed.body.code);
        ctx.record({ category: "engine", action: "engines.remove", target: { kind: "engine", id: row.id, name: row.name } });
        return ok({ ok: true, ...(removed.moved !== undefined ? { moved: removed.moved } : {}), ...(removed.noEngine !== undefined ? { noEngine: removed.noEngine } : {}), engines: rows() });
      },
    },
    {
      method: "POST",
      path: "engines/{id}/key",
      min: "admin",
      async handle(ctx) {
        const body = objectBody(ctx.body);
        if (!body || onlyKeys(body, ["key"]) || typeof body.key !== "string" || !body.key.trim()) return badRequest("Send { \"key\" }.");
        return saveKey(ctx, body.key);
      },
    },
    {
      method: "POST",
      path: "engines/{id}/key/remove",
      min: "admin",
      handle(ctx) {
        return saveKey(ctx, "");
      },
    },
    {
      method: "POST",
      path: "engines/{id}/hide",
      min: "admin",
      handle(ctx) {
        return setHidden(ctx, true);
      },
    },
    {
      method: "POST",
      path: "engines/{id}/restore",
      min: "admin",
      handle(ctx) {
        return setHidden(ctx, false);
      },
    },
  ];
}
