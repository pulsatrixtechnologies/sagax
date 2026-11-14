// Settings > Models > Active models (2026-10-30, "Providers, models and
// voice", lot 2): one switch per model, grouped by provider. Two levels:
// what the organization turned off in Perspicax (greyed here, with the
// reason, changed there only) and what the person turns off for their own
// bots, Auto and voice (shared/offered-models.ts, GET/PUT /api/me/models).
// A model nobody turned off is on, a new one included. Ids stay out of
// sight: each row names the model, "Copy the identifier" is not needed here
// (the provider's row on Providers has it).
//
// #4329 lot 4: the folds are the providers of the shared catalog
// (shared/provider-catalog.ts), with the names and the order of the
// Providers list and the model menu, never one fold per engine. A model
// sits once under the provider that gives it, and its one switch writes the
// stored key of every engine that runs it. A server added by address (pi's
// model servers included) is a provider fold of its own name.
import { useEffect, useMemo, useState } from "react";
import { Search, Server } from "lucide-react";

import { api, useStore, type InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useOfferedInstances } from "@/lib/offered-instances";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { canEditConfig } from "@/lib/viewer";
import type { HarnessPlace } from "../../../shared/harness-matrix";
import { providerOfInstance } from "../../../shared/model-provider";
import { modelKeys, modelOffer, modelOfferAcross, switchedModelKeys, type ModelSwitches } from "../../../shared/offered-models";
import { providerCatalog, type CatalogEngine, type CatalogProviderKind } from "../../../shared/provider-catalog";
import { engineReady } from "../EngineLibrary";
import { InstanceProviderMark } from "../ProviderIcons";
import { FIELD, FoldRow, HelpTip, SettingsGroup, SettingsIconTile, Switch } from "../SettingsPrimitives";

/** The rows a group lists: an engine's own models, never a model of this
 * computer grafted on it (those are Providers > This computer). */
export function switchableModels(instance: Pick<InstanceInfo, "models">): Array<{ id: string; label: string }> {
  return (instance.models?.options ?? []).filter((option) => !option.local && !option.id.includes("::")).map((option) => ({ id: option.id, label: option.label || option.id }));
}

/** On / total for a group's count. */
export function onCount(instanceId: string, models: ReadonlyArray<{ id: string }>, switches: ModelSwitches): number {
  return models.filter((model) => modelOffer(switches, instanceId, model.id) === "on").length;
}

/** The person's list after one switch: one key, or every key of a model. */
export function toggledList(mine: readonly string[], key: string | readonly string[], on: boolean): string[] {
  return switchedModelKeys(mine, typeof key === "string" ? [key] : key, on);
}

export interface ActiveModel {
  /** Canonical id (shared/model-provider.ts). */
  id: string;
  label: string;
  /** The engines that run it now, and their stored keys. */
  engines: CatalogEngine[];
  keys: string[];
}

export interface ActiveProvider {
  /** The catalog's provider id, never shown. */
  id: string;
  label: string;
  kind: CatalogProviderKind;
  /** The engine whose mark the row shows, when the provider has one of its own. */
  markInstanceId?: string;
  models: ActiveModel[];
}

/**
 * The folds of Active models: the catalog's providers in its order, each
 * with the models an engine can run now (an engine that is not ready
 * lists none here), this computer's models left to Providers > This
 * computer. Every instance still goes into the catalog, so a provider's
 * place matches the Providers list.
 */
export function activeModelProviders(instances: readonly InstanceInfo[], place: HarnessPlace, ready: (instance: InstanceInfo) => boolean = engineReady): ActiveProvider[] {
  const catalog = providerCatalog({
    place,
    instances: instances.map((instance) => ({
      ...instance,
      models: { ...instance.models, options: ready(instance) ? (instance.models?.options ?? []).filter((option) => !option.local && !option.id.includes("::")) : [] },
    })),
  });
  return catalog.providers.filter((provider) => provider.kind !== "computer" && provider.models.length > 0).map((provider) => ({
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    markInstanceId: instances.find((instance) => providerOfInstance(instance)?.id === provider.id)?.instanceId,
    models: provider.models.map((model) => ({ id: model.id, label: model.label, engines: model.engines, keys: modelKeys(model.engines) })),
  }));
}

const SEARCH_FROM = 12;

function ProviderModels({ provider, instance, switches, mayEdit, onToggle, busy }: {
  provider: ActiveProvider;
  /** The provider's own engine, for its mark. */
  instance?: InstanceInfo;
  switches: ModelSwitches;
  mayEdit: boolean;
  onToggle: (keys: readonly string[], on: boolean) => void;
  busy: boolean;
}) {
  const { models } = provider;
  const [query, setQuery] = useState("");
  const shown = query.trim() ? models.filter((model) => `${model.label} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase())) : models;
  const on = models.filter((model) => modelOfferAcross(switches, model.engines) === "on").length;
  return (
    <FoldRow
      cardId={`models.provider.${provider.id}`}
      label={provider.label}
      icon={<SettingsIconTile>{instance ? <InstanceProviderMark instance={instance} size={16} /> : <Server size={14} />}</SettingsIconTile>}
      description={t("modelSwitches.count", { on, total: models.length })}
      count={on}
      toggleLabel={t("modelSwitches.toggle", { name: provider.label })}
    >
      <div className="flex flex-col gap-1" data-model-switches={provider.id}>
        {models.length >= SEARCH_FROM && (
          <label className="relative mb-1 block">
            <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-secondary" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("modelSwitches.search")} aria-label={t("modelSwitches.search")} className={cn(FIELD, "pl-8")} />
          </label>
        )}
        {shown.map((model) => {
          const offer = modelOfferAcross(switches, model.engines);
          return (
            <div key={model.id} data-model-switch={model.id} data-model-offer={offer} className="flex min-h-[36px] items-center justify-between gap-3">
              <span className="min-w-0">
                <span className={cn("block truncate text-[13px]", offer === "adminOff" ? "text-ink-secondary" : "text-ink")}>{model.label}</span>
                {offer === "adminOff" && <span className="block text-[12px] leading-4 text-ink-secondary">{t("modelSwitches.adminOff")}</span>}
              </span>
              <Switch
                checked={offer === "on"}
                disabled={!mayEdit || busy || offer === "adminOff"}
                aria-label={t("modelSwitches.switch", { name: model.label })}
                onClick={() => onToggle(model.keys, offer !== "on")}
              />
            </div>
          );
        })}
      </div>
    </FoldRow>
  );
}

export function ModelSwitchesSettings() {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const instances = useOfferedInstances("settings");
  const place: HarnessPlace = org !== null ? "organization" : "solo";
  const providers = useMemo(() => activeModelProviders(instances, place), [instances, place]);
  const [mine, setMine] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configMine = state.config?.myDisabledModels;
  useEffect(() => { setMine(configMine ? [...configMine] : null); }, [configMine]);
  const switches = useMemo<ModelSwitches>(() => ({ org: state.config?.disabledModels ?? null, mine: mine ?? configMine ?? null }), [state.config?.disabledModels, mine, configMine]);
  // the person's own on an organization server; the installation's on a solo one
  const mayEdit = org !== null || canEditConfig(state.config);
  if (!providers.length) return null;
  const toggle = (keys: readonly string[], on: boolean) => {
    const next = toggledList(switches.mine ?? [], keys, on);
    setMine(next);
    setBusy(true);
    setError(null);
    api<{ mine: string[] }>("/api/me/models", { method: "PUT", body: JSON.stringify({ disabledModels: next }) })
      .then((answer) => setMine(answer.mine))
      .catch((failure: Error) => { setError(failure.message); setMine(configMine ? [...configMine] : null); })
      .finally(() => setBusy(false));
  };
  return (
    <div data-settings-card="models.switches" data-model-switches-page="">
      <SettingsGroup
        title={t("modelSwitches.title")}
        groupId="model-switches"
        accessory={<HelpTip label={t("settings.moreAbout", { title: t("modelSwitches.title") })}>{t("modelSwitches.help")}</HelpTip>}
      >
        {org !== null && <p className="px-3.5 py-1.5 text-[12px] leading-relaxed text-ink-secondary" data-model-switches-org="">{t("modelSwitches.orgBand")}</p>}
        {providers.map((provider) => (
          <ProviderModels key={provider.id} provider={provider} instance={instances.find((instance) => instance.instanceId === provider.markInstanceId)}
            switches={switches} mayEdit={mayEdit} onToggle={toggle} busy={busy} />
        ))}
        {error && <p role="alert" className="px-3.5 py-1.5 text-[12px] text-danger">{error}</p>}
      </SettingsGroup>
    </div>
  );
}
