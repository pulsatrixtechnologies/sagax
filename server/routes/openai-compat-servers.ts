// Named OpenAI-compatible servers (2026-10-30, server/openai-compat-servers.ts):
// each one an engine of its own, its key write-only.
//
// POST /api/instances/openai-compat-servers           { displayName, url, key?, model? }
// PATCH /api/instances/openai-compat-servers/:id      { displayName?, url?, key? } ("" removes the key)
// DELETE /api/instances/openai-compat-servers/:id
//
// An address the server connects to: on an organization server, an
// organization admin's only (`allowed`).
import type { AppConfig } from "../config.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  addCompatServer,
  editCompatServer,
  editCompatServerSchema,
  newCompatServerSchema,
  removeCompatServer,
} from "../openai-compat-servers.ts";
import { PASS, type RouteHandler } from "./table.ts";

type Instances = NonNullable<AppConfig["instances"]>;
type Keys = NonNullable<AppConfig["openaiCompatServers"]>;

export interface OpenAiCompatServerRouteDeps {
  /** May this caller change the servers (an organization admin on an organization server). */
  allowed(auth: RequestAuth): boolean;
  /** The provider instances as they would be saved now. */
  instances(): Instances;
  /** The saved keys of the named servers. */
  keys(): AppConfig["openaiCompatServers"];
  /** Saves the keys, then the instance map, and applies the one instance. */
  persist(instanceId: string, instances: Instances, keys: Keys): Promise<void>;
  /** A bot, a thread, the default model or a turn uses this engine. */
  inUse(instanceId: string): boolean;
  /** Every provider instance, as GET /api/instances describes them for this caller. */
  describe(auth: RequestAuth): Promise<unknown>;
  /** Runs `work` while no other provider-settings change runs; null when one already is. */
  exclusive<T>(work: () => Promise<T>): Promise<T> | null;
}

const PATH = /^\/api\/instances\/openai-compat-servers(?:\/([\w.-]+))?$/;

export function createOpenAiCompatServerRoutes(deps: OpenAiCompatServerRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = PATH.exec(path);
    if (!match || (method !== "POST" && method !== "PATCH" && method !== "DELETE")) return PASS;
    if (method !== "DELETE" && !String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    if (!deps.allowed(auth)) {
      return json(res, 403, { error: "Only an organization admin can change an address the server connects to.", code: "admin_only_field", field: "openaiCompatServers" });
    }
    const targetId = match[1];
    if ((method === "POST") !== (targetId === undefined)) return json(res, 404, { error: "not found" });
    const body = method === "DELETE" ? undefined : await readBody(req, 8192);
    const answered = deps.exclusive(async () => {
      let next: { instanceId: string; instances: Instances; keys: Keys } | null;
      if (method === "POST") {
        const parsed = newCompatServerSchema.safeParse(body);
        if (!parsed.success) return json(res, 400, { error: "Name the server (up to 80 characters) and give its address: https, or http on this machine or a private network." });
        next = addCompatServer(deps.instances(), deps.keys(), parsed.data);
      } else if (method === "PATCH") {
        const parsed = editCompatServerSchema.safeParse(body);
        if (!parsed.success) return json(res, 400, { error: "Send a new name, address or key." });
        const edited = editCompatServer(deps.instances(), deps.keys(), targetId!, parsed.data);
        next = edited && { instanceId: targetId!, ...edited };
      } else {
        const removed = removeCompatServer(deps.instances(), deps.keys(), targetId!);
        if (removed && deps.inUse(targetId!)) {
          return json(res, 409, { error: "Choose another model for the bots and default model using this server before removing it." });
        }
        next = removed && { instanceId: targetId!, ...removed };
      }
      if (!next) return json(res, 404, { error: "unknown server" });
      await deps.persist(next.instanceId, next.instances, next.keys);
      return json(res, method === "POST" ? 201 : 200, { instanceId: next.instanceId, instances: await deps.describe(auth) });
    });
    if (!answered) return json(res, 409, { error: "provider settings are already being updated" });
    return answered;
  };
}
