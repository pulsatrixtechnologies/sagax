// The organization's engines the console adds to and removes from (#5351,
// Perspicax #2421; owner request of 2026-11-25: "Je devrais pouvoir
// supprimer des model provider et en ajouter"):
//
//   GET  /api/org/admin/engines                    admin
//   POST /api/org/admin/engines/{id}/remove        admin
//   POST /api/org/admin/engines/{id}/key           admin, { key }
//   POST /api/org/admin/engines/{id}/key/remove    admin
//
// The rows are the organization-wide engines `GET capabilities` lists (never
// a person's own account or server), each saying what it is:
//
// - `catalog`: an engine this server always carries (server/config.ts
//   instanceConfigs: the subscription engines and the key engines). What
//   removing one means is not decided, so `remove` refuses it here; the
//   organization turns it off in its list of allowed engines.
// - `added`: an account added beside a provider's first one
//   (shared/added-account.ts addedAccount). `remove` takes it away through
//   the removal the instance routes use, its bots moved first.
//
// On a key engine the thing an organization adds and removes is its key:
// `takesKey` says the engine has one place for it in the server's
// configuration, `orgKey` that it is set. The key is never answered, never
// logged and never written in the audit row.
import { addedAccount } from "../../shared/added-account.ts";
import { engineKeyTarget } from "../engines/engine-api-keys.ts";
import type { AdminEngine } from "./org-admin-routes.ts";
import { badRequest, fail, notFound, objectBody, ok, onlyKeys, type ConsoleAnswer, type ConsoleContext, type ConsoleRoute } from "./org-admin-console.ts";

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
}

/** One row from what `GET capabilities` says of an engine, its driver and
 * its access (`api` for a key engine). */
export function orgEngineRow(engine: Pick<AdminEngine, "id" | "name" | "kind" | "installed" | "auth" | "orgKey">, driver: string, access: string | undefined): OrgEngineRow {
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
}

const refused = (status: number, message: string, code?: string): ConsoleAnswer =>
  fail(status, code ?? (status === 409 ? "conflict" : status === 404 ? "not_found" : status === 403 ? "forbidden" : status === 400 ? "bad_request" : "error"), message);

export function enginesRoutes(deps: EnginesDeps): ConsoleRoute[] {
  const rowOf = (ctx: ConsoleContext): OrgEngineRow | ConsoleAnswer => {
    const managed = deps.refusal();
    if (managed) return fail(403, "forbidden", managed);
    return deps.engines().find((row) => row.id === ctx.params.id) ?? notFound("No such engine.");
  };
  const isRow = (value: OrgEngineRow | ConsoleAnswer): value is OrgEngineRow => typeof (value as OrgEngineRow).source === "string";
  const saveKey = async (ctx: ConsoleContext, key: string): Promise<ConsoleAnswer> => {
    const row = rowOf(ctx);
    if (!isRow(row)) return row;
    if (!row.takesKey) return fail(400, "engine_takes_no_key", "This engine takes no organization key.");
    const saved = await deps.setKey(row.id, key);
    if (!saved.ok) return refused(saved.status, saved.error, saved.code);
    ctx.record({ category: "engine", action: key ? "engines.key.set" : "engines.key.remove", target: { kind: "engine", id: row.id, name: row.name }, before: { orgKey: row.orgKey }, after: { orgKey: saved.configured } });
    return ok({ configured: saved.configured, engines: deps.engines() });
  };
  return [
    {
      method: "GET",
      path: "engines",
      min: "admin",
      handle() {
        return ok({ engines: deps.engines() });
      },
    },
    {
      method: "POST",
      path: "engines/{id}/remove",
      min: "admin",
      async handle(ctx) {
        const row = rowOf(ctx);
        if (!isRow(row)) return row;
        if (!row.removable) return fail(400, "catalog_engine", "This engine is part of the server's catalog. Turn it off in the list of allowed providers.");
        const removed = await deps.remove(row.id);
        if (!removed.ok) return refused(removed.status, removed.body.error, removed.body.code);
        ctx.record({ category: "engine", action: "engines.remove", target: { kind: "engine", id: row.id, name: row.name } });
        return ok({ ok: true, ...(removed.moved !== undefined ? { moved: removed.moved } : {}), ...(removed.noEngine !== undefined ? { noEngine: removed.noEngine } : {}), engines: deps.engines() });
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
  ];
}
