// The model list shared by the composer's model menu and the model window
// (ModelMenu.tsx): rows grouped in sections, a search that filters as one
// types, and the arrow keys over what is left. Pure, so the rules are tested
// without a DOM.

export type ModelMenuRowKind = "auto" | "follow" | "keep" | "model";

export interface ModelMenuRow {
  /** Unique in the list. */
  key: string;
  kind: ModelMenuRowKind;
  instanceId?: string;
  modelId?: string;
  /** The model's name, in primary ink. */
  label: string;
  /** Its effort, variant or origin, in secondary ink. */
  detail?: string;
  /** A quiet second line under the name (who shares a local model, its server
   * when two share a name). It wraps, never truncates. */
  subtext?: string;
  /** One line under the name in the model panel: what the app knows (its context size). */
  description?: string;
  /** Short markers after the detail (Default, Loaded, the bot's model). */
  tags?: string[];
  /** The choice in effect: checked. */
  current: boolean;
  /** Why it cannot be picked: shown dimmed with this as a tooltip. */
  unavailable?: string;
  /** The tooltip otherwise: the whole name and detail, which a narrow menu
   * truncates. */
  title?: string;
  /** More words the search matches (the engine's name, the model id). */
  keywords?: string;
  /** The model in use cannot run a turn now (src/lib/model-health.ts):
   * said beside it, discreetly. */
  warning?: string;
  /** #4329: the engine (a driver kind) that runs this row. */
  harness?: string;
  /** #4329: the same model on the provider's other engines and accounts,
   * pooled out of sight under this row (one model, one row). "Runs with"
   * picks among them; a favorite starred on one of them still shows. */
  alternatives?: ModelMenuRow[];
  /** M-20261119-015: the account this row runs on (the name the person gave
   * it in Providers, else its address), set while the provider has two or
   * more accounts in the menu. */
  account?: string;
  /** M-20261119-015: the same model on each account that offers it, this
   * row's first (two or more): the menu's "Account" line picks one. */
  accountRows?: ModelMenuRow[];
  /** M-20261119-015: the "Special access" badge: only this account of the
   * person's sign-in accounts offers the model (shared/model-accounts.ts). */
  badge?: { label: string; title: string };
  /** #5014: picked on the "Account" line: the person forces this account,
   * so the provider's account strategy leaves the conversation on it. */
  pinAccount?: true;
}

/** #5088: one account of a provider in the Manual list (the composer's mode
 * menu): its name and, when it cannot run a turn, its state ("Signed out"). */
export interface ModelMenuAccount {
  instanceId: string;
  label: string;
  state?: string;
}

export interface ModelMenuSection {
  key: string;
  /** The heading (a provider, Favorites); none for the top rows. */
  label?: string;
  /** A muted note beside the heading (the provider's state). */
  note?: string;
  rows: ModelMenuRow[];
  /** #5088: the provider's accounts, the one in use first, every one the
   * person has (a signed-out one included), while the provider has two or
   * more or one of them cannot run. The Manual list groups the rows by them. */
  accounts?: ModelMenuAccount[];
}

/** Lower case, accents dropped: "élevé" matches "eleve". */
export function foldSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Every word of the query must appear in the row's name, detail, tags,
 * keywords or its section's heading. An empty query keeps everything;
 * sections left without rows are dropped. */
export function filterModelSections(sections: readonly ModelMenuSection[], query: string): ModelMenuSection[] {
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections.filter((section) => section.rows.length > 0);
  return sections.flatMap((section) => {
    const rows = section.rows.filter((row) => {
      const haystack = foldSearch([section.label, row.label, row.detail, row.subtext, ...(row.tags ?? []), row.keywords, row.modelId, row.account, row.badge?.label].filter(Boolean).join(" "));
      return words.every((word) => haystack.includes(word));
    });
    return rows.length > 0 ? [{ ...section, rows }] : [];
  });
}

/** #5088: one account's models in the Manual list, under its provider. */
export interface ManualGroup {
  /** Absent while the provider has a single account that runs. */
  account?: ModelMenuAccount;
  rows: ModelMenuRow[];
}

export interface ManualProvider {
  section: ModelMenuSection;
  groups: ManualGroup[];
}

/** #5088 (owner, M-20261119-077, D-20261119-083): the Manual list is every
 * model grouped by provider, then by the account it runs on, with each
 * account's state. A model several accounts offer is listed under each; the
 * row of an account the menu does not lead with forces that account
 * (`pinAccount`, as the Account line does). An account with no model it can
 * run now (signed out) keeps its heading and its state. A search keeps the
 * rows that match, the provider's and the account's names included, and
 * drops what is left empty. */
export function manualProviders(providers: readonly ModelMenuSection[], query = ""): ManualProvider[] {
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  const matches = (section: ModelMenuSection, account: ModelMenuAccount | undefined, row: ModelMenuRow) => words.length === 0
    || filterModelSections([{ key: section.key, label: [section.label, account?.label].filter(Boolean).join(" "), rows: [row] }], query).length > 0;
  return providers.flatMap((section): ManualProvider[] => {
    const accounts = section.accounts;
    let groups: ManualGroup[];
    if (!accounts?.length) {
      groups = [{ rows: section.rows }];
    } else {
      const placed = new Set<string>();
      // the heading names the account: the row does not say it again, nor
      // "Special access" (a model only one account offers is listed under it alone)
      const underHeading = (row: ModelMenuRow): ModelMenuRow => {
        const { account: _account, accountRows: _accountRows, badge: _badge, ...rest } = row;
        return rest;
      };
      groups = accounts.map((account) => ({
        account,
        rows: section.rows.flatMap((row) => {
          if (row.instanceId === account.instanceId) {
            placed.add(row.key);
            return [underHeading(row)];
          }
          const other = row.alternatives?.find((candidate) => candidate.instanceId === account.instanceId);
          if (!other) return [];
          placed.add(row.key);
          return [{ ...underHeading(other), pinAccount: true as const }];
        }),
      }));
      // a row on an engine no account names keeps its place, after the accounts
      const rest = section.rows.filter((row) => !placed.has(row.key));
      if (rest.length) groups.push({ rows: rest });
    }
    const kept = groups.map((group) => ({ ...group, rows: group.rows.filter((row) => matches(section, group.account, row)) }))
      .filter((group) => group.rows.length > 0 || (words.length === 0 && group.account?.state !== undefined));
    return kept.length ? [{ section, groups: kept }] : [];
  });
}

/** The rows the arrow keys and Enter reach, in order. */
export function pickableRows(sections: readonly ModelMenuSection[]): ModelMenuRow[] {
  return sections.flatMap((section) => section.rows.filter((row) => !row.unavailable));
}

/** The row Enter picks: the one the person moved to, else the first match
 * while searching, else the current choice, else the first row. */
export function activeRowKey(rows: readonly Pick<ModelMenuRow, "key" | "current">[], moved: string | null, searching: boolean): string | null {
  if (moved && rows.some((row) => row.key === moved)) return moved;
  if (!searching) {
    const current = rows.find((row) => row.current);
    if (current) return current.key;
  }
  return rows[0]?.key ?? null;
}

/** One step of the arrow keys, wrapping at both ends. */
export function stepRow(rows: readonly Pick<ModelMenuRow, "key">[], from: string | null, key: "ArrowDown" | "ArrowUp" | "Home" | "End"): string | null {
  if (rows.length === 0) return null;
  const at = rows.findIndex((row) => row.key === from);
  const next = key === "Home" ? 0
    : key === "End" ? rows.length - 1
    : key === "ArrowDown" ? (at + 1) % rows.length
    : (at <= 0 ? rows.length : at) - 1;
  return rows[next]!.key;
}

// The composer's menu (2026-10-14: "too many models shown"): with an
// empty search the root is short, Auto and the bot's model, the current
// model when neither of them is it, the person's favorites, then one row
// per provider that opens its models in a submenu. A search lists every
// provider's matches flat, as before.

export interface ModelMenuProvider {
  /** `provider:` and the section's key: unique beside the rows' keys. */
  key: string;
  section: ModelMenuSection;
  /** The current model is one of its rows. */
  current: boolean;
}

export interface ModelMenuRoot {
  /** Auto, the bot's model: the section without a heading. */
  top: ModelMenuRow[];
  /** The model in effect when no top row is checked and it is no favorite. */
  current?: ModelMenuRow;
  /** The starred models still offered, in the order they were starred. */
  favorites: ModelMenuRow[];
  providers: ModelMenuProvider[];
}

export const PROVIDER_KEY_PREFIX = "provider:";
/** A favorite's row key in the root, beside the same model in its submenu. */
export const FAVORITE_KEY_PREFIX = "favorite:";
export const CURRENT_KEY_PREFIX = "current:";

/** The root of the composer's menu. The top section is the one without a
 * heading; every other section is a provider. */
export function modelMenuRoot(sections: readonly ModelMenuSection[], favoriteKeys: readonly string[]): ModelMenuRoot {
  const top = sections.filter((section) => !section.label).flatMap((section) => section.rows);
  const engines = sections.filter((section) => section.label && section.rows.length > 0);
  const models = engines.flatMap((section) => section.rows.filter((row) => row.kind === "model"));
  const favorites = favoriteKeys.flatMap((key) => models.filter((row) => row.key === key).slice(0, 1));
  const currentRow = top.some((row) => row.current) ? undefined : models.find((row) => row.current);
  return {
    top,
    current: currentRow && !favoriteKeys.includes(currentRow.key) ? currentRow : undefined,
    favorites,
    providers: engines.map((section) => ({ key: `${PROVIDER_KEY_PREFIX}${section.key}`, section, current: section.rows.some((row) => row.current) })),
  };
}

/** What the arrow keys reach in the root, in order: the rows that can be
 * picked, under the keys the root draws them with, then the providers. */
export function modelMenuRootEntries(root: ModelMenuRoot): Array<{ key: string; current: boolean; row?: ModelMenuRow; provider?: ModelMenuProvider }> {
  const pickable = (row: ModelMenuRow) => !row.unavailable;
  return [
    ...root.top.filter(pickable).map((row) => ({ key: row.key, current: row.current, row })),
    ...(root.current && pickable(root.current) ? [{ key: `${CURRENT_KEY_PREFIX}${root.current.key}`, current: true, row: root.current }] : []),
    ...root.favorites.filter(pickable).map((row) => ({ key: `${FAVORITE_KEY_PREFIX}${row.key}`, current: row.current, row })),
    ...root.providers.map((provider) => ({ key: provider.key, current: false, provider })),
  ];
}

// The providers sit behind one "Provider ›" row (Simple since the maintainer
// 2026-10-14, every mode since 2026-10-18) under Auto, the bot's model
// and the favorites. Opening it lists the providers in place of the root,
// each still opening its own submenu.

/** The "Provider" row's key in the root (named "all models" first). */
export const ALL_MODELS_KEY = "all-models";

export type ModelMenuEntry = { key: string; current: boolean; row?: ModelMenuRow; provider?: ModelMenuProvider; all?: true };

/** The root's entries with the providers grouped: the root rows then one
 * "Provider" entry (when there is any provider), or, once it is open,
 * the providers alone. */
export function groupedModelMenuEntries(root: ModelMenuRoot, allOpen: boolean): ModelMenuEntry[] {
  const entries: ModelMenuEntry[] = modelMenuRootEntries(root);
  const providers = entries.filter((entry) => entry.provider);
  if (allOpen) return providers;
  const rest = entries.filter((entry) => !entry.provider);
  return providers.length > 0
    ? [...rest, { key: ALL_MODELS_KEY, current: false, all: true }]
    : rest;
}

/** Cap on models shown per provider before "Show more" (#2181). */
export const PROVIDER_MODEL_PREVIEW = 4;

/** The models a provider section shows before "Show more": up to
 * {@link PROVIDER_MODEL_PREVIEW} in list order, always keeping the current
 * model and any favorite that lives in that provider. Expanded or a short
 * list returns every row. */
export function previewProviderRows(
  rows: readonly ModelMenuRow[],
  options: { expanded: boolean; favoriteKeys?: readonly string[] } = { expanded: false },
): { rows: ModelMenuRow[]; hidden: number } {
  if (options.expanded || rows.length <= PROVIDER_MODEL_PREVIEW) {
    return { rows: [...rows], hidden: 0 };
  }
  const favorites = new Set(options.favoriteKeys ?? []);
  const picked = new Set<string>();
  for (const row of rows) {
    if (row.current) {
      picked.add(row.key);
      break;
    }
  }
  for (const row of rows) {
    if (picked.size >= PROVIDER_MODEL_PREVIEW) break;
    if (favorites.has(row.key)) picked.add(row.key);
  }
  for (const row of rows) {
    if (picked.size >= PROVIDER_MODEL_PREVIEW) break;
    picked.add(row.key);
  }
  const visible = rows.filter((row) => picked.has(row.key));
  return { rows: visible, hidden: rows.length - visible.length };
}
