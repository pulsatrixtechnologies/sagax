// #2695: the signal budget and quiet hours on a personal computer
// (shared/signal-levels.ts). An organization server keeps them in the
// person's preferences (/api/me/preferences, synced by the app); a personal
// computer has no preference sync, so Settings > Notifications saves the
// keys here, on the local person's record the signal gate reads.
// #4250 (S2): with the channels each level may use (one attention policy).
import { NOTIFY_CHANNELS_KEY } from "../../shared/attention-policy.ts";
import { QUIET_HOURS_KEY, SIGNAL_BUDGET_KEY } from "../../shared/signal-levels.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const SIGNAL_SETTINGS_PATH = "/api/me/signals";

export interface SignalSettingsStore {
  get(): Record<string, string>;
  merge(set: Record<string, string>, remove: string[]): void;
}

export interface SignalSettingsRouteDeps {
  store: SignalSettingsStore;
  /** True on an organization server (SAGAX_IDENTITY=perspicax). */
  organization: () => boolean;
}

function view(prefs: Record<string, string>): { budget: string | null; quiet: string | null; channels: string | null } {
  return { budget: prefs[SIGNAL_BUDGET_KEY] ?? null, quiet: prefs[QUIET_HOURS_KEY] ?? null, channels: prefs[NOTIFY_CHANNELS_KEY] ?? null };
}

export function createSignalSettingsRoutes(deps: SignalSettingsRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path !== SIGNAL_SETTINGS_PATH) return PASS;
    if (deps.organization()) {
      return json(res, 404, { error: "On an organization server these are kept in /api/me/preferences." });
    }
    if (method === "GET") return json(res, 200, view(deps.store.get()));
    if (method === "PUT") {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
        return json(res, 415, { error: "send the settings as JSON (content-type: application/json)" });
      }
      const body = await readBody(req);
      const input = body && typeof body === "object" && !Array.isArray(body) ? (body as { budget?: unknown; quiet?: unknown; channels?: unknown }) : null;
      if (!input) return json(res, 400, { error: "send { budget, quiet, channels } (a string, or null to clear)" });
      const set: Record<string, string> = {};
      const remove: string[] = [];
      for (const [field, key] of [["budget", SIGNAL_BUDGET_KEY], ["quiet", QUIET_HOURS_KEY], ["channels", NOTIFY_CHANNELS_KEY]] as const) {
        const value = input[field];
        if (value === undefined) continue;
        if (value === null || value === "") remove.push(key);
        else if (typeof value === "string" && value.length <= 500) set[key] = value;
        else return json(res, 400, { error: `${field} must be a string, or null to clear` });
      }
      deps.store.merge(set, remove);
      return json(res, 200, view(deps.store.get()));
    }
    return json(res, 405, { error: "GET or PUT" });
  };
}
