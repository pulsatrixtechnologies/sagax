import type { PersonalProviderServer } from "../../shared/provider-accounts.ts";
import { PERSONAL_VOICE_KEY_PROVIDERS, isPersonalVoiceKeyProvider } from "../../shared/person-voice-keys.ts";
import { ProviderAccountsError, type ProviderAccountOwner, type ProviderAccounts } from "../engines/provider-accounts.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createProviderAccountsRoutes(deps: {
  accounts: ProviderAccounts;
  /** Undefined is solo; null is a session without a personal identity. */
  owner(auth: RequestAuth): ProviderAccountOwner | null | undefined;
  beforeChange?(): unknown;
  changed?(before: unknown, owner: ProviderAccountOwner | undefined): Promise<void>;
  listed?(view: import("../../shared/provider-accounts.ts").ProviderAccountsView, owner: ProviderAccountOwner | undefined): Promise<void>;
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
