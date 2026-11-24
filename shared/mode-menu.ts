// The mode menu, one definition for the two products (owner, 2026-11-23,
// M-20261123-040, M-20261123-045, M-20261123-047): the Sagax app's composer
// and the Perspicax console draw the same rows, in the same order, by these
// rules. This file imports nothing, so the console keeps a byte-identical copy
// (`console/src/lib/mode-menu.ts`); a test on each side pins the same cases.
//
//   Auto / Fast / Expert / Heavy / Build
//   ──────────
//   Reasoning        <level>  ›   (the levels of the model in use)
//   ──────────
//   All models                ›   (provider › account › model)
//
// - A mode the server cannot serve now is not drawn (Auto always is).
// - Reasoning is a row that opens the levels of the model in use. Under a mode
//   that sets its own level (Fast, Expert, Heavy) it is greyed and shows the
//   level the mode imposes. A model with no level and no imposed one has no row.
// - All models is a cascade of three panels: the provider, then the account,
//   then the model. A provider with a single account skips the account panel.
//   Only what can run a turn now is listed: an account signed out or at its
//   limit, a model turned off, and a provider left with nothing are absent.
//   "Local" is a provider; its local servers stand where the accounts do.

/** The modes, in the menu's order. */
export const MENU_MODES = ["auto", "fast", "expert", "heavy", "build"] as const;
export type MenuMode = (typeof MENU_MODES)[number];

/** The modes that set their own reasoning level every turn. */
export const EFFORT_SETTING_MODES: readonly MenuMode[] = ["fast", "expert", "heavy"];

export function isMenuMode(value: unknown): value is MenuMode {
  return typeof value === "string" && (MENU_MODES as readonly string[]).includes(value);
}

export function modeSetsEffort(mode: string | null | undefined): boolean {
  return typeof mode === "string" && (EFFORT_SETTING_MODES as readonly string[]).includes(mode);
}

/** The id of the "Local" provider in the cascade. */
export const LOCAL_PROVIDER_ID = "local";

// ── Reasoning ────────────────────────────────────────────────────────────

export interface ReasoningInput {
  /** The mode in use; null for a model the person picked in All models. */
  mode: string | null;
  /** The levels the model in use takes, ascending; empty when it takes none. */
  levels: readonly string[];
  /** The level the person chose, when the model takes it. */
  value?: string;
  /** The level the model runs at when none is sent. */
  modelDefault?: string;
  /** The level the mode imposes now (Fast, Expert, Heavy), when known. */
  imposed?: string;
}

export interface ReasoningRow {
  /** False: the menu has no Reasoning row (and no separator of its own). */
  shown: boolean;
  /** Greyed: the mode sets the level, the row opens nothing. */
  disabled: boolean;
  /** The level the row shows at its right; undefined reads as "Default". */
  value?: string;
  /** The submenu's choices, in order; null is "Default" (no level sent),
   * offered only while the model names no default of its own. */
  choices: Array<string | null>;
}

export function reasoningRow(input: ReasoningInput): ReasoningRow {
  if (modeSetsEffort(input.mode)) {
    return { shown: Boolean(input.imposed), disabled: true, value: input.imposed, choices: [] };
  }
  const levels = [...input.levels];
  if (levels.length === 0) return { shown: false, disabled: true, choices: [] };
  const chosen = input.value !== undefined && levels.includes(input.value) ? input.value : undefined;
  const fallback = input.mode !== "auto" && input.modelDefault !== undefined && levels.includes(input.modelDefault) ? input.modelDefault : undefined;
  return { shown: true, disabled: false, value: chosen ?? fallback, choices: fallback ? levels : [null, ...levels] };
}

// ── The rows ─────────────────────────────────────────────────────────────

export type MenuRow =
  | { kind: "mode"; id: MenuMode }
  | { kind: "separator" }
  | { kind: "reasoning" }
  | { kind: "all" };

/** The menu's rows, top to bottom. `offered`: the modes the server serves now
 * (undefined while it has not answered: every mode shows). */
export function menuRows(input: { offered?: readonly string[]; reasoning: boolean; all: boolean }): MenuRow[] {
  const modes = MENU_MODES.filter((mode) => mode === "auto" || !input.offered || input.offered.includes(mode));
  const rows: MenuRow[] = modes.map((id) => ({ kind: "mode", id }));
  if (input.reasoning) rows.push({ kind: "separator" }, { kind: "reasoning" });
  if (input.all) rows.push({ kind: "separator" }, { kind: "all" });
  return rows;
}

// ── All models: provider › account › model ───────────────────────────────

export interface CascadeModel<T = unknown> {
  id: string;
  label: string;
  /** False: it cannot run a turn now (turned off, refused): not listed. */
  usable: boolean;
  /** The model in use. */
  current?: boolean;
  /** A quiet word at the row's right (a context size). */
  note?: string;
  /** What the product needs to pick it. */
  data: T;
}

export interface CascadeAccount<T = unknown> {
  id: string;
  label: string;
  /** False: signed out, at its limit, out of credits: not listed. */
  usable: boolean;
  models: CascadeModel<T>[];
}

export interface CascadeProvider<T = unknown> {
  id: string;
  label: string;
  accounts: CascadeAccount<T>[];
}

/** Only what can run a turn now: the usable models of the usable accounts;
 * an account left with no model and a provider left with no account go. */
export function usableCascade<T>(providers: readonly CascadeProvider<T>[]): CascadeProvider<T>[] {
  return providers.flatMap((provider) => {
    const accounts = provider.accounts.flatMap((account) => {
      if (!account.usable) return [];
      const models = account.models.filter((model) => model.usable);
      return models.length ? [{ ...account, models }] : [];
    });
    return accounts.length ? [{ ...provider, accounts }] : [];
  });
}

/** The panel a provider opens: its accounts, or its models at once when it
 * has a single account. */
export function providerOpens(provider: Pick<CascadeProvider, "accounts">): "account" | "model" {
  return provider.accounts.length > 1 ? "account" : "model";
}

/** Where the cascade stands: the root menu, the reasoning levels, or a step of All models. */
export type MenuPanel =
  | { panel: "root" }
  | { panel: "reasoning" }
  | { panel: "providers" }
  | { panel: "accounts"; provider: string }
  | { panel: "models"; provider: string; account: string };

/** The panel a click on a provider opens. */
export function openProvider(provider: CascadeProvider): MenuPanel {
  return providerOpens(provider) === "account"
    ? { panel: "accounts", provider: provider.id }
    : { panel: "models", provider: provider.id, account: provider.accounts[0]?.id ?? "" };
}

/** The panel the back row returns to (a skipped account panel is skipped on the way back too). */
export function panelBack(at: MenuPanel, providers: readonly CascadeProvider[]): MenuPanel {
  if (at.panel === "models") {
    const provider = providers.find((candidate) => candidate.id === at.provider);
    return provider && providerOpens(provider) === "account" ? { panel: "accounts", provider: at.provider } : { panel: "providers" };
  }
  if (at.panel === "accounts") return { panel: "providers" };
  return { panel: "root" };
}

/** A panel that names a provider or an account no longer listed falls back
 * one step, so the menu never draws an empty panel. */
export function settlePanel(at: MenuPanel, providers: readonly CascadeProvider[]): MenuPanel {
  if (at.panel !== "accounts" && at.panel !== "models") return at;
  const provider = providers.find((candidate) => candidate.id === at.provider);
  if (!provider) return { panel: "providers" };
  if (at.panel === "accounts") return providerOpens(provider) === "account" ? at : openProvider(provider);
  return provider.accounts.some((account) => account.id === at.account) ? at : openProvider(provider);
}

/** The model in use, with where it sits, when the cascade lists it. */
export function currentInCascade<T>(providers: readonly CascadeProvider<T>[]): { provider: CascadeProvider<T>; account: CascadeAccount<T>; model: CascadeModel<T> } | undefined {
  for (const provider of providers) {
    for (const account of provider.accounts) {
      const model = account.models.find((candidate) => candidate.current);
      if (model) return { provider, account, model };
    }
  }
  return undefined;
}
