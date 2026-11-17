// #4417: "Context size", what a bot's model runs at where its engine offers
// more than one size (shared/context-size.ts). Pure choices and their words,
// plus the person's default per provider (`contextByProvider`, GET/PUT
// /api/me/models) kept once for the app; src/components/ContextSize.tsx
// draws the choices on the provider's page (Models), the model menu and the
// bot's Model tab.
import { useSyncExternalStore } from "react";

import { api, type InstanceInfo } from "@/state/store";
import { t } from "./i18n";
import { readableError } from "./plain-error";
import { contextProviderOf, contextSizeWords, offeredContextSizes } from "../../shared/context-size";
import type { ModelSelection } from "../../shared/model-selection";

/** One value of "Context size". */
export interface ContextSizeChoice {
  /** "default", or the size in tokens as text. */
  key: string;
  label: string;
  current: boolean;
  onPick: () => void;
}

/** Drawn only with a choice to make: hidden where one size exists. */
export function contextSizeShown(choices: readonly ContextSizeChoice[] | undefined): choices is readonly ContextSizeChoice[] {
  return Boolean(choices && choices.length > 2);
}

type Instances = readonly Pick<InstanceInfo, "instanceId" | "driverKind" | "displayName" | "providerAccount" | "models">[];

function sizeChoices(offered: readonly number[], current: number | undefined, defaultLabel: string, onPick: (size: number | null) => void): ContextSizeChoice[] {
  return [
    { key: "default", label: defaultLabel, current: current === undefined, onPick: () => onPick(null) },
    ...offered.map((size) => ({ key: String(size), label: contextSizeWords(size), current: size === current, onPick: () => onPick(size) })),
  ];
}

/** "Context size" of a bot: the sizes its model offers, Default first (the
 * person's default for the provider, else the model's own size). Empty on
 * Auto and where the model has one size. */
export function botContextSizes({ instances, selection, chosen, defaults, onPick }: {
  instances: Instances;
  selection: Pick<ModelSelection, "instanceId" | "model" | "auto">;
  /** The bot's own choice (`bot.contextWindow`). */
  chosen?: number | null;
  /** The person's `contextByProvider`. */
  defaults: Readonly<Record<string, number>>;
  onPick: (size: number | null) => void;
}): ContextSizeChoice[] {
  if (selection.auto === true) return [];
  const instance = instances.find((entry) => entry.instanceId === selection.instanceId);
  const option = instance?.models.options.find((entry) => entry.id === selection.model);
  if (!instance || !option) return [];
  const offered = offeredContextSizes(option);
  if (!offered.length) return [];
  const saved = defaults[contextProviderOf(instance, option)];
  const fallback = saved && offered.includes(saved) ? saved : option.contextWindow;
  const label = fallback ? t("model.effort.defaultWith", { level: contextSizeWords(fallback) }) : t("model.defaultTag");
  return sizeChoices(offered, chosen && offered.includes(chosen) ? chosen : undefined, label, onPick);
}

/** "Context size" on a provider's page: every size one of its models
 * offers, the person's default checked (Default: each model's own). */
export function providerContextSizes({ instances, providerId, defaults, onPick }: {
  instances: Instances;
  providerId: string;
  defaults: Readonly<Record<string, number>>;
  onPick: (size: number | null) => void;
}): ContextSizeChoice[] {
  const sizes = new Set<number>();
  for (const instance of instances) {
    for (const option of instance.models.options) {
      const offered = offeredContextSizes(option);
      if (offered.length && contextProviderOf(instance, option) === providerId) offered.forEach((size) => sizes.add(size));
    }
  }
  if (sizes.size < 2) return [];
  const offered = [...sizes].sort((a, b) => a - b);
  const saved = defaults[providerId];
  return sizeChoices(offered, saved && offered.includes(saved) ? saved : undefined, t("model.contextSize.eachModel"), onPick);
}

// The person's defaults, read once for the app and kept as the server answers.
let defaults: Readonly<Record<string, number>> = {};
let loaded = false;
let busy = false;
let error: string | null = null;
type DefaultsState = { defaults: Readonly<Record<string, number>>; busy: boolean; error: string | null };
let snapshot: DefaultsState = { defaults, busy, error };
const listeners = new Set<() => void>();

function changed(): void {
  snapshot = { defaults, busy, error };
  for (const listener of listeners) listener();
}

function load(): void {
  if (loaded) return;
  loaded = true;
  Promise.resolve()
    .then(() => api<{ contextByProvider?: Record<string, number> }>("/api/me/models"))
    .then((answer) => { defaults = answer?.contextByProvider ?? {}; changed(); })
    .catch(() => { loaded = false; });
}

/** Saves the person's default for one provider (null: each model's own). */
export function saveContextDefault(providerId: string, size: number | null): Promise<void> {
  busy = true;
  error = null;
  changed();
  return api<{ contextByProvider?: Record<string, number> }>("/api/me/models", { method: "PUT", body: JSON.stringify({ contextByProvider: { [providerId]: size } }) })
    .then((answer) => { defaults = answer?.contextByProvider ?? {}; })
    .catch((failure) => { error = readableError(failure); })
    .finally(() => { busy = false; changed(); });
}

function listen(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function listenAndLoad(listener: () => void): () => void {
  load();
  return listen(listener);
}

const EMPTY: DefaultsState = { defaults: {}, busy: false, error: null };

/** The person's default context size per provider, with the save in flight.
 * Read from the server only once a size is to be chosen (`needed`). */
export function useContextDefaults(needed = true): DefaultsState {
  return useSyncExternalStore(needed ? listenAndLoad : listen, () => snapshot, () => EMPTY);
}

/** Whether this bot's model offers a size to choose. */
export function botChoosesContextSize(instances: Instances, selection: Pick<ModelSelection, "instanceId" | "model" | "auto">): boolean {
  if (selection.auto === true) return false;
  const option = instances.find((entry) => entry.instanceId === selection.instanceId)?.models.options.find((entry) => entry.id === selection.model);
  return offeredContextSizes(option).length > 0;
}

/** Forgets the defaults read so far (another person signed in, a test). */
export function forgetContextDefaults(): void {
  defaults = {};
  loaded = false;
  busy = false;
  error = null;
  changed();
}
