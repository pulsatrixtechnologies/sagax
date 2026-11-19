// The person's own model switches (2026-10-30, "Providers, models and
// voice", lot 2; shared/offered-models.ts).
//
//   GET /api/me/models   { org: string[], mine: string[], favoriteModels: string[],
//                          harnessByProvider: { <provider id>: <driver kind> },
//                          contextByProvider: { <provider id>: <tokens> },
//                          accountSwitchByProvider: { <provider id>: { strategy, threshold } } }
//   PUT /api/me/models   { disabledModels?: string[], favoriteModels?: string[],
//                          harnessByProvider?: { <provider id>: <driver kind> | null },
//                          contextByProvider?: { <provider id>: <tokens> | null },
//                          accountSwitchByProvider?: { <provider id>: { strategy?, threshold? } | null } }
//                        each list given replaces the person's whole list;
//                        each provider given in harnessByProvider sets or
//                        (null) clears that provider's default only
//
// #2050: `favoriteModels` is the person's starred models in the model
// selector (same `<engine>/<model>` keys, at most MAX_FAVORITE_MODELS),
// kept beside the switches so the stars follow the person across devices.
//
// #4329 lot 5: `harnessByProvider` is what runs the person's bots for each
// provider ("Runs with" on a provider's page). A pair the compatibility
// matrix does not offer is refused with its sentence; saving moves the
// person's bots that have no engine of their own (server/models/resolve-harness.ts).
//
// #4417: `contextByProvider` is the person's default context size for each
// provider (shared/context-size.ts), read by each turn of their bots without
// a size of their own; a provider given sets or (null) clears its default.
//
// #5014 (D-20261119-050): `accountSwitchByProvider` is the person's account
// strategy for each provider (shared/account-switch.ts): which of their
// accounts of that provider runs a turn when several offer the model. A
// provider given sets the fields sent (the rest kept) or (null) clears it.
//
// Their own: no admin right. On an organization server the list is kept in
// the person's settings (server/people/person-settings.ts); on a solo server it is
// the installation's (`disabledModels` in config.json), written by whoever
// may edit it. The organization's list is read here, set in Perspicax only
// (POST /api/org/admin/settings `disabledModels`).
import type { RequestAuth } from "../auth/request-auth.ts";
import { cleanDisabledModels, cleanFavoriteModels } from "../../shared/offered-models.ts";
import { cleanHarnessDefaults, isHarnessId } from "../../shared/harness-matrix.ts";
import { cleanContextDefaults, isContextSize } from "../../shared/context-size.ts";
import { accountSwitchSettingOf, cleanAccountSwitchDefaults, cleanAccountThreshold, isAccountStrategy, type AccountSwitchSetting } from "../../shared/account-switch.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const MODEL_SWITCHES_PATH = "/api/me/models";

export interface ModelSwitchRouteDeps {
  /** The models the organization turned off (empty on a solo server). */
  org(): readonly string[];
  /** Whose list this session reads and writes: a person on an organization
   * server, "installation" on a solo server for a caller who may edit it,
   * null otherwise. */
  owner(auth: RequestAuth): string | "installation" | null;
  mine(owner: string | "installation"): readonly string[];
  /** Saves the list, then moves the bots of this owner off a model now off. */
  save(owner: string | "installation", list: string[]): void;
  /** #2050: the owner's starred models, in star order. */
  favorites(owner: string | "installation"): readonly string[];
  saveFavorites(owner: string | "installation", list: string[]): void;
  /** #4329 lot 5: the owner's default engine per provider. */
  harnessDefaults?: {
    read(owner: string | "installation"): Readonly<Record<string, string>>;
    /** Why this engine cannot run this provider for this caller, or null. */
    refusal(auth: RequestAuth, provider: string, harness: string): Promise<string | null>;
    /** Saves the whole map, then moves the owner's bots that follow it. */
    save(owner: string | "installation", map: Record<string, string>, auth: RequestAuth): Promise<void>;
  };
  /** #4417: the owner's default context size per provider. */
  contextDefaults?: {
    read(owner: string | "installation"): Readonly<Record<string, number>>;
    /** Saves the whole map; the next turn of each bot reads it. */
    save(owner: string | "installation", map: Record<string, number>): void;
  };
  /** #5014: the owner's account strategy per provider. */
  accountSwitchDefaults?: {
    read(owner: string | "installation"): Readonly<Record<string, AccountSwitchSetting>>;
    /** Saves the whole map; the next turn of each bot reads it. */
    save(owner: string | "installation", map: Record<string, AccountSwitchSetting>): void;
  };
}

export function createModelSwitchRoutes(deps: ModelSwitchRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== MODEL_SWITCHES_PATH) return PASS;
    if (method !== "GET" && method !== "PUT") return PASS;
    res.setHeader("cache-control", "no-store");
    const owner = deps.owner(auth);
    if (!owner) return json(res, 403, { error: "Sign in to choose your models." });
    const answer = () => json(res, 200, {
      org: [...deps.org()], mine: [...deps.mine(owner)], favoriteModels: [...deps.favorites(owner)],
      ...(deps.harnessDefaults ? { harnessByProvider: { ...deps.harnessDefaults.read(owner) } } : {}),
      ...(deps.contextDefaults ? { contextByProvider: { ...deps.contextDefaults.read(owner) } } : {}),
      ...(deps.accountSwitchDefaults ? { accountSwitchByProvider: { ...deps.accountSwitchDefaults.read(owner) } } : {}),
    });
    if (method === "GET") return answer();
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const body = await readBody(req).catch(() => undefined) as { disabledModels?: unknown; favoriteModels?: unknown; harnessByProvider?: unknown; contextByProvider?: unknown; accountSwitchByProvider?: unknown } | undefined;
    const switches = body && typeof body === "object" && Array.isArray(body.disabledModels);
    const favorites = body && typeof body === "object" && Array.isArray(body.favoriteModels);
    const rawHarness = body && typeof body === "object" ? body.harnessByProvider : undefined;
    const harness = Boolean(deps.harnessDefaults) && rawHarness !== null && typeof rawHarness === "object" && !Array.isArray(rawHarness);
    const rawContext = body && typeof body === "object" ? body.contextByProvider : undefined;
    const context = Boolean(deps.contextDefaults) && rawContext !== null && typeof rawContext === "object" && !Array.isArray(rawContext);
    const rawAccounts = body && typeof body === "object" ? body.accountSwitchByProvider : undefined;
    const accounts = Boolean(deps.accountSwitchDefaults) && rawAccounts !== null && typeof rawAccounts === "object" && !Array.isArray(rawAccounts);
    if (!switches && !favorites && !harness && !context && !accounts) return json(res, 400, { error: "Send { disabledModels: [\"<engine>/<model>\", …] } and/or { favoriteModels: [\"<engine>/<model>\", …] } and/or { harnessByProvider: { \"<provider>\": \"<engine>\" | null } } and/or { contextByProvider: { \"<provider>\": <tokens> | null } } and/or { accountSwitchByProvider: { \"<provider>\": { \"strategy\": \"high-water\" | \"most-free\" | \"fill-up\", \"threshold\": <10-100> } | null } }." });
    let accountsMap: Record<string, AccountSwitchSetting> | undefined;
    if (accounts) {
      const next: Record<string, AccountSwitchSetting> = { ...deps.accountSwitchDefaults!.read(owner) };
      for (const [provider, value] of Object.entries(rawAccounts as Record<string, unknown>)) {
        if (value === null) { delete next[provider]; continue; }
        const given = value && typeof value === "object" && !Array.isArray(value) ? value as { strategy?: unknown; threshold?: unknown } : null;
        if (!given || (given.strategy !== undefined && !isAccountStrategy(given.strategy))) {
          return json(res, 400, { error: `accountSwitchByProvider.${provider}.strategy must be high-water, most-free or fill-up.` });
        }
        if (given.threshold !== undefined && cleanAccountThreshold(given.threshold) === null) {
          return json(res, 400, { error: `accountSwitchByProvider.${provider}.threshold must be a whole percent from 10 to 100.` });
        }
        next[provider] = accountSwitchSettingOf({ ...next[provider], ...given });
      }
      accountsMap = cleanAccountSwitchDefaults(next);
    }
    let contextMap: Record<string, number> | undefined;
    if (context) {
      const next: Record<string, number> = { ...deps.contextDefaults!.read(owner) };
      for (const [provider, value] of Object.entries(rawContext as Record<string, unknown>)) {
        if (value === null) { delete next[provider]; continue; }
        if (!isContextSize(value)) return json(res, 400, { error: `contextByProvider.${provider} must be a context size in tokens, or null.` });
        next[provider] = value;
      }
      contextMap = cleanContextDefaults(next);
    }
    let harnessMap: Record<string, string> | undefined;
    if (harness) {
      const next: Record<string, string> = { ...deps.harnessDefaults!.read(owner) };
      for (const [provider, value] of Object.entries(rawHarness as Record<string, unknown>)) {
        if (value === null || value === "") { delete next[provider]; continue; }
        if (!isHarnessId(value)) return json(res, 400, { error: `harnessByProvider.${provider} must be an engine's driver kind, or null.` });
        const refusal = await deps.harnessDefaults!.refusal(auth, provider, value);
        if (refusal) return json(res, 400, { error: refusal });
        next[provider] = value;
      }
      harnessMap = cleanHarnessDefaults(next);
    }
    if (switches) deps.save(owner, cleanDisabledModels(body!.disabledModels));
    if (favorites) deps.saveFavorites(owner, cleanFavoriteModels(body!.favoriteModels));
    if (harnessMap) await deps.harnessDefaults!.save(owner, harnessMap, auth);
    if (contextMap) deps.contextDefaults!.save(owner, contextMap);
    if (accountsMap) deps.accountSwitchDefaults!.save(owner, accountsMap);
    return answer();
  };
}
