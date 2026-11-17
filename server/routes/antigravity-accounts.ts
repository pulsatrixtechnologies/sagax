// Add another Google account to Antigravity: a new personal Antigravity provider
// that shares only the source provider's runtime and gets its own Google profile.
//
// POST /api/instances/antigravity-accounts, body { displayName, sourceInstanceId }.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClaudeAccountSchema } from "../engines/claude-accounts.ts";
import type { InstanceConfigMap } from "../contracts.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface AntigravityAccountRouteDeps {
  /** The provider instances as they would be saved now. */
  instances(): InstanceConfigMap;
  /** Saves the map with this new instance and applies it. */
  persist(instanceId: string, instances: InstanceConfigMap): Promise<void>;
  /** #4435: who the new account belongs to (a person on an organization server), else null. */
  ownerPrincipalId(auth: RequestAuth): string | null;
  /** The provider instances this caller sees, as GET /api/instances lists them. */
  describe(auth: RequestAuth): Promise<unknown>;
  /** Runs `work` while no other provider-settings change runs; null when one already is. */
  exclusive<T>(work: () => Promise<T>): Promise<T> | null;
}

const addAccount = createClaudeAccountSchema.pick({ displayName: true }).extend({ sourceInstanceId: z.string().min(1).max(200) });

export function createAntigravityAccountRoutes(deps: AntigravityAccountRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method !== "POST" || path !== "/api/instances/antigravity-accounts") return PASS;
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return json(res, 415, { error: "content-type must be application/json" });
    const parsed = addAccount.safeParse(await readBody(req, 8192));
    if (!parsed.success) return json(res, 400, { error: "Enter an account name (up to 80 characters) and select an Antigravity provider." });
    const answered = deps.exclusive(async () => {
      const instances = deps.instances();
      const source = instances[parsed.data.sourceInstanceId];
      if (source?.driver !== "antigravityAgent") return json(res, 400, { error: "Select a personal Antigravity provider." });
      const owner = deps.ownerPrincipalId(auth);
      // #4435: another person's account is not a source this caller sees
      if (source.ownerPrincipalId?.trim() && source.ownerPrincipalId.trim().toLowerCase() !== owner) return json(res, 400, { error: "Select a personal Antigravity provider." });
      const instanceId = `antigravity-${randomUUID()}`;
      const cli = (source.config as { cli?: unknown } | undefined)?.cli;
      // Only share the runtime. Each instance gets its own Google profile.
      instances[instanceId] = { driver: "antigravityAgent", displayName: parsed.data.displayName, ...(owner ? { ownerPrincipalId: owner } : {}),
        config: typeof cli === "string" && cli ? { cli } : {} };
      await deps.persist(instanceId, instances);
      return json(res, 201, { instanceId, instances: await deps.describe(auth) });
    });
    if (!answered) return json(res, 409, { error: "provider settings are already being updated" });
    return answered;
  };
}
