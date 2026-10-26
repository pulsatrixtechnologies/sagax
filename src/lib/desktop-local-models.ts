// This person's Mac models (GET/PUT /api/me/local-models). Both switches
// start off. The list is loopback bases the desktop probes; the server
// does not call them.
import { normalizeLoopbackBase, type LoopbackEndpoint, type LoopbackProbe } from "../../shared/desktop-local-models";

export interface LocalModelSettings {
  expose: boolean;
  share: boolean;
  endpoints: LoopbackEndpoint[];
  published: { id: string; label: string; models: string[] }[];
  /** The desktop's last probe outcome per endpoint (Settings panel only). */
  probes: LoopbackProbe[];
  connected: boolean;
}

export async function loadLocalModels(fetchImpl: typeof fetch = fetch): Promise<LocalModelSettings | null> {
  const response = await fetchImpl("/api/me/local-models", { credentials: "same-origin", cache: "no-store" });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error("local models");
  return await response.json() as LocalModelSettings;
}

export async function saveLocalModels(patch: { expose?: boolean; share?: boolean; endpoints?: LoopbackEndpoint[] }, fetchImpl: typeof fetch = fetch): Promise<LocalModelSettings> {
  const response = await fetchImpl("/api/me/local-models", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error("local models");
  return await response.json() as LocalModelSettings;
}

/** The desktop-only bridge for per-loopback-server API keys, or null on a
 * remote server page or an older desktop build (then no key UI is shown).
 * The key value never crosses this bridge: only the list of keyed bases. */
export function localModelKeyBridge(): NonNullable<Window["ogb"]>["localModels"] | null {
  return (typeof window !== "undefined" && window.ogb?.localModels) || null;
}

export { normalizeLoopbackBase };
