// #3116, #4329 (lot 3): the chat-bar model picker in two steps. First the
// provider (who gives the models: Claude, OpenAI, the xAI group, a server
// the person added, this computer), then its models. The provider of a row
// is said once, in shared/model-provider.ts; the sections arrive already
// grouped by it (ModelPicker.tsx-parts/buildSections.ts). The accounts and
// engines of one provider stay pooled out of sight: one model, one row.
// A menu with a single provider opens straight on its models. Typing in the
// search field leaves the steps and lists every match flat.
import { harnessRole, type HarnessRole } from "../../shared/harness-matrix";
import {
  CURRENT_KEY_PREFIX,
  FAVORITE_KEY_PREFIX,
  PROVIDER_KEY_PREFIX,
  modelMenuRoot,
  type ModelMenuProvider,
  type ModelMenuRow,
  type ModelMenuSection,
} from "./model-menu";

/** The sections that are providers: headed, not the top rows nor Favorites. */
export function providerSections(sections: readonly ModelMenuSection[]): ModelMenuSection[] {
  return sections.filter((section) => section.label && section.key !== "top" && section.key !== "favorites" && section.rows.length > 0);
}

export function providerOf(section: ModelMenuSection): ModelMenuProvider {
  return { key: `${PROVIDER_KEY_PREFIX}${section.key}`, section, current: section.rows.some((row) => row.current) };
}

/** The providers of the menu, in menu order. */
export function modelMenuProviders(sections: readonly ModelMenuSection[]): ModelMenuProvider[] {
  return providerSections(sections).map(providerOf);
}

/** Where the person is in the steps: nothing (the providers) or a provider
 * (its models). */
export interface ModelStepPath {
  provider?: string;
}

export type ModelStepLevel = "provider" | "model";

/** One line the arrow keys reach: a model row (under the key the step draws
 * it with) or a provider. */
export interface ModelStepEntry {
  key: string;
  current: boolean;
  row?: ModelMenuRow;
  provider?: ModelMenuProvider;
}

export interface ModelStepView {
  level: ModelStepLevel;
  /** The provider open (step 2), or the only one. */
  provider?: ModelMenuProvider;
  /** The provider was not chosen but the only one: the step draws the top
   * rows over its models and has no step to go back to. */
  skipped: boolean;
  /** Step 1 (and a skipped one): Auto, the bot's model, the current model,
   * the favorites. */
  top: ModelMenuRow[];
  current?: ModelMenuRow;
  favorites: ModelMenuRow[];
  providers: ModelMenuProvider[];
  /** Step 2: the provider's rows, unavailable ones included (drawn dimmed). */
  rows: ModelMenuRow[];
  /** What the arrow keys and Enter reach, in order. */
  entries: ModelStepEntry[];
}

const pickable = (row: ModelMenuRow) => !row.unavailable;

/** The view of one step. A path that names nothing known falls back to the
 * providers; a lone provider opens straight on its models. */
export function modelMenuStepView(sections: readonly ModelMenuSection[], path: ModelStepPath, favoriteKeys: readonly string[]): ModelStepView {
  const root = modelMenuRoot(sections, favoriteKeys);
  const providers = modelMenuProviders(sections);
  const chosen = path.provider ? providers.find((entry) => entry.section.key === path.provider) : undefined;
  const skipped = !chosen && providers.length === 1;
  const provider = chosen ?? (skipped ? providers[0] : undefined);
  const topEntries: ModelStepEntry[] = [
    ...root.top.filter(pickable).map((row) => ({ key: row.key, current: row.current, row })),
    ...(root.current && pickable(root.current) ? [{ key: `${CURRENT_KEY_PREFIX}${root.current.key}`, current: true, row: root.current }] : []),
    ...root.favorites.filter(pickable).map((row) => ({ key: `${FAVORITE_KEY_PREFIX}${row.key}`, current: row.current, row })),
  ];
  const base = { top: root.top, current: root.current, favorites: root.favorites, providers, skipped };
  if (!provider) {
    return {
      ...base,
      level: "provider",
      rows: [],
      entries: [...topEntries, ...providers.map((entry) => ({ key: entry.key, current: entry.current, provider: entry }))],
    };
  }
  return {
    ...base,
    level: "model",
    provider,
    rows: provider.section.rows,
    entries: [...(skipped ? topEntries : []), ...provider.section.rows.filter(pickable).map((row) => ({ key: row.key, current: row.current, row }))],
  };
}

/** The path after opening a provider entry; a model entry leaves the path
 * alone (Enter picks it). */
export function stepPathInto(path: ModelStepPath, entry: ModelStepEntry): ModelStepPath {
  if (entry.provider) return { provider: entry.provider.section.key };
  return path;
}

/** The path one step back, or null when there is no step before (the
 * providers, or the only provider): the caller closes the menu. */
export function stepPathBack(view: ModelStepView): ModelStepPath | null {
  if (view.level === "provider" || view.skipped) return null;
  return {};
}

/** The path that shows the current model (where a reopened menu could start). */
export function stepPathOfCurrent(sections: readonly ModelMenuSection[]): ModelStepPath {
  const provider = modelMenuProviders(sections).find((entry) => entry.current);
  return provider ? { provider: provider.section.key } : {};
}

/** The provider that holds the current model, if any. */
export function currentProvider(sections: readonly ModelMenuSection[]): ModelMenuProvider | undefined {
  return modelMenuProviders(sections).find((entry) => entry.current);
}

/** The breadcrumb of a step: the provider, when there was a choice. */
export function stepCrumbs(view: ModelStepView): string[] {
  return view.level === "model" && view.provider && !view.skipped ? [view.provider.section.label ?? view.provider.section.key] : [];
}

/** One engine that can run the model in use, as "Runs with" offers it. */
export interface RunsWithEntry {
  /** The engine (a driver kind). */
  harness: string;
  role: HarnessRole;
  /** The row a pick switches to: the same model on that engine. */
  row: ModelMenuRow;
  current: boolean;
}

const ROLE_ORDER: readonly HarnessRole[] = ["own", "builtin", "pi", "opencode", "tool"];

/**
 * #4329: the engines that can run the model in use, one per engine (the
 * accounts of one engine stay pooled), the one in use kept. Read from the
 * provider's row and the rows pooled under it; the role says how the person
 * reads each (shared/harness-matrix.ts). Empty on Auto, on the bot's model
 * in a thread, or when the model in use is in no provider.
 */
export function runsWithEntries(sections: readonly ModelMenuSection[]): RunsWithEntry[] {
  const provider = currentProvider(sections);
  const row = provider?.section.rows.find((candidate) => candidate.current && candidate.kind === "model");
  if (!provider || !row?.harness) return [];
  const vendor = provider.section.key;
  const out: RunsWithEntry[] = [];
  for (const candidate of [row, ...(row.alternatives ?? [])]) {
    if (!candidate.harness || candidate.unavailable || out.some((entry) => entry.harness === candidate.harness)) continue;
    out.push({ harness: candidate.harness, role: harnessRole(candidate.harness, vendor), row: candidate, current: candidate === row });
  }
  return out.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}
