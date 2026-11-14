import type { PersonalProviderServer } from "../../shared/provider-accounts.ts";
import { PERSONAL_VOICE_KEY_PROVIDERS, isPersonalVoiceKeyProvider } from "../../shared/person-voice-keys.ts";
import { ProviderAccountsError, type ProviderAccountOwner, type ProviderAccounts } from "../engines/provider-accounts.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { providerCatalog, type CatalogBotsLink, type CatalogInstance } from "../../shared/provider-catalog.ts";
import { azureOpenAIEndpoint } from "../../shared/azure-openai.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createProviderAccountsRoutes(deps: {
  accounts: ProviderAccounts;
  /** Undefined is solo; null is a session without a personal identity. */
  owner(auth: RequestAuth): ProviderAccountOwner | null | undefined;
  beforeChange?(): unknown;
  changed?(before: unknown, owner: ProviderAccountOwner | undefined): Promise<void>;
  listed?(view: import("../../shared/provider-accounts.ts").ProviderAccountsView, owner: ProviderAccountOwner | undefined): Promise<void>;
  /** GET /api/me/providers/catalog (#4329): the engines this caller sees
   * (the same list as GET /api/instances) and their link to their bots in
   * the xAI group's bot app. */
  catalog?: {
    /** GET /api/instances rows (InstanceInfo), read as CatalogInstance. */
    instances(auth: RequestAuth): Promise<readonly unknown[]>;
    botsLink?(auth: RequestAuth): CatalogBotsLink | null;
    /** The server's engine instance map (server/config.ts instanceConfigs,
     * workspace address defaults merged), to tell an Azure resource. */
    instanceConfigs?(): Readonly<Record<string, { driver: string; config?: unknown }>>;
  };
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const legacyVoice = path === "/api/me/voice-keys" || path.startsWith("/api/me/voice-keys/");
    if (!legacyVoice && path !== "/api/me/providers" && !path.startsWith("/api/me/providers/")) return PASS;
    res.setHeader("cache-control", "no-store");
    const owner = deps.owner(auth);
    if (owner === null) return json(res, 403, { error: "Sign in to manage your provider accounts." });
    const before = method === "PUT" || method === "DELETE" ? deps.beforeChange?.() : undefined;
    const changed = async <T>(work: Promise<T>): Promise<T> => {
      const value = await work;
      await deps.changed?.(before, owner);
      return value;
    };
    try {
      if (legacyVoice) {
        if (!owner) return json(res, 404, { error: "Your voice keys are managed with Providers." });
        const provider = path.slice("/api/me/voice-keys/".length);
        let view;
        if (path === "/api/me/voice-keys" && method === "GET") view = await deps.accounts.list(owner);
        else if (isPersonalVoiceKeyProvider(provider) && (method === "PUT" || method === "DELETE")) {
          const body = method === "DELETE" ? null : await readBody(req).catch(() => undefined);
          const value = method === "DELETE" ? null : (body as { key?: unknown } | undefined)?.key;
          if (value !== null && typeof value !== "string") return json(res, 400, { error: "Send { key }." });
          view = await changed(deps.accounts.setKey(owner, provider, value === null ? null : value.trim()));
        } else return PASS;
        return json(res, 200, Object.fromEntries(PERSONAL_VOICE_KEY_PROVIDERS.map((name) => {
          const key = view.keys.find((entry) => entry.provider === name);
          return [name, { configured: Boolean(key), last4: key?.last4 ?? null }];
        })));
      }
      if (path === "/api/me/providers/catalog" && method === "GET") {
        if (!deps.catalog) return PASS;
        // one list by provider for the phone and for bots: the servers'
        // protocols come from the person's accounts, never an address
        const [instances, view] = await Promise.all([deps.catalog.instances(auth), deps.accounts.list(owner).catch(() => null)]);
        return json(res, 200, providerCatalog({
          instances: instances as readonly CatalogInstance[], place: owner ? "organization" : "solo",
          servers: view?.servers.map((server) => ({
            instanceId: server.instanceId, protocol: server.protocol,
            azure: server.protocol === "openai" && azureOpenAIEndpoint(server.url) !== null,
          })) ?? [],
          azureInstances: azureAddressInstances(deps.catalog.instanceConfigs?.() ?? {}),
          botsLink: deps.catalog.botsLink?.(auth) ?? null,
        }));
      }
      if (path === "/api/me/providers" && method === "GET") {
        const view = await deps.accounts.list(owner);
        await deps.listed?.(view, owner);
        return json(res, 200, view);
      }
      const key = path.match(/^\/api\/me\/providers\/keys\/([^/]+)$/);
      const server = path.match(/^\/api\/me\/providers\/servers\/([^/]+)$/);
      const id = key?.[1] ?? server?.[1];
      if (!id || (method !== "PUT" && method !== "DELETE")) return PASS;
      let decoded: string;
      try { decoded = decodeURIComponent(id); } catch { return json(res, 400, { error: "Invalid provider identifier." }); }
      const body = method === "DELETE" ? null : await readBody(req).catch(() => undefined);
      if (method === "PUT" && (!body || typeof body !== "object" || Array.isArray(body))) return json(res, 400, { error: "Send the provider account details." });
      if (key) {
        const value = method === "DELETE" ? null : (body as { key?: unknown }).key;
        if (value !== null && typeof value !== "string") return json(res, 400, { error: "Send { key }." });
        return json(res, 200, await changed(deps.accounts.setKey(owner, decoded, value === null ? null : value.trim())));
      }
      return json(res, 200, await changed(deps.accounts.setServer(owner, decoded, body as PersonalProviderServer | null)));
    } catch (error) {
      if (error instanceof ProviderAccountsError) return json(res, error.status, { error: error.message, ...(error.code ? { code: error.code } : {}) });
      return json(res, 503, { error: "Your provider accounts are unavailable. Try again." });
    }
  };
}

/** The address instances whose address is an Azure resource, read as the
 * OpenAI protocol driver reads it (server/drivers/openai-compat.ts): not the
 * OpenAI catalogue instance, not an Anthropic protocol address. */
export function azureAddressInstances(configs: Readonly<Record<string, { driver: string; config?: unknown }>>): string[] {
  return Object.entries(configs).filter(([, entry]) => {
    if (entry.driver !== "openai-compat") return false;
    const config = (entry.config && typeof entry.config === "object" ? entry.config : {}) as { url?: unknown; catalog?: unknown; protocol?: unknown };
    if (config.catalog === "openai" || config.protocol === "anthropic") return false;
    return typeof config.url === "string" && azureOpenAIEndpoint(config.url) !== null;
  }).map(([id]) => id);
}
