/** #3085: pi lists every model of every provider it knows (an organization
 * server fills each provider's key variable with a placeholder so the catalog
 * comes back whole). Only the providers the turn's payer really holds a key
 * for may be offered or picked: everything else is hidden, never greyed.
 * Provider names only, never a key value. */
import type { ModelCatalog } from "../contracts.ts";
import { piKeyProvider } from "../engines/engine-credentials.ts";
import type { ModelProvider } from "../perspicax/perspicax-link.ts";
import { isModelServerOption } from "../../shared/model-server-option.ts";
import { INJECT_SEP } from "./local-inject.ts";

/** A local `host::model` row (this server's loopback or a person's computer),
 * registered right now or not: never a provider key's. */
const localRow = (id: string) => id.includes(INJECT_SEP);

type Option = ModelCatalog["options"][number];

/** The key provider a pi picker id needs, or null when the row is not paid by
 * a provider key (a model server, a local inject row) or none can pay it. */
export function piModelKeyProvider(id: string, provider?: string): ModelProvider | null {
  if (localRow(id)) return null;
  return piKeyProvider(provider ?? id.split("/")[0]);
}

/** Rows paid otherwise than by a provider key: a Perspicax model server's or
 * a local inject row. They keep their own rules. */
function servedOtherwise(option: Option): boolean {
  return isModelServerOption(option) || localRow(option.id);
}

/** Keep the pi rows whose provider is in `providers` (marked keyPaid), and
 * the model-server and local rows; drop the rest. Null: no filter. */
export function filterPiCatalogByProviders(catalog: ModelCatalog, providers: ReadonlySet<ModelProvider> | null): ModelCatalog {
  if (!providers) return catalog;
  const options: Option[] = [];
  for (const option of catalog.options) {
    if (servedOtherwise(option)) {
      options.push(option);
      continue;
    }
    const provider = piModelKeyProvider(option.id, option.provider);
    if (provider && providers.has(provider)) options.push({ ...option, keyPaid: true });
  }
  const kept = options.some((option) => option.id === catalog.default);
  return { ...catalog, default: kept ? catalog.default : options[0]?.id ?? "", options };
}

/** Why a pi model cannot be picked for this payer, or null when it can. */
export function piModelRefusal(id: string, providers: ReadonlySet<ModelProvider> | null): { provider: string; available: ModelProvider[] } | null {
  if (!providers || localRow(id)) return null;
  const head = id.split("/")[0] ?? "";
  if (!id.includes("/") || isModelServerOption({ id, custom: true, provider: head })) return null;
  const provider = piKeyProvider(head);
  if (provider && providers.has(provider)) return null;
  return { provider: head, available: [...providers].sort() };
}
