// The model panel (owner decision, 2026-11-17: the composer's model picker
// becomes the reference's compact panel; 2026-11-19: short by default). One
// component for every place the model menu opens (composer chip, bot Model
// row, wizard, team settings, launch composer). It opens short: Auto, the
// person's favorites (and the model in use when it is not one), then "All
// models". "All models" is the long list: a segment per provider, that
// provider's models each with a star to add or remove a favorite, a search
// field past a few rows. Below, "Reasoning" (the levels the model really
// takes) and a quiet footer (Runs with, Manage models). Favorites follow the
// person, not the bot (src/lib/model-favorites.ts, GET/PUT /api/me/models).
//
// #5088, then the owner on 2026-11-23 (M-20261123-040, M-20261123-045,
// M-20261123-047): in the composer the short view is the mode menu instead
// (ModeMenu.tsx, the rows of shared/mode-menu.ts, the same as the Perspicax
// console's): Auto, Fast, Expert, Heavy, Build, then Reasoning, then All
// models (D-20261124-002: Auto's Optimize for is no row of this menu, it is
// set in Manage models and in a bot's Model cell of Settings). Reasoning and
// All models open beside the menu, which stays on screen (owner 2026-11-25,
// M-20261125-035, D-20261125-012, #5338: cascading submenus, ModeMenuLevel.tsx,
// no page replacing the menu and no back row): Reasoning lists the levels of
// the model in use; All models is a cascade, the provider, then the account
// (skipped when the provider has one), then the model, each level beside the
// row that opened it, listing only what can run a turn now
// (src/lib/model-menu.ts modelCascade). A click, a rest of the pointer or the
// right arrow opens a level; Escape or the left arrow closes the deepest one.
// The starred favorites lead the
// provider level and the star still adds or removes one. Account, Runs with
// and Manage models stay in the footer; a model turned off is turned back on
// in Manage models, the menu no longer counts them.
import { useEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Search, Star } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { effortLabel } from "@/lib/effort-label";
import { isUltracodeEffort } from "../../shared/ultracode-effort";
import { AUTO_OPTIMIZE_VALUES, type AutoOptimize } from "../../shared/model-auto-optimize";
import type { EffortLevel } from "../../shared/wire";
import { filterModelSections, modelCascade, type ModelMenuRow, type ModelMenuSection } from "@/lib/model-menu";
import { currentInCascade, openProvider, panelBack, providerOpens, reasoningRow, settlePanel, type MenuPanel, type ReasoningRow } from "../../shared/mode-menu";
import { ModeMenu, type ModeMenuProps } from "./ModeMenu";
import { ModeMenuLevel } from "./ModeMenuLevel";
import { CLOSE_DELAY_MS, OPEN_DELAY_MS } from "./SidebarPopoverMenu";
import { runsWithOptionLabel, runsWithShown, type RunsWithChoice } from "@/lib/runs-with";
import { ModelMenuSettings, type ContextSizeChoice } from "./ModelMenuSettings";
import { foldItems, foldMoreLabel } from "./ShowMoreFold";
import { SHOW_MORE_ROW } from "@/lib/grouped-card";
import { MODELS_SHOWN } from "./settings/ModelSwitchesSettings";
import { SegmentedChoice } from "./SegmentedChoice";

/** A provider with more models than this gets a search field over its list. */
export const PANEL_SEARCH_FROM = 8;

type ViewKey = string;

export interface ModelPanelProps {
  sections: ModelMenuSection[];
  onPick: (row: ModelMenuRow) => void;
  disabled?: boolean;
  favorites: { keys: readonly string[]; onToggle: (row: ModelMenuRow) => void };
  /** Each provider's mark, by section key. */
  mark: (sectionKey: string) => ReactNode;
  autoOn: boolean;
  /** The Optimize choice (Intelligence, Balance, Cost) while Auto is on;
   * never drawn in the mode menu (D-20261124-002). */
  optimize?: { value: AutoOptimize; onPick: (value: AutoOptimize) => void };
  effort?: {
    title: string;
    levels: readonly EffortLevel[];
    value?: EffortLevel;
    modelDefault?: EffortLevel;
    onPick: (level: EffortLevel | undefined) => void;
  };
  /** An engine with model variants draws its own row in place of the levels. */
  variantRow?: ReactNode;
  fast?: { on: boolean; onToggle: () => void };
  contextSize?: readonly ContextSizeChoice[];
  runsWith?: readonly RunsWithChoice[];
  /** Footer links: "Manage models" (with how many are off), or the settings pair. */
  manage?: { onManage?: () => void; turnedOff: number; openActiveModels?: () => void; openProviders: () => void };
  custom?: { label: (text: string) => string; onPick: (text: string) => void };
  /** Hide the settings (Simple mode keeps the panel's model list only). */
  showSettings: boolean;
  /** Which list opens: the short one (Auto, the person's favorites, "All models") or every provider's models. */
  view?: "short" | "all";
  /** #5088, M-20261123-045: the composer's mode menu (Auto, Fast, Expert,
   * Heavy, Build, Reasoning, All models) as the short view; "all" then opens
   * on the providers of All models. `pinnedLabel` names the model the person
   * pinned while it runs. */
  modes?: Pick<ModeMenuProps, "current" | "resolutions" | "onPick"> & { pinnedLabel?: string };
}

/** The provider the "All models" list opens on: the one that holds the current
 * model, else the first provider. */
export function initialPanelView(sections: readonly ModelMenuSection[]): ViewKey {
  const providers = panelProviders(sections);
  return (providers.find((section) => section.rows.some((row) => row.current)) ?? providers[0])?.key ?? "";
}

export function panelProviders(sections: readonly ModelMenuSection[]): ModelMenuSection[] {
  return sections.filter((section) => section.label && section.key !== "top" && section.key !== "favorites" && section.rows.length > 0);
}

/** One line under a model's name: what the app knows (a local model's
 * origin, its context size); nothing otherwise, never invented text. */
export function rowDescription(row: ModelMenuRow): string | undefined {
  return row.warning ?? row.subtext ?? (row.kind === "follow" ? row.detail : undefined) ?? row.description;
}

const SEGMENT_BASE = "flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 motion-reduce:transition-none";
const SEGMENT_ON = "flex-1 bg-popover font-medium text-popover-ink shadow-[0_1px_2px_rgb(0_0_0/0.18)]";
const SEGMENT_OFF = "text-popover-ink-secondary hover:text-popover-ink";
// M-20261119-051: a heading starts where the rows' names start (6px of list, 8px of row)
const HEADING = "shrink-0 px-3.5 pb-1 pt-2 text-[12px] leading-4 text-popover-ink-secondary";
// the favorites' heading over the providers of All models (the list's own 6px already in)
const GROUP_HEADING = "px-2 pb-0.5 pt-2 text-[12px] leading-4 text-popover-ink-secondary";

/** The right column of every row (M-20261119-051, "nothing lines up"): the
 * row's text at the right ends on one edge, then a fixed icon zone of two
 * slots, the same on every row. The icon slot (28px, the outer one) holds
 * the row's one icon: the check of the choice in use, a model's star, the
 * chevron of All models; every one of them falls on the same centre. The
 * side slot (20px) holds the star of the model in use only, beside its
 * check; it stays empty on every other row. */
export const ROW_SIDE_SLOT = "flex w-5 shrink-0 items-center justify-center";
export const ROW_ICON_SLOT = "flex size-7 shrink-0 items-center justify-center";
// a row of the mode menu's panels (a level, a provider, an account): ModeMenu.tsx's row
const PANEL_ROW = "group flex h-9 items-center gap-1 rounded-lg hover:bg-popover-hover focus-within:bg-popover-hover";
const PANEL_ROW_BUTTON = "flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-2 text-left text-[13px] text-popover-ink outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";

/** The room All models asks of one side of the menu before it opens there: its three levels (providers, accounts, models) side by side. */
const CASCADE_ROOM = 900;

/** Two places of the cascade are the same level. */
function samePanel(a: MenuPanel, b: MenuPanel): boolean {
  return a.panel === b.panel && ("provider" in a ? a.provider : "") === ("provider" in b ? b.provider : "") && ("account" in a ? a.account : "") === ("account" in b ? b.account : "");
}
/** The row that opens a level, as a selector (the level is placed beside it and the focus returns to it). */
function levelAnchor(level: MenuPanel, viaAccount: boolean): string {
  if (level.panel === "reasoning") return '[data-mode-row="reasoning"]';
  if (level.panel === "accounts" || (level.panel === "models" && !viaAccount)) return `[data-model-cascade-provider=${JSON.stringify(level.provider)}]`;
  if (level.panel === "models") return `[data-model-cascade-account=${JSON.stringify(level.account)}]`;
  return '[data-mode-row="all"]';
}

/** Arrow keys over the radios of a group: moves the focus and picks, Home and End go to either end. */
function arrowRadios(event: KeyboardEvent<HTMLElement>, selector: string, orientation: "horizontal" | "vertical" | "both") {
  const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
  const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
  const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
  if ((!forward && !back && event.key !== "Home" && event.key !== "End")
    || (orientation === "horizontal" && vertical) || (orientation === "vertical" && (event.key === "ArrowLeft" || event.key === "ArrowRight"))) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)].filter((node) => !(node as HTMLButtonElement).disabled);
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const to = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (at + (forward ? 1 : -1) + items.length) % items.length;
  event.preventDefault();
  // the menu's own keys must not also move another list
  event.stopPropagation();
  items[to]?.focus();
}

export function ModelPanel(props: ModelPanelProps) {
  const { sections, onPick, disabled = false, favorites, mark, autoOn, optimize, effort, variantRow, fast, contextSize, runsWith, manage, custom, showSettings, view: openOn = "short", modes } = props;
  const providers = panelProviders(sections);
  const top = sections.filter((section) => !section.label).flatMap((section) => section.rows);
  const autoRow = top.find((row) => row.kind === "auto");
  const leadRows = top.filter((row) => row.kind === "follow" || row.kind === "keep");
  const favoriteRows = sections.find((section) => section.key === "favorites")?.rows ?? [];
  const [all, setAll] = useState(openOn === "all" && !modes);
  // the mode menu's deepest level open: none (the rows alone), the reasoning levels, or a step of All models
  const [panel, setPanel] = useState<MenuPanel>(() => (modes && openOn === "all" ? { panel: "providers" } : { panel: "root" }));
  // a click or a key moves the focus into the level it opens; a rest of the pointer leaves it where it is
  const [focusLevel, setFocusLevel] = useState(() => Boolean(modes) && openOn === "all");
  const [rest] = useState(() => ({ timer: null as ReturnType<typeof setTimeout> | null }));
  const [chosen, setView] = useState<ViewKey>(() => initialPanelView(sections));
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // no useId or useRef: the interaction harness runs this function outside React
  const modelsId = "model-panel-models";
  const [listRef] = useState(() => ({ current: null as HTMLDivElement | null }));
  // a provider that vanished falls back to the one holding the current model
  const view = providers.some((section) => section.key === chosen) ? chosen : initialPanelView(sections);

  // "All models": every provider is a segment (the person's favorites replace the old pinned providers)
  const segments: Array<{ key: ViewKey; label: string; icon: ReactNode; current: boolean }> = providers.map((section) => ({
    key: section.key, label: section.label ?? section.key, icon: mark(section.key), current: !autoOn && section.rows.some((row) => row.current),
  }));

  const section = providers.find((candidate) => candidate.key === view);
  // M-20261123-045: All models as a cascade, only what can run now
  const cascade = modes ? modelCascade(providers, { local: t("model.localGroup"), thisComputer: t("model.computerProvider") }) : [];
  const at: MenuPanel = modes ? settlePanel(panel, cascade) : { panel: "root" };
  const atProvider = at.panel === "accounts" || at.panel === "models" ? cascade.find((candidate) => candidate.id === at.provider) : undefined;
  const atAccount = at.panel === "models" ? atProvider?.accounts.find((candidate) => candidate.id === at.account) : undefined;
  const cascadeCurrent = modes && modes.current === null ? currentInCascade(cascade) : undefined;
  // the levels on screen beside the menu, the nearest first: the whole path stays visible (D-20261125-012)
  const viaAccount = Boolean(atProvider && providerOpens(atProvider) === "account");
  const levels: MenuPanel[] = at.panel === "root" ? [] : at.panel === "reasoning" || at.panel === "providers" ? [at]
    : at.panel === "accounts" ? [{ panel: "providers" }, at]
    : [{ panel: "providers" }, ...(viaAccount ? [{ panel: "accounts", provider: at.provider } as MenuPanel] : []), at];
  const inAll = levels[0]?.panel === "providers";
  const cascadeFavorites = inAll ? favoriteRows.filter((row) => !row.unavailable) : [];
  const viewRows: ModelMenuRow[] = modes ? (atAccount?.models.map((one) => one.data) ?? []) : !all ? [] : section?.rows ?? [];
  const searchable = (modes ? at.panel === "models" : all) && viewRows.length > PANEL_SEARCH_FROM;
  const typed = searchable ? query.trim() : "";
  const shownRows = typed ? filterModelSections([{ key: view, label: "", rows: viewRows }], typed).flatMap((candidate) => candidate.rows) : viewRows;
  const lead = typed ? [] : leadRows;
  // the first rows, then "Show N more"; the model in use is never folded away, a search lists every match
  const fold = typed || modes ? { head: shownRows, rest: [] as ModelMenuRow[] } : foldItems(shownRows, MODELS_SHOWN, (candidate) => candidate.current);
  const listedRows = expanded ? [...fold.head, ...fold.rest] : fold.head;
  // the short list: the favorites, then the model in use when it is not one of them (it never hides)
  const shortModels: ModelMenuRow[] = all ? [] : [
    ...favoriteRows,
    ...(autoOn ? [] : providers.flatMap((candidate) => candidate.rows).filter((candidate) => candidate.current && !favoriteRows.some((fav) => fav.key === candidate.key))),
  ];

  // the focus lands on the model in use (or the search field of a long list)
  useEffect(() => {
    const root = listRef.current?.closest<HTMLElement>("[data-model-panel]");
    if (modes && panel.panel !== "root") return;
    const target = root?.querySelector<HTMLElement>("[data-model-panel-search]") ?? root?.querySelector<HTMLElement>('[data-model-panel-row][aria-checked="true"]') ?? root?.querySelector<HTMLElement>("[data-model-panel-row]");
    target?.focus({ preventScroll: true });
    // when the panel opens; a level of the mode menu takes the focus itself (ModeMenuLevel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { if (rest.timer) clearTimeout(rest.timer); }, [rest]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [view]);

  const switchView = (key: ViewKey) => {
    setView(key);
    setQuery("");
    setExpanded(false);
  };
  const showAll = (next: boolean) => {
    setAll(next);
    setQuery("");
    setExpanded(false);
  };
  const settle = () => {
    if (rest.timer) clearTimeout(rest.timer);
    rest.timer = null;
  };
  const go = (next: MenuPanel, focus = true) => {
    settle();
    setPanel(next);
    setFocusLevel(focus);
    setQuery("");
  };
  /** Escape or the left arrow: the deepest level closes, the focus back on the row that opened it. */
  const closeLevel = () => {
    if (typeof document !== "undefined") document.querySelector<HTMLElement>(levelAnchor(at, viaAccount))?.focus({ preventScroll: true });
    go(panelBack(at, cascade), false);
  };
  /** The pointer came on a row. One that opens a level opens it after a
   * short rest; any row closes what is open past its own level, slowly
   * enough to forgive a diagonal path to the level beside it. */
  const restOn = (event: PointerEvent, next: MenuPanel, opens: boolean) => {
    if (event.pointerType !== "mouse") return;
    settle();
    if (opens ? levels.some((level) => samePanel(level, next)) : samePanel(next, at)) return;
    const depth = next.panel === "root" ? 0 : next.panel === "reasoning" || next.panel === "providers" ? 1 : next.panel === "accounts" ? 2
      : cascade.some((provider) => provider.id === next.provider && providerOpens(provider) === "account") ? 3 : 2;
    rest.timer = setTimeout(() => go(next, false), opens && levels.length < depth ? OPEN_DELAY_MS : CLOSE_DELAY_MS);
  };

  // every row is one line, the same height: the name and its markers at the left,
  // what the app knows (context size, origin, a warning) muted at the right;
  // M-20261119-015: a row that names its account takes that second line
  // a thread's "use the bot's model" row leads All models, as it led the Manual list
  const cascadeLead = modes && inAll ? leadRows : [];
  const rovingRows = modes ? listedRows : all ? [...lead, ...listedRows] : [...(autoRow ? [autoRow] : []), ...lead, ...shortModels];
  // in the mode menu each level roves on its own rows: the models of an account, or the rows that lead the providers
  const providerLevelRows = [...cascadeLead, ...cascadeFavorites];
  const modelRow = (row: ModelMenuRow, group?: string, level?: MenuPanel) => {
    const roving = level?.panel === "providers" ? providerLevelRows : rovingRows;
    const rovingHasCurrent = (modes || all ? false : autoOn) || roving.some((candidate) => candidate.current);
    const rovingFirst = roving[0];
    const starred = favorites.keys.includes(row.key);
    const description = rowDescription(row);
    const check = row.current ? <Check size={14} aria-hidden="true" className="text-popover-accent" /> : null;
    // a model's star: in the icon slot, or in the side slot beside the check of the model in use
    const star = row.kind === "model" ? (slot: string) => (
      <button type="button" aria-pressed={starred} data-model-favorite={row.key}
        aria-label={t(starred ? "model.favorite.remove" : "model.favorite.add", { name: row.label })}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => favorites.onToggle(row)}
        className={cn(slot, "h-7 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus",
          starred ? "text-popover-accent" : "text-popover-ink-secondary opacity-0 hover:text-popover-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100")}>
        <Star size={13} aria-hidden="true" fill={starred ? "currentColor" : "none"} />
      </button>
    ) : undefined;
    const nameLine = (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-[13px] text-popover-ink">{row.label}</span>
        {row.tags?.map((tag) => (
          <span key={tag} className="shrink-0 rounded bg-popover-field px-1 text-[11px] leading-4 text-popover-ink-secondary">{tag}</span>
        ))}
      </span>
    );
    return (
      <div key={`${group ?? (all ? view : "short")}:${row.key}`} className={cn("group flex", row.account ? "min-h-11 py-0.5" : "h-9", "items-center gap-1 rounded-lg hover:bg-popover-hover focus-within:bg-popover-hover")}>
        <button type="button" role="radio" aria-checked={row.current} data-model-panel-row={row.key} data-model-option={row.modelId} data-model-row-kind={row.kind} data-follow-bot-model={row.kind === "follow" ? "true" : undefined}
          disabled={disabled || Boolean(row.unavailable)} title={row.unavailable ?? ([row.title ?? (description ? `${row.label} · ${description}` : undefined), row.account].filter(Boolean).join(" · ") || undefined)}
          tabIndex={row.current || (!rovingHasCurrent && row === rovingFirst) ? 0 : -1}
          onMouseDown={(event) => event.preventDefault()}
          onPointerEnter={level ? (event) => restOn(event, level, false) : undefined}
          onClick={() => onPick(row)}
          className={cn("flex h-full min-w-0 flex-1 items-center gap-1 rounded-lg pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50", row.unavailable && "opacity-60")}>
          {row.account ? (
            // M-20261119-015: the account this row runs on, under its name, while the provider has several
            <span className="flex min-w-0 flex-1 flex-col justify-center">
              {nameLine}
              <span className="flex min-w-0 items-center gap-1.5">
                <span data-model-row-account className="truncate text-[11.5px] leading-4 text-popover-ink-secondary">{row.account}</span>
                {/* only this account of the person's offers the model */}
                {row.badge && (
                  <span data-model-badge title={row.badge.title} className="shrink-0 rounded bg-popover-field px-1 text-[11px] leading-4 text-popover-accent">{row.badge.label}</span>
                )}
              </span>
            </span>
          ) : nameLine}
          {description && <span data-model-panel-description data-model-row-warning={row.warning ? "" : undefined} className="max-w-[45%] shrink-0 truncate pl-1 text-right text-[12px] text-popover-ink-secondary">{description}</span>}
          {/* the icon zone (ROW_SIDE_SLOT, ROW_ICON_SLOT); a model's star is a button of its own beside this one */}
          {!(star && row.current) && <span aria-hidden="true" className={ROW_SIDE_SLOT} />}
          {!star && <span aria-hidden="true" className={ROW_ICON_SLOT}>{check}</span>}
        </button>
        {star && (row.current ? (
          <>
            {star(ROW_SIDE_SLOT)}
            <span aria-hidden="true" className={ROW_ICON_SLOT}>{check}</span>
          </>
        ) : star(ROW_ICON_SLOT))}
      </div>
    );
  };

  // M-20261119-051: Auto's one setting on one 32px line under it, the
  // shared small segmented control at the right, no empty band
  const optimizeRow = (choice: NonNullable<ModelPanelProps["optimize"]>) => (
    <div data-model-auto-optimize-row className="flex h-8 items-center justify-between gap-3 pl-2 pr-2">
      <span className="min-w-0 truncate text-[12px] text-popover-ink-secondary">{t("model.auto.optimizeTitle")}</span>
      <SegmentedChoice data-model-auto-optimize="" label={t("model.auto.optimizeTitle")} disabled={disabled}
        value={choice.value} onPick={choice.onPick}
        options={AUTO_OPTIMIZE_VALUES.map((value) => ({
          value, label: t(`model.auto.optimize.${value}`), data: { "data-model-auto-optimize-option": value },
        }))} />
    </div>
  );
  const effortLevels = effort?.levels ?? [];
  // the model's own default level reads as the checked one while none is chosen
  const effortValue = effort ? (effort.value && effortLevels.includes(effort.value) ? effort.value : effort.modelDefault) : undefined;
  const effortChoices: Array<EffortLevel | undefined> = effort && !effort.modelDefault ? [undefined, ...effortLevels] : [...effortLevels];
  // M-20261123-040: in the mode menu the reasoning is a row that opens the
  // levels of the model in use; Fast, Expert and Heavy set their own each
  // turn, so the row is greyed and shows the level they impose
  const imposed = modes && modes.current ? modes.resolutions?.[modes.current]?.effort : undefined;
  const levelsRow = reasoningRow({ mode: modes?.current ?? null, levels: effortLevels, value: effort?.value, modelDefault: effort?.modelDefault, imposed });
  // an engine with model variants draws its own control in the panel
  const reasoningState: ReasoningRow = variantRow && !levelsRow.disabled ? { shown: true, disabled: false, choices: [] } : levelsRow;
  const reasoningLabel = (level: string | undefined) => (level ? effortLabel(level as EffortLevel) : modes?.current === "auto" ? t("model.mode.auto.name") : variantRow ? "" : t("model.defaultTag"));
  const hasReasoning = showSettings && !modes && (Boolean(variantRow) || effortLevels.length > 0);
  const runsShown = !autoOn && runsWith && runsWithShown(runsWith) ? runsWith : undefined;
  const runsCurrent = runsShown?.find((choice) => choice.current);
  // M-20261119-015: the model in use is offered by several of the person's
  // accounts: the one it runs on, and the others to move it to
  const inUse = autoOn ? undefined : providers.flatMap((candidate) => candidate.rows).find((candidate) => candidate.current);
  const accountChoices = inUse?.accountRows && inUse.accountRows.length > 1 ? inUse.accountRows : undefined;

  const searchField = searchable && (
    <label className="mx-1.5 mb-1 flex shrink-0 items-center gap-2 border-b border-popover-hairline px-2 py-1.5">
      <Search size={13} aria-hidden="true" className="shrink-0 text-popover-ink-secondary" />
      <input data-model-panel-search value={query} onChange={(event) => setQuery(event.target.value)}
        placeholder={t("model.search")} aria-label={t("model.search")}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.preventDefault();
            event.stopPropagation();
            setQuery("");
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            (modes ? event.currentTarget.closest("[data-mode-level]") : listRef.current)?.querySelector<HTMLElement>("[data-model-panel-row]:not([disabled])")?.focus();
          } else if (event.key === "Enter" && typed) {
            event.preventDefault();
            const first = shownRows.find((row) => !row.unavailable);
            if (first) onPick(first);
            else if (custom) custom.onPick(typed);
          }
        }}
        className="w-full bg-transparent text-[13px] text-popover-ink placeholder:text-popover-placeholder focus:outline-none" />
    </label>
  );

  // the mode menu's levels (D-20261125-012): each one's rows, drawn beside the row that opened it
  const levelLabel = (level: MenuPanel) => (level.panel === "reasoning" ? t("model.reasoning") : level.panel === "providers" ? t("model.auto.rail")
    : level.panel === "accounts" ? atProvider?.label ?? "" : viaAccount ? `${atProvider?.label ?? ""} · ${atAccount?.label ?? ""}` : atProvider?.label ?? "");
  const levelRows = (level: MenuPanel): ReactNode => {
    if (!modes) return null;
    if (level.panel === "reasoning") {
      return variantRow ? <div className="px-2 py-1.5">{variantRow}</div> : effort && reasoningState.choices.map((choice) => {
        const on = (choice ?? undefined) === reasoningState.value;
        return (
          <div key={choice ?? "default"} className={PANEL_ROW}>
            <button type="button" role="radio" aria-checked={on} disabled={disabled}
              data-model-panel-row={`effort:${choice ?? "default"}`} data-model-effort-choice={choice ?? "default"}
              title={choice === null ? t("model.effort.defaultTitle") : isUltracodeEffort(choice as EffortLevel) ? t("model.effort.ultracodeHint") : t("model.effort.levelTitle", { level: effortLabel(choice as EffortLevel) })}
              tabIndex={on || (reasoningState.value === undefined && choice === reasoningState.choices[0]) ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()}
              // the model's own default level is picked as "no level sent"
              onClick={() => { effort.onPick(choice === null || (modes.current !== "auto" && choice === effort.modelDefault) ? undefined : choice as EffortLevel); go({ panel: "root" }, false); }}
              className={PANEL_ROW_BUTTON}>
              <span className={cn("min-w-0 flex-1 truncate", choice !== null && isUltracodeEffort(choice as EffortLevel) && "ultracode-effort-option")}>{reasoningLabel(choice ?? undefined)}</span>
              <span aria-hidden="true" className={ROW_SIDE_SLOT} />
              <span aria-hidden="true" className={ROW_ICON_SLOT}>{on && <Check size={14} className="text-popover-accent" />}</span>
            </button>
          </div>
        );
      });
    }
    if (level.panel === "providers") {
      return (
        <>
          {cascadeLead.map((row) => modelRow(row, undefined, level))}
          {cascadeFavorites.length > 0 && (
            <div data-model-cascade-favorites="">
              <div className={GROUP_HEADING}>{t("model.favorites")}</div>
              {cascadeFavorites.map((row) => modelRow(row, "favorites", level))}
              <div role="separator" className="mx-2 my-1 border-t border-popover-hairline" />
            </div>
          )}
          {cascade.map((provider) => {
            const on = cascadeCurrent?.provider.id === provider.id;
            const opened = atProvider?.id === provider.id;
            return (
              <div key={provider.id} className={cn(PANEL_ROW, opened && "bg-popover-hover")}>
                <button type="button" aria-haspopup="menu" aria-expanded={opened} data-model-panel-row={`provider:${provider.id}`} data-model-cascade-provider={provider.id}
                  tabIndex={on || (!cascadeCurrent && !cascadeLead.length && !cascadeFavorites.length && provider === cascade[0]) ? 0 : -1}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerEnter={(event) => restOn(event, openProvider(provider), true)}
                  onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); go(openProvider(provider)); } }}
                  onClick={() => go(openProvider(provider))}
                  className={PANEL_ROW_BUTTON}>
                  <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">{mark(provider.id === "local" ? "computer" : provider.id)}</span>
                  <span className="min-w-0 flex-1 truncate">{provider.label}</span>
                  <span aria-hidden="true" className={ROW_SIDE_SLOT}>{on && <Check size={14} className="text-popover-accent" />}</span>
                  <span aria-hidden="true" className={ROW_ICON_SLOT}><ChevronRight size={14} className="text-popover-ink-secondary" /></span>
                </button>
              </div>
            );
          })}
          {cascade.length === 0 && <p data-model-cascade-empty="" className="px-3 py-4 text-center text-[12.5px] text-popover-ink-secondary">{t("model.cascade.none")}</p>}
        </>
      );
    }
    if (level.panel === "accounts") {
      return atProvider?.accounts.map((account) => {
        const on = cascadeCurrent?.provider.id === atProvider.id && cascadeCurrent.account.id === account.id;
        const open = (): MenuPanel => ({ panel: "models", provider: atProvider.id, account: account.id });
        const opened = atAccount?.id === account.id;
        return (
          <div key={account.id} className={cn(PANEL_ROW, opened && "bg-popover-hover")}>
            <button type="button" aria-haspopup="menu" aria-expanded={opened} data-model-panel-row={`account:${account.id}`} data-model-cascade-account={account.id}
              tabIndex={on || (cascadeCurrent?.provider.id !== atProvider.id && account === atProvider.accounts[0]) ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()}
              onPointerEnter={(event) => restOn(event, open(), true)}
              onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); go(open()); } }}
              onClick={() => go(open())}
              className={PANEL_ROW_BUTTON}>
              <span className="min-w-0 flex-1 truncate">{account.label}</span>
              <span aria-hidden="true" className={ROW_SIDE_SLOT}>{on && <Check size={14} className="text-popover-accent" />}</span>
              <span aria-hidden="true" className={ROW_ICON_SLOT}><ChevronRight size={14} className="text-popover-ink-secondary" /></span>
            </button>
          </div>
        );
      });
    }
    return (
      <>
        {listedRows.map((row) => modelRow(row, `${atProvider?.id}:${atAccount?.id}`, level))}
        {shownRows.length === 0 && <p className="px-3 py-4 text-center text-[12.5px] text-popover-ink-secondary">{t("model.noMatch")}</p>}
      </>
    );
  };

  return (
    <div data-model-panel className="flex min-h-0 flex-col text-popover-ink">
      {all && (
        <div className="mx-1.5 mb-1 mt-0.5 flex shrink-0 flex-wrap gap-0.5 rounded-lg bg-popover-hover/60 p-0.5">
          <div role="radiogroup" aria-label={t("model.providers")} data-model-panel-segments
            onKeyDown={(event) => arrowRadios(event, "[data-model-panel-segment]", "horizontal")}
            className="flex min-w-0 flex-1 flex-wrap gap-0.5">
            {segments.map((segment) => {
              const on = segment.key === view;
              return (
                <button key={segment.key} type="button" role="radio" aria-checked={on} aria-label={segment.label} title={segment.label}
                  data-model-panel-segment={segment.key} data-model-provider={segment.key} data-model-segment-current={segment.current ? "" : undefined}
                  tabIndex={on ? 0 : -1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => switchView(segment.key)}
                  className={cn(SEGMENT_BASE, on ? SEGMENT_ON : SEGMENT_OFF, "shrink-0")}>
                  <span className="flex size-4 shrink-0 items-center justify-center">{segment.icon}</span>
                  {on && <span className="truncate">{segment.label}</span>}
                  {segment.current && !on && <span aria-hidden="true" className="size-1 rounded-full bg-popover-accent" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {modes ? null : all ? (
        <button type="button" data-model-panel-back id={modelsId} title={t("model.favorites")} onMouseDown={(event) => event.preventDefault()} onClick={() => showAll(false)}
          className={cn(HEADING, "flex w-full items-center gap-1 text-left outline-none hover:text-popover-ink focus-visible:ring-2 focus-visible:ring-focus")}>
          <ChevronLeft size={13} aria-hidden="true" />
          <span>{t("model.auto.rail")}</span>
        </button>
      ) : (
        <div className={HEADING} id={modelsId}>{t("model.settings.model")}</div>
      )}
      {!modes && searchField}
      <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-1.5 pb-1", modes ? "max-h-[min(400px,52dvh)] pt-0.5" : "max-h-[min(264px,36dvh)]")} data-model-panel-scroll>
      <div ref={listRef} role="radiogroup" aria-labelledby={modes ? undefined : modelsId} aria-label={modes ? t("model.mode.menu") : undefined} data-model-panel-list data-mode-panel={modes ? "root" : undefined}
        onKeyDown={(event) => {
          // Escape on the mode menu closes the deepest level open beside it (a rest of the pointer opened it) before the menu
          if (modes && at.panel !== "root" && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeLevel();
            return;
          }
          if (!modes && event.key === "ArrowUp" && searchable && document.activeElement === listRef.current?.querySelector("[data-model-panel-row]")) {
            event.preventDefault();
            event.stopPropagation();
            listRef.current?.closest("[data-model-panel]")?.querySelector<HTMLElement>("[data-model-panel-search]")?.focus();
            return;
          }
          arrowRadios(event, "[data-model-panel-row]", "vertical");
        }}
        className="shrink-0">
        {modes ? (
          <ModeMenu current={modes.current} resolutions={modes.resolutions} onPick={modes.onPick} disabled={disabled}
            onModeRest={(event) => restOn(event, { panel: "root" }, false)}
            reasoning={showSettings ? { row: reasoningState, label: reasoningLabel, open: at.panel === "reasoning", onOpen: () => go({ panel: "reasoning" }), onRest: reasoningState.disabled ? (event) => restOn(event, { panel: "root" }, false) : (event) => restOn(event, { panel: "reasoning" }, true) } : undefined}
            allModels={{ label: modes.pinnedLabel, open: inAll, onOpen: () => go({ panel: "providers" }), onRest: (event) => restOn(event, { panel: "providers" }, true) }} />
        ) : !all ? (
          <>
            {autoRow && modelRow({ ...autoRow, label: t("model.auto.label"), kind: "auto" })}
            {autoOn && optimize && optimizeRow(optimize)}
            {lead.map((row) => modelRow(row))}
            {shortModels.map((row) => modelRow(row))}
            {providers.length > 0 && (
              <button type="button" data-model-panel-all onMouseDown={(event) => event.preventDefault()} onClick={() => showAll(true)}
                className="flex h-9 w-full items-center gap-1 rounded-lg pl-2 text-left text-[13px] outline-none hover:bg-popover-hover focus-visible:ring-2 focus-visible:ring-focus">
                <span className="min-w-0 flex-1 truncate">{t("model.auto.rail")}</span>
                <span aria-hidden="true" className={ROW_SIDE_SLOT} />
                <span aria-hidden="true" className={ROW_ICON_SLOT}><ChevronRight size={14} className="text-popover-ink-secondary" /></span>
              </button>
            )}
          </>
        ) : (
          <>
            {lead.map((row) => modelRow(row))}
            {listedRows.map((row) => modelRow(row))}
            {shownRows.length === 0 && !(typed && custom) && <p className="px-3 py-4 text-center text-[12.5px] text-popover-ink-secondary">{t("model.noMatch")}</p>}
            {typed && custom && (
              <button type="button" data-model-panel-custom onMouseDown={(event) => event.preventDefault()} onClick={() => custom.onPick(typed)}
                className="flex min-h-9 w-full items-center rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-popover-hover focus-visible:ring-2 focus-visible:ring-focus">
                {custom.label(typed)}
              </button>
            )}
          </>
        )}
      </div>
      {all && fold.rest.length > 0 && (
        <button type="button" data-model-panel-fold={expanded ? "less" : "more"} aria-expanded={expanded}
          onMouseDown={(event) => event.preventDefault()} onClick={() => setExpanded((open) => !open)} className={cn(SHOW_MORE_ROW, "text-popover-ink-secondary hover:text-popover-ink")}>
          {expanded ? t("fold.showLess") : foldMoreLabel(fold.rest.length)}
        </button>
      )}
      </div>

      {modes && levels.map((level, index) => (
        <ModeMenuLevel key={`${level.panel}:${"provider" in level ? level.provider : ""}:${"account" in level ? level.account : ""}`} level={level.panel}
          anchor={levelAnchor(level, viaAccount)} label={levelLabel(level)} room={level.panel === "reasoning" ? 0 : CASCADE_ROOM} focus={focusLevel && index === levels.length - 1}
          onPointerEnter={settle}
          onKeyDown={(event) => {
            const typing = event.target instanceof HTMLInputElement;
            // Escape or the left arrow closes one level, the deepest; the menu and the levels before it stay
            if ((event.key === "Escape" && !event.defaultPrevented) || (event.key === "ArrowLeft" && !typing)) {
              event.preventDefault();
              event.stopPropagation();
              closeLevel();
              return;
            }
            if (event.key === "ArrowUp" && level.panel === "models" && searchable && document.activeElement === event.currentTarget.querySelector("[data-model-panel-row]")) {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.querySelector<HTMLElement>("[data-model-panel-search]")?.focus();
              return;
            }
            arrowRadios(event, "[data-model-panel-row]", "vertical");
          }}>
          {level.panel === "reasoning" && (
            <div className={cn(HEADING, "flex items-baseline gap-3")}>
              <span className="shrink-0">{t("model.reasoning")}</span>
              {!variantRow && <span className="ml-auto min-w-0 truncate">{t("model.effort.slowerHint")}</span>}
            </div>
          )}
          {level.panel === "models" && searchField}
          <div role="radiogroup" aria-label={levelLabel(level)} data-mode-panel={level.panel}
            className="max-h-[min(400px,52dvh)] min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5">
            {levelRows(level)}
          </div>
        </ModeMenuLevel>
      ))}

      {hasReasoning && (
        // M-20261119-051: every level the model takes stays whole at the menu's
        // width (seven read on two balanced lines), the shared segmented control
        <div data-model-panel-reasoning data-model-settings-effort="" className="shrink-0 border-t border-popover-hairline px-3.5 pb-2 pt-2">
          <div className="flex items-baseline justify-between gap-3 pb-2">
            <span className="shrink-0 text-[12px] leading-4 text-popover-ink-secondary">{t("model.reasoning")}</span>
            {!variantRow && <span className="min-w-0 truncate text-[12px] leading-4 text-popover-ink-secondary">{t("model.effort.slowerHint")}</span>}
          </div>
          {variantRow ?? (effort && (
            <SegmentedChoice<EffortLevel | "default"> data-model-effort-menu="" label={effort.title} disabled={disabled} fill
              value={effortValue ?? "default"}
              // the model's own default level is picked as "no level sent"
              onPick={(key) => effort.onPick(key === "default" || key === effort.modelDefault ? undefined : key)}
              options={effortChoices.map((level) => ({
                value: level ?? "default",
                title: level === undefined ? t("model.effort.defaultTitle") : isUltracodeEffort(level) ? t("model.effort.ultracodeHint") : t("model.effort.levelTitle", { level: effortLabel(level) }),
                data: { "data-model-effort-choice": level ?? "default" },
                label: (
                  <span className={level !== undefined && isUltracodeEffort(level) ? "ultracode-effort-option" : undefined}>
                    {level === undefined ? t("model.defaultTag") : effortLabel(level)}
                  </span>
                ),
              }))} />
          ))}
        </div>
      )}

      {showSettings && (fast || (contextSize && contextSize.length > 0)) && (
        <ModelMenuSettings disabled={disabled} fast={fast} contextSize={autoOn ? undefined : contextSize} />
      )}

      <div data-model-panel-footer className="shrink-0 border-t border-popover-hairline px-1.5 py-1">
        {accountChoices && inUse && (
          <>
            {accountOpen && (
              <div role="radiogroup" aria-label={t("model.account")} data-model-line-choices="account" className="pb-0.5"
                onKeyDown={(event) => arrowRadios(event, "[data-model-account-choice]", "vertical")}>
                {accountChoices.map((choice) => {
                  const on = choice.instanceId === inUse.instanceId;
                  return (
                    <button key={choice.key} type="button" role="radio" aria-checked={on} disabled={disabled || Boolean(choice.unavailable)}
                      data-model-account-choice={choice.instanceId} onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (!on) onPick({ ...choice, current: false, pinAccount: true });
                        setAccountOpen(false);
                      }}
                      className="flex min-h-8 w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-popover-hover focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">
                      <span className="truncate">{choice.account}</span>
                      {on && <Check size={14} aria-hidden="true" className="shrink-0 text-popover-accent" />}
                    </button>
                  );
                })}
              </div>
            )}
            <button type="button" data-model-line="account" aria-expanded={accountOpen} disabled={disabled} onClick={() => setAccountOpen((open) => !open)}
              className="flex min-h-7 w-full min-w-0 items-center gap-1 rounded-md px-2 text-[12px] text-popover-ink-secondary outline-none hover:text-popover-ink focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">
              <span className="shrink-0">{t("model.account")}</span>
              <span data-model-line-value className="truncate text-popover-ink">{inUse.account ?? ""}</span>
              <ChevronRight size={12} aria-hidden="true" className={cn("shrink-0 transition-transform", accountOpen && "rotate-90")} />
            </button>
          </>
        )}
        {runsShown && runsOpen && (
          <div role="radiogroup" aria-label={t("model.runsWith")} data-model-line-choices="runs-with" className="pb-0.5"
            onKeyDown={(event) => arrowRadios(event, "[data-model-line-choice]", "vertical")}>
            {runsShown.map((choice) => (
              <button key={choice.key} type="button" role="radio" aria-checked={choice.current} disabled={disabled}
                data-model-line-choice={choice.key} onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!choice.current) choice.onPick();
                  setRunsOpen(false);
                }}
                className="flex min-h-8 w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-popover-hover focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{runsWithOptionLabel(choice)}</span>
                  {choice.hint && <span className="text-[12px] leading-4 text-popover-ink-secondary">{choice.hint}</span>}
                </span>
                {choice.current && <Check size={14} aria-hidden="true" className="shrink-0 text-popover-accent" />}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2" data-model-settings-runs-with={runsShown ? "" : undefined}>
          {runsShown ? (
            <button type="button" data-model-line="runs-with" aria-expanded={runsOpen} disabled={disabled} onClick={() => setRunsOpen((open) => !open)}
              className="flex min-h-7 min-w-0 items-center gap-1 rounded-md px-2 text-[12px] text-popover-ink-secondary outline-none hover:text-popover-ink focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">
              <span className="shrink-0">{t("model.runsWith")}</span>
              <span data-model-line-value className="truncate text-popover-ink">{runsCurrent?.label ?? ""}</span>
              <ChevronRight size={12} aria-hidden="true" className={cn("shrink-0 transition-transform", runsOpen && "rotate-90")} />
            </button>
          ) : <span />}
          {manage && (
            <span className="flex items-center gap-1">
              {manage.onManage ? (
                <button type="button" data-model-manage onClick={manage.onManage}
                  className="flex min-h-7 items-center gap-1 rounded-md px-2 text-[12px] text-popover-ink-secondary outline-none hover:text-popover-ink focus-visible:ring-2 focus-visible:ring-focus">
                  <span>{t("model.manage")}</span>
                  {/* M-20261123-047: the mode menu no longer counts what is off; Manage models turns a model back on */}
                  {!modes && manage.turnedOff > 0 && <span data-model-manage-off>{t(manage.turnedOff === 1 ? "model.manageOffOne" : "model.manageOff", { count: manage.turnedOff })}</span>}
                </button>
              ) : (
                <>
                  {manage.openActiveModels && (
                    <button type="button" data-model-active-models onClick={manage.openActiveModels}
                      className="min-h-7 rounded-md px-2 text-[12px] text-popover-ink-secondary outline-none hover:text-popover-ink focus-visible:ring-2 focus-visible:ring-focus">
                      {manage.turnedOff > 0 ? t("model.activeModelsLink", { count: manage.turnedOff }) : t("model.activeModels")}
                    </button>
                  )}
                  <button type="button" data-model-edit onClick={manage.openProviders}
                    className="min-h-7 rounded-md px-2 text-[12px] text-popover-ink-secondary outline-none hover:text-popover-ink focus-visible:ring-2 focus-visible:ring-focus">
                    {t("settings.section.providers")}
                  </button>
                </>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
