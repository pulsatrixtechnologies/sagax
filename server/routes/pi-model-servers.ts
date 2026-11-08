// #2983: a person's own model servers for pi (server/pi-own-model-servers.ts).
//
// GET    /api/me/pi-model-servers             { servers: [...] } (no key, only `configured`)
// POST   /api/me/pi-model-servers             { name, url, key? }  saved, then tested
// PATCH  /api/me/pi-model-servers/:id         { name?, url?, key? } ("" removes the key); tested again on a new address or key
// DELETE /api/me/pi-model-servers/:id
// POST   /api/me/pi-model-servers/:id/test    asks the server for its models again
//
// Each caller reaches only their own list: solo, the server's; on an
// organization server, the signed-in member's. Another person's id answers 404.
import { z } from "zod";
import type { RequestAuth } from "../auth/request-auth.ts";
import { serverUrl } from "../openai-compat-servers.ts";
import {
  MAX_OWN_SERVERS,
  newOwnServerId,
  ownServerView,
  type OwnModelServer,
  type OwnServerScope,
  type PiOwnModelServersStore,
  type ProbeResult,
} from "../pi-own-model-servers.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PiModelServerRouteDeps {
  /** The caller's own scope; null when they have none (unsigned on an organization server). */
  scope(auth: RequestAuth): OwnServerScope | null;
  store: PiOwnModelServersStore;
  probe(url: string, key: string | undefined): Promise<ProbeResult>;
  /** After a change: the picker of this caller lists the new models. */
  changed?(scope: OwnServerScope): void;
  now?(): Date;
}

const PATH = /^\/api\/me\/pi-model-servers(?:\/(sx-[a-f0-9]{10})(\/test)?)?$/;
const name = z.string().trim().min(1).max(80);
const address = z.string().trim().max(500).refine(serverUrl);
const key = z.string().trim().max(4096).refine((value) => !/\s/.test(value));
const addSchema = z.object({ name, url: address, key: key.optional() }).strict();
const editSchema = z.object({ name: name.optional(), url: address.optional(), key: key.optional() }).strict()
  .refine((body) => Object.keys(body).length > 0);
const ADDRESS_ERROR = "Name the server (up to 80 characters) and give its address: https, or http on this machine or a private network.";

export function createPiModelServerRoutes(deps: PiModelServerRouteDeps): RouteHandler {
  const queues = new Map<string, Promise<unknown>>();
  // one change at a time per person: a test and an edit never overwrite each other
  const serial = <T>(scope: OwnServerScope, work: () => Promise<T>): Promise<T> => {
    const id = scope.principalId ?? "";
    const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(id, next);
    void next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {});
    return next;
  };
  const tested = async (server: OwnModelServer): Promise<{ server: OwnModelServer; test: ProbeResult }> => {
    const test = await deps.probe(server.url, server.key);
    if (!test.ok) return { server, test };
    return { server: { ...server, models: test.models, checkedAt: (deps.now?.() ?? new Date()).toISOString() }, test };
  };
  const answer = (test?: ProbeResult) => (test ? { test: test.ok ? { ok: true, models: test.models.length } : { ok: false, error: test.error } } : {});

  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = PATH.exec(path);
    if (!match) return PASS;
    const [, id, testPath] = match;
    const allowed = id === undefined ? method === "GET" || method === "POST" : testPath ? method === "POST" : method === "PATCH" || method === "DELETE";
    if (!allowed) return json(res, 405, { error: "method not allowed" });
    const scope = deps.scope(auth);
    if (!scope) return json(res, 403, { error: "Sign in to manage your model servers.", code: "sign_in_required" });
    if ((method === "POST" && !testPath) || method === "PATCH") {
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
    }
    const body = (method === "POST" && !testPath) || method === "PATCH" ? await readBody(req, 16_384) : undefined;
    try {
      if (method === "GET") return json(res, 200, { servers: deps.store.list(scope).map(ownServerView) });
      return await serial(scope, async () => {
        const servers = deps.store.list(scope);
        if (id === undefined) {
          const parsed = addSchema.safeParse(body);
          if (!parsed.success) return json(res, 400, { error: ADDRESS_ERROR });
          if (servers.length >= MAX_OWN_SERVERS) return json(res, 409, { error: `Up to ${MAX_OWN_SERVERS} model servers. Remove one first.` });
          const fresh: OwnModelServer = {
            id: newOwnServerId(),
            name: parsed.data.name,
            url: parsed.data.url.replace(/\/+$/, ""),
            ...(parsed.data.key ? { key: parsed.data.key } : {}),
            models: [],
          };
          const { server, test } = await tested(fresh);
          deps.store.save(scope, [...deps.store.list(scope), server]);
          deps.changed?.(scope);
          return json(res, 201, { server: ownServerView(server), ...answer(test) });
        }
        const current = servers.find((server) => server.id === id);
        if (!current) return json(res, 404, { error: "unknown server" });
        if (method === "DELETE") {
          deps.store.save(scope, servers.filter((server) => server.id !== id));
          deps.changed?.(scope);
          return json(res, 200, { ok: true });
        }
        let next: OwnModelServer = current;
        let test: ProbeResult | undefined;
        if (method === "PATCH") {
          const parsed = editSchema.safeParse(body);
          if (!parsed.success) return json(res, 400, { error: ADDRESS_ERROR });
          const { name: newName, url, key: newKey } = parsed.data;
          next = { ...current, ...(newName ? { name: newName } : {}), ...(url ? { url: url.replace(/\/+$/, "") } : {}) };
          if (newKey !== undefined) {
            if (newKey) next.key = newKey;
            else delete next.key;
          }
          if (next.url !== current.url || next.key !== current.key) ({ server: next, test } = await tested(next));
        } else {
          ({ server: next, test } = await tested(current));
        }
        // the list as it is now: a removal while the test ran is kept
        const latest = deps.store.list(scope);
        if (!latest.some((server) => server.id === id)) return json(res, 404, { error: "unknown server" });
        deps.store.save(scope, latest.map((server) => (server.id === id ? next : server)));
        deps.changed?.(scope);
        return json(res, 200, { server: ownServerView(next), ...answer(test) });
      });
    } catch (error) {
      const status = (error as { status?: number }).status === 503 ? 503 : 500;
      return json(res, status, { error: status === 503 ? (error as Error).message : "Your model servers could not be changed." });
    }
  };
}
