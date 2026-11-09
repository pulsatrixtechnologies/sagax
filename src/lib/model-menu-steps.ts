// #3116: the chat-bar model picker in three steps. Picking a model kept
// being painful: one scrolling list under a search field, chips and a
// settings footer left the models squashed into a few rows. The picker
// now reads like Cursor's: first the harness (the engine that runs the
// turn: Claude Code, Codex, Grok, pi, local models), then the provider
// (the accounts of that harness: a sign-in, a pasted key), then the model.
// A harness with a single provider skips the second step. Every step shows
// only what the step before it allows; an impossible choice is not drawn.
// Typing in the search field leaves the steps and lists every match flat.
import {
  CURRENT_KEY_PREFIX,
  FAVORITE_KEY_PREFIX,
  PROVIDER_KEY_PREFIX,
  modelMenuRoot,
  type ModelMenuProvider,
  type ModelMenuRow,
  type ModelMenuSection,
} from "./model-menu";

/** A harness entry's key in the list, beside the rows' and providers' keys. */
export const HARNESS_KEY_PREFIX = "harness:";

export interface ModelMenuHarness {
  /** `harness:` and the harness key (a driver kind, or `local`). */
  key: string;
  harness: string;
  label: string;
  /** Its provider sections, in menu order (the bot's own engine first). */
  sections: ModelMenuSection[];
  /** The current model runs on it. */
  current: boolean;
  /** How many models its providers offer in all. */
  models: number;
}

/** The sections that are providers: headed, not the top rows nor Favorites. */
function providerSections(sections: readonly ModelMenuSection[]): ModelMenuSection[] {
  return sections.filter((section) => section.label && section.key !== "top" && section.key !== "favorites" && section.rows.length > 0);
}

/** The harnesses of the menu, in the order their first provider appears.
 * A section without a harness is a harness of its own (older callers,
 * the gallery). */
export function modelMenuHarnesses(sections: readonly ModelMenuSection[]): ModelMenuHarness[] {
  const out: ModelMenuHarness[] = [];
  for (const section of providerSections(sections)) {
    const harness = section.harness ?? section.key;
    const existing = out.find((entry) => entry.harness === harness);
    const current = section.rows.some((row) => row.current);
    const models = section.rows.filter((row) => row.kind === "model").length;
    if (existing) {
      existing.sections.push(section);
      existing.current ||= current;
      existing.models += models;
      continue;
    }
    out.push({ key: `${HARNESS_KEY_PREFIX}${harness}`, harness, label: section.harnessLabel ?? section.label ?? harness, sections: [section], current, models });
  }
  return out;
}

export function providerOf(section: ModelMenuSection): ModelMenuProvider {
  return { key: `${PROVIDER_KEY_PREFIX}${section.key}`, section, current: section.rows.some((row) => row.current) };
}

/** Where the person is in the steps: nothing (the harnesses), a harness
 * (its providers), or a harness and a provider (its models). */
export interface ModelStepPath {
  harness?: string;
  provider?: string;
}

export type ModelStepLevel = "harness" | "provider" | "model";

/** One line the arrow keys reach: a model row (under the key the step draws
 * it with), a harness or a provider. */
export interface ModelStepEntry {
  key: string;
  current: boolean;
  row?: ModelMenuRow;
  harness?: ModelMenuHarness;
  provider?: ModelMenuProvider;
}

export interface ModelStepView {
  level: ModelStepLevel;
  /** The harness open (steps 2 and 3). */
  harness?: ModelMenuHarness;
  /** The provider open (step 3), or the only one of the harness. */
  provider?: ModelMenuProvider;
  /** The harness was not chosen but the only one: the step draws the top
   * rows over its content and has no step to go back to. */
  skipped: boolean;
  /** Step 1 (and a skipped one): Auto, the bot's model, the current model,
   * the favorites. */
  top: ModelMenuRow[];
  current?: ModelMenuRow;
  favorites: ModelMenuRow[];
  harnesses: ModelMenuHarness[];
  providers: ModelMenuProvider[];
  /** Step 3: the provider's rows, unavailable ones included (drawn dimmed). */
  rows: ModelMenuRow[];
  /** What the arrow keys and Enter reach, in order. */
  entries: ModelStepEntry[];
}

const pickable = (row: ModelMenuRow) => !row.unavailable;

/** The view of one step. A path that names nothing known falls back to the
 * harnesses; a harness with one provider opens straight on its models. */
export function modelMenuStepView(sections: readonly ModelMenuSection[], path: ModelStepPath, favoriteKeys: readonly string[]): ModelStepView {
  const root = modelMenuRoot(sections, favoriteKeys);
  const harnesses = modelMenuHarnesses(sections);
  const chosen = path.harness ? harnesses.find((entry) => entry.harness === path.harness) : undefined;
  // one harness: nothing to choose at step 1, the menu opens on it
  const skipped = !chosen && harnesses.length === 1;
  const harness = chosen ?? (skipped ? harnesses[0] : undefined);
  const topEntries: ModelStepEntry[] = [
    ...root.top.filter(pickable).map((row) => ({ key: row.key, current: row.current, row })),
    ...(root.current && pickable(root.current) ? [{ key: `${CURRENT_KEY_PREFIX}${root.current.key}`, current: true, row: root.current }] : []),
    ...root.favorites.filter(pickable).map((row) => ({ key: `${FAVORITE_KEY_PREFIX}${row.key}`, current: row.current, row })),
  ];
  const base = { top: root.top, current: root.current, favorites: root.favorites, harnesses, skipped };
  if (!harness) {
    return {
      ...base,
      level: "harness",
      providers: [],
      rows: [],
      entries: [...topEntries, ...harnesses.map((entry) => ({ key: entry.key, current: entry.current, harness: entry }))],
    };
  }
  const providers = harness.sections.map(providerOf);
  const provider = providers.length === 1 ? providers[0] : path.provider ? providers.find((entry) => entry.section.key === path.provider) : undefined;
  const lead = skipped ? topEntries : [];
  if (!provider) {
    return {
      ...base,
      level: "provider",
      harness,
      providers,
      rows: [],
      entries: [...lead, ...providers.map((entry) => ({ key: entry.key, current: entry.current, provider: entry }))],
    };
  }
  return {
    ...base,
    level: "model",
    harness,
    provider,
    providers,
    rows: provider.section.rows,
    entries: [...lead, ...provider.section.rows.filter(pickable).map((row) => ({ key: row.key, current: row.current, row }))],
  };
}

/** The path after opening a harness or a provider entry; a model entry
 * leaves the path alone (Enter picks it). */
export function stepPathInto(path: ModelStepPath, entry: ModelStepEntry): ModelStepPath {
  if (entry.harness) return { harness: entry.harness.harness };
  if (entry.provider) return { harness: path.harness, provider: entry.provider.section.key };
  return path;
}

/** The path one step back, or null when there is no step before (the
 * harnesses, or the only harness): the caller closes the menu. A harness
 * that skipped its provider step goes back to the harnesses. */
export function stepPathBack(view: ModelStepView, path: ModelStepPath): ModelStepPath | null {
  if (view.level === "harness") return null;
  if (view.level === "model" && view.providers.length > 1) return { harness: view.harness?.harness ?? path.harness };
  if (view.skipped) return null;
  return {};
}

/** The path that shows the current model (where a reopened menu could start). */
export function stepPathOfCurrent(sections: readonly ModelMenuSection[]): ModelStepPath {
  for (const harness of modelMenuHarnesses(sections)) {
    const section = harness.sections.find((candidate) => candidate.rows.some((row) => row.current));
    if (section) return harness.sections.length > 1 ? { harness: harness.harness, provider: section.key } : { harness: harness.harness };
  }
  return {};
}

/** The breadcrumb of a step: the harness (when there was a choice), then
 * the provider when the harness has several (a lone provider is the
 * harness itself). */
export function stepCrumbs(view: ModelStepView): string[] {
  const crumbs: string[] = [];
  if (view.harness && !view.skipped) crumbs.push(view.harness.label);
  if (view.level === "model" && view.provider && view.providers.length > 1) crumbs.push(view.provider.section.label ?? view.provider.section.key);
  return crumbs;
}
