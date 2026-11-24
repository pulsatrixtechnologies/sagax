// Cline has no HTTP models endpoint. The live list is models.availableModels
// on the ACP session (session/new or session/load), which Cline fills from
// the active provider's catalog. Until a session reports one, the catalog
// stays the single configured entry.
import type { ModelCatalog } from "../../contracts.ts";

/** There is no list URL to call. Kept null so a caller cannot invent one. */
export const CLINE_MODELS_ENDPOINT = null;

export const CLINE_FALLBACK_MODEL = "cline-default";

const FALLBACK: ModelCatalog = {
  default: CLINE_FALLBACK_MODEL,
  options: [{ id: CLINE_FALLBACK_MODEL, label: "Cline default (configured)" }],
};

export function clineFallbackCatalog(): ModelCatalog {
  return FALLBACK;
}

function idOk(id: string): boolean {
  if (id.length === 0 || id.length > 200) return false;
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    if (code <= 32 || code === 127) return false;
  }
  return true;
}

/** The session's models plus the configured fallback, or null when the session listed none. */
export function clineCatalogFromSession(
  sessionModels: ReadonlyArray<{ modelId?: string; name?: string }>,
): ModelCatalog | null {
  const options: ModelCatalog["options"] = [{ ...FALLBACK.options[0]! }];
  const seen = new Set<string>([CLINE_FALLBACK_MODEL]);
  for (const row of sessionModels) {
    const id = typeof row?.modelId === "string" ? row.modelId.trim() : "";
    if (!idOk(id) || seen.has(id)) continue;
    seen.add(id);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    options.push({ id, label: name || id });
    if (options.length >= 200) break;
  }
  return options.length > 1 ? { default: FALLBACK.default, options } : null;
}

export function clineTurnModel(model: string | undefined, saved: string | undefined, catalog: ModelCatalog): string | undefined {
  if (!model || model === CLINE_FALLBACK_MODEL) return saved?.trim();
  if (catalog.options.some((option) => option.id === model)) return model;
  throw new Error("Select Cline default (configured) or a model offered by this Cline account.");
}
