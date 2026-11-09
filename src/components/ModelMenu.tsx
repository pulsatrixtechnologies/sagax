// The model list (2026-10-12: "like Cursor's model menu"): a search
// field on top that filters as one types, the rows grouped under headings,
// each row the model's name in primary ink and its effort or variant in
// secondary ink, the current choice checked. The arrow keys move over the
// rows that are left, Enter picks, Escape belongs to the caller. The same
// list sits in the composer's model menu (`popover`) and, always open, in
// the model window (`window`). The rules are src/lib/model-menu.ts.
//
// The composer's menu nests (2026-10-14: "too many models shown"):
// with an empty search its root is Auto, the bot's model, the current one,
// the person's favorites (src/lib/model-favorites.ts) and one row per
// provider whose models open in a submenu, on hover, on click, with the
// right arrow or Enter. The submenu flies out beside the menu, or, when the
// window has no room for it, replaces the menu with a Back row. Typing
// lists every provider's matches flat, as before; clearing the search
// brings the submenus back. Every model row carries a star.
//
// `groupProviders` (Simple since 2026-10-14, the composer's menu in
// every mode since 2026-10-18): one "Provider ›" row under Auto, the
// bot's model and the favorites. It lists the providers in place of the
// root, with a Back row; each provider opens its submenu as above.
//
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { TriangleAlert, Check, ChevronLeft, ChevronRight, Search, Star } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  activeRowKey, filterModelSections, groupedModelMenuEntries, modelMenuRoot, modelMenuRootEntries, pickableRows, previewProviderRows, stepRow,
  ALL_MODELS_KEY, CURRENT_KEY_PREFIX, FAVORITE_KEY_PREFIX,
  type ModelMenuEntry, type ModelMenuProvider, type ModelMenuRow, type ModelMenuSection,
} from "@/lib/model-menu";
import { modelMenuStepView, stepCrumbs, stepPathBack, stepPathInto, type ModelMenuHarness, type ModelStepEntry, type ModelStepPath } from "@/lib/model-menu-steps";

export type { ModelMenuRow, ModelMenuSection };

const STYLE = {
  popover: {
    field: "mx-1.5 mb-1 flex items-center gap-2 border-b border-popover-hairline px-2 py-2",
    input: "w-full bg-transparent text-[13px] text-popover-ink placeholder:text-popover-placeholder focus:outline-none",
    icon: "text-popover-ink-secondary",
    list: "max-h-[min(280px,39dvh)] overflow-y-auto overscroll-contain px-1.5 pb-1",
    heading: "px-2 pb-1 pt-2 text-[11.5px] text-popover-ink-secondary",
    divider: "border-t border-popover-hairline",
    row: "text-popover-ink",
    active: "bg-popover-hover",
    detail: "text-popover-ink-secondary",
    tag: "bg-popover-field text-popover-ink-secondary",
    check: "text-popover-accent",
    empty: "px-3 py-5 text-center text-[12.5px] text-popover-ink-secondary",
  },
  window: {
    field: "sticky top-0 z-10 mb-1 flex items-center gap-2 rounded-lg border border-hairline/50 bg-inset px-3 py-2 focus-within:border-accent/60",
    input: "w-full bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none",
    icon: "text-ink-secondary",
    list: "",
    heading: "px-2.5 pb-1 pt-3 text-[11.5px] text-ink-secondary",
    divider: "",
    row: "text-ink",
    active: "bg-hover",
    detail: "text-ink-secondary",
    tag: "bg-inset text-ink-secondary",
    check: "text-accent",
    empty: "px-3 py-5 text-center text-[12.5px] text-ink-secondary",
  },
} as const;

type Style = (typeof STYLE)[keyof typeof STYLE];

/** The stars: the starred rows' keys and what a click on a star does. */
export interface ModelMenuFavorites {
  keys: readonly string[];
  onToggle: (row: ModelMenuRow) => void;
}

/** The submenu's width, and the gap between it and the menu. */
const SUBMENU_WIDTH = 300;
const SUBMENU_GAP = 4;
/** Hovering a provider opens it, hovering elsewhere closes it, after this. */
const HOVER_MS = 140;

type Placement = { side: "right" | "left"; top: number } | { side: "stacked" };
interface OpenSubmenu {
  key: string;
  placement: Placement;
  /** Opened from the keyboard (or in place): the focus goes into it. */
  focus: boolean;
}

/** Beside the menu when the window has room on a side, else in place. */
function placeSubmenu(anchor: HTMLElement | null, box: HTMLElement | null): Placement {
  if (!anchor || !box || typeof window === "undefined") return { side: "stacked" };
  const menu = box.getBoundingClientRect();
  const row = anchor.getBoundingClientRect();
  const need = SUBMENU_WIDTH + SUBMENU_GAP + 8;
  const top = Math.max(0, row.top - menu.top - 5);
  if (window.innerWidth - menu.right >= need) return { side: "right", top };
  if (menu.left >= need) return { side: "left", top };
  return { side: "stacked" };
}

function canHover(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(hover: hover)").matches : true;
  } catch {
    return true;
  }
}

/** #2963: an engine section (not the top rows, not Favorites). */
export function engineSections(sections: readonly ModelMenuSection[]): ModelMenuSection[] {
  return sections.filter((section) => section.label && section.key !== "top" && section.key !== "favorites" && section.rows.some((row) => row.kind === "model"));
}

/** #2963: the sections one engine chip keeps (the top rows and that engine). */
export function sectionsForEngine(sections: ModelMenuSection[], engine: string | null): ModelMenuSection[] {
  if (!engine || !sections.some((section) => section.key === engine)) return sections;
  return sections.filter((section) => section.key === "top" || section.key === engine);
}

export function ModelSearchList({ sections: allSections, onPick, variant, autoFocus = false, onEscape, disabled = false, label, favorites, submenus = false, groupProviders = false, onPreview, onAutoEdit, after, autoPanel, custom, showAll = false, engineChips, steps, listMinHeight }: {
  sections: ModelMenuSection[];
  onPick: (row: ModelMenuRow) => void;
  onPreview?: (row: ModelMenuRow) => void;
  variant: "popover" | "window";
  /** The composer's menu types straight into the search. */
  autoFocus?: boolean;
  /** Escape with an empty search (a non-empty one is cleared first). */
  onEscape?: () => void;
  disabled?: boolean;
  label?: string;
  /** Stars on the model rows, and the Favorites group of the root. */
  favorites?: ModelMenuFavorites;
  /** A short root with one submenu per provider while the search is empty. */
  submenus?: boolean;
  /** With `submenus`: the providers behind one "Provider ›" row. */
  groupProviders?: boolean;
  /** #2106: Edit on the Auto row opens Optimize for Intelligence / Balance / Cost. */
  onAutoEdit?: () => void;
  /** #2181: Effort, Provider and the other links sit in a fixed footer
   * under the scrolling list in every mode (flat, nested, search). */
  after?: ReactNode;
  /** #2106: drawn right under the Auto row of the flat list (its Optimize
   * choices), so opening Edit shows them where the eye already is. */
  autoPanel?: ReactNode;
  /** A typed value outside the catalog: with a search that matches no model
   * exactly, a "Use <text>" row picks the text itself. */
  custom?: { label: (text: string) => string; onPick: (text: string) => void };
  /** #2963 (JC, 2026-11-08): every model of every engine, no Show more. */
  showAll?: boolean;
  /** #2963: a row of engine chips over the list (All, then each engine with
   * its logo); a chip keeps the top rows and that engine's models. */
  engineChips?: { mark: (sectionKey: string) => ReactNode };
  /** #3116: the menu in three steps while the search is empty: the
   * harnesses (with the top rows), then the chosen harness's providers,
   * then the provider's models. `mark` draws a harness's logo. Typing
   * leaves the steps for the flat list of matches. `initialPath` opens
   * the menu at a step (the gallery and tests; the chat bar opens at the
   * harnesses). */
  steps?: { mark?: (harness: string) => ReactNode; initialPath?: ModelStepPath };
  /** #3116: with `after`, the list never shrinks under this many pixels;
   * the footer scrolls instead. */
  listMinHeight?: number;
}) {
  const style = STYLE[variant];
  const [engine, setEngine] = useState<string | null>(null);
  const [path, setPath] = useState<ModelStepPath>(steps?.initialPath ?? {});
  const chips = engineChips && !steps ? engineSections(allSections) : [];
  const sections = chips.length > 1 ? sectionsForEngine(allSections, engine) : allSections;
  const engineOn = chips.length > 1 && sections !== allSections ? engine : null;
  const [query, setQuery] = useState("");
  const [moved, setMoved] = useState<string | null>(null);
  const [openSub, setOpenSub] = useState<OpenSubmenu | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseId = useId();
  const searching = query.trim().length > 0;
  const stepping = Boolean(steps) && !searching;
  const nested = submenus && !searching && !stepping;
  // menu items (not listbox options): the nested root and the steps
  const menuLike = nested || stepping;
  const shown = filterModelSections(sections, query);
  const favoriteKeys = favorites?.keys ?? [];
  const view = stepping ? modelMenuStepView(allSections, path, favoriteKeys) : null;
  const previewSection = (section: ModelMenuSection): { section: ModelMenuSection; hidden: number } => {
    if (showAll || searching || !section.label) return { section, hidden: 0 };
    const preview = previewProviderRows(section.rows, {
      expanded: Boolean(expandedProviders[section.key]),
      favoriteKeys,
    });
    return { section: { ...section, rows: preview.rows }, hidden: preview.hidden };
  };
  const displaySections = shown.map((section) => previewSection(section).section);
  const root = nested ? modelMenuRoot(shown, favoriteKeys) : null;
  const grouped = Boolean(root) && groupProviders;
  const showingAll = grouped && allOpen;
  const entries: Array<ModelMenuEntry | ModelStepEntry> | null = view
    ? view.entries
    : root ? (groupProviders ? groupedModelMenuEntries(root, allOpen) : modelMenuRootEntries(root)) : null;
  const rows = entries ?? pickableRows(displaySections);
  const listScrollClass = after !== undefined
    ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1"
    : style.list;
  // #3116: the root cause of the squashed list: the search field, the
  // chips, the settings and the Manage row were all `shrink-0`, so the
  // list (`min-h-0 flex-1`) took whatever was left, a few rows in a short
  // window. The list now keeps a floor and the footer scrolls instead.
  const listStyle = after !== undefined && listMinHeight !== undefined ? { minHeight: listMinHeight } : undefined;
  const toggleProviderExpanded = (key: string) => {
    setExpandedProviders((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const active = activeRowKey(rows, moved, searching);
  const typed = query.trim();
  const customOffer = custom && searching && !flatRowsOf(shown).some((row) => row.modelId === typed || row.label.toLowerCase() === typed.toLowerCase())
    ? typed : null;
  const flatIds = shown.flatMap((section) => section.rows);
  const optionId = (key: string) => entries
    ? `${baseId}-r${entries.findIndex((entry) => entry.key === key)}`
    : `${baseId}-${flatIds.findIndex((row) => row.key === key)}`;
  const openProvider = openSub && root ? root.providers.find((provider) => provider.key === openSub.key) : undefined;

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    if (!active) return;
    const element = listRef.current?.querySelector<HTMLElement>(`[data-model-row-key="${CSS.escape(active)}"]`);
    element?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const anchorOf = (key: string) => listRef.current?.querySelector<HTMLElement>(`[data-model-row-key="${CSS.escape(key)}"]`) ?? null;
  // the menu the submenu flies beside: the positioned box around this list
  const menuBox = () => (boxRef.current?.offsetParent as HTMLElement | null) ?? boxRef.current;
  const openSubmenu = (provider: ModelMenuProvider, how: "hover" | "click" | "keyboard") => {
    clearTimer();
    const placement = placeSubmenu(anchorOf(provider.key), menuBox());
    // hovering never swaps the whole menu for a submenu
    if (how === "hover" && placement.side === "stacked") return;
    setMoved(provider.key);
    setOpenSub({ key: provider.key, placement, focus: how === "keyboard" || placement.side === "stacked" });
  };
  const closeSubmenu = (refocus: boolean) => {
    clearTimer();
    if (openSub) setMoved(openSub.key);
    setOpenSub(null);
    if (refocus) requestAnimationFrame(() => inputRef.current?.focus());
  };
  // the pointer moved to another row: the submenu goes, and a focus left
  // inside it comes back to the search
  const leaveSubmenu = () => {
    const inside = document.activeElement?.closest?.("[data-model-submenu]");
    setOpenSub(null);
    if (inside) inputRef.current?.focus();
  };
  const later = (fn: () => void) => {
    clearTimer();
    timer.current = setTimeout(fn, HOVER_MS);
  };
  // "Provider ›": the providers in place of the root, and back
  const openAll = () => {
    clearTimer();
    setOpenSub(null);
    setAllOpen(true);
    setMoved(null);
  };
  const closeAll = () => {
    clearTimer();
    setOpenSub(null);
    setAllOpen(false);
    setMoved(ALL_MODELS_KEY);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  // #3116: into a harness or a provider, and one step back (the active
  // row lands on the entry the person came out of)
  const stepInto = (entry: ModelStepEntry) => {
    clearTimer();
    setPath(stepPathInto(path, entry));
    setMoved(null);
  };
  const stepBackPath = view ? stepPathBack(view, path) : null;
  const stepBack = () => {
    if (!view || !stepBackPath) return;
    clearTimer();
    setPath(stepBackPath);
    setMoved((stepBackPath.harness ? view.provider?.key : view.harness?.key) ?? null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = stepRow(rows, active, event.key);
      setMoved(next);
      const preview = pickableRows(shown).find((row) => row.key === next);
      if (preview) onPreview?.(preview);
      if (openSub) setOpenSub(null);
      return;
    }
    const entry = entries?.find((candidate) => candidate.key === active);
    if (entry && "all" in entry && entry.all && (event.key === "ArrowRight" || event.key === "Enter")) {
      event.preventDefault();
      openAll();
      return;
    }
    if (view && entry && ("harness" in entry && entry.harness || entry.provider) && (event.key === "ArrowRight" || event.key === "Enter")) {
      event.preventDefault();
      stepInto(entry);
      return;
    }
    if (entry?.provider && (event.key === "ArrowRight" || event.key === "Enter")) {
      event.preventDefault();
      openSubmenu(entry.provider, "keyboard");
      return;
    }
    if (event.key === "ArrowLeft" && stepBackPath) {
      event.preventDefault();
      stepBack();
      return;
    }
    if (event.key === "ArrowLeft" && openSub) {
      event.preventDefault();
      closeSubmenu(false);
      return;
    }
    if (event.key === "ArrowLeft" && showingAll && !searching) {
      event.preventDefault();
      closeAll();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = entry ? entry.row : pickableRows(shown).find((candidate) => candidate.key === active);
      if (row && !disabled) onPick(row);
      else if (!row && customOffer && !disabled) custom!.onPick(customOffer);
      return;
    }
    if (event.key === "Escape") {
      if (openSub) {
        event.preventDefault();
        event.stopPropagation();
        closeSubmenu(false);
        return;
      }
      if (query) {
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
        setMoved(null);
        return;
      }
      if (stepBackPath) {
        event.preventDefault();
        event.stopPropagation();
        stepBack();
        return;
      }
      if (showingAll) {
        event.preventDefault();
        event.stopPropagation();
        closeAll();
        return;
      }
      if (onEscape) {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }
    }
  };

  const listboxId = `${baseId}-list`;
  const rowProps = (row: ModelMenuRow, key: string) => ({
    row,
    id: optionId(key),
    domKey: key,
    active: key === active,
    style,
    disabled,
    nested: menuLike,
    favorite: favorites ? { on: favorites.keys.includes(row.key), onToggle: () => favorites.onToggle(row) } : undefined,
    onAutoEdit: row.kind === "auto" ? onAutoEdit : undefined,
    onHover: () => {
      setMoved(key);
      onPreview?.(row);
      if (openSub) later(leaveSubmenu);
    },
    onPick: () => onPick(row),
  });

  return (
    <div ref={boxRef} data-model-search-list={variant} data-model-menu-nested={nested || undefined}
      className={cn("flex flex-col", variant === "popover" ? "min-h-0 min-w-0" : "shrink-0", after !== undefined && "flex-1")}>
      <label className={style.field}>
        <Search size={13} aria-hidden="true" className={cn("shrink-0", style.icon)} />
        <input
          ref={inputRef}
          type="text"
          role={menuLike ? undefined : "combobox"}
          aria-expanded={menuLike ? undefined : "true"}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-label={t("model.search")}
          data-model-search
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={t("model.search")}
          onChange={(event) => {
            setQuery(event.target.value);
            setMoved(null);
            if (openSub) setOpenSub(null);
            if (allOpen) setAllOpen(false);
          }}
          onKeyDown={onKeyDown}
          className={style.input}
        />
      </label>
      {chips.length > 1 && (
        <div role="radiogroup" aria-label={t("model.engines.aria")} data-model-engine-chips
          className="mx-1.5 mb-1 flex shrink-0 gap-1 overflow-x-auto overscroll-contain px-1 pb-1 pt-1.5 [scrollbar-width:none]">
          {[{ key: null as string | null, label: t("model.engines.all") }, ...chips.map((section) => ({ key: section.key as string | null, label: section.label! }))].map((chip) => {
            const on = engineOn === chip.key;
            return (
              <button key={chip.key ?? "all"} type="button" role="radio" aria-checked={on} data-model-engine-chip={chip.key ?? "all"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setEngine(chip.key);
                  setMoved(null);
                  if (openSub) setOpenSub(null);
                }}
                className={cn(
                  "flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus motion-reduce:transition-none",
                  variant === "popover"
                    ? on ? "border-popover-accent/60 bg-popover-hover text-popover-ink" : "border-popover-hairline text-popover-ink-secondary hover:bg-popover-hover hover:text-popover-ink"
                    : on ? "border-accent/60 bg-hover text-ink" : "border-hairline text-ink-secondary hover:bg-hover hover:text-ink",
                )}>
                {chip.key && <span aria-hidden="true" className="flex shrink-0 items-center">{engineChips!.mark(chip.key)}</span>}
                <span className="max-w-[140px] truncate">{chip.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {view ? (
        <div ref={listRef} id={listboxId} role="menu" aria-label={label ?? t("model.models")} data-model-list
          data-model-step={view.level} data-model-list-scroll={after !== undefined ? "" : undefined}
          className={listScrollClass} style={listStyle}>
          {stepBackPath && (
            <button type="button" data-model-step-back onMouseDown={(event) => event.preventDefault()} onClick={stepBack}
              aria-label={t("model.settings.back", { title: stepCrumbs(view).join(" › ") })}
              className="mb-1 flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium text-popover-ink-secondary outline-none hover:bg-popover-hover hover:text-popover-ink focus-visible:ring-2 focus-visible:ring-focus">
              <ChevronLeft size={14} aria-hidden="true" />
              <span>{t("model.back")}</span>
              <span aria-hidden="true" className="truncate font-normal">· {stepCrumbs(view).join(" › ")}</span>
            </button>
          )}
          {(view.level === "harness" || view.skipped) && view.top.length + (view.current ? 1 : 0) > 0 && (
            <div role="group" data-model-section="top" className="py-0.5">
              {view.top.map((row) => (
                <Fragment key={row.key}>
                  <ModelSearchRow {...rowProps(row, row.key)} />
                  {row.kind === "auto" && autoPanel}
                </Fragment>
              ))}
              {view.current && <ModelSearchRow {...rowProps(view.current, `${CURRENT_KEY_PREFIX}${view.current.key}`)} />}
            </div>
          )}
          {(view.level === "harness" || view.skipped) && view.favorites.length > 0 && (
            <div role="group" aria-label={t("model.favorites")} data-model-favorites className={cn("py-0.5", style.divider)}>
              <div aria-hidden="true" className={style.heading}>{t("model.favorites")}</div>
              {view.favorites.map((row) => <ModelSearchRow key={row.key} {...rowProps(row, `${FAVORITE_KEY_PREFIX}${row.key}`)} />)}
            </div>
          )}
          {view.level === "harness" && view.harnesses.length > 0 && (
            <div role="group" aria-label={t("model.step.harness")} data-model-harnesses className={cn("py-0.5", style.divider)}>
              <div aria-hidden="true" className={style.heading}>{t("model.step.harness")}</div>
              {view.harnesses.map((harness) => (
                <HarnessRow key={harness.key} harness={harness} id={optionId(harness.key)} style={style} active={harness.key === active}
                  mark={steps?.mark?.(harness.harness)}
                  onHover={() => setMoved(harness.key)}
                  onOpen={() => stepInto({ key: harness.key, current: harness.current, harness })} />
              ))}
            </div>
          )}
          {view.level === "provider" && (
            <div role="group" aria-label={t("model.step.provider")} data-model-providers className={cn("py-0.5", view.skipped && style.divider)}>
              <div aria-hidden="true" className={style.heading}>{t("model.step.provider")}</div>
              {view.providers.map((provider) => (
                <ProviderRow key={provider.key} provider={provider} id={optionId(provider.key)} style={style}
                  active={provider.key === active} expanded={false}
                  onHover={() => setMoved(provider.key)}
                  onOpen={() => stepInto({ key: provider.key, current: provider.current, provider })} />
              ))}
            </div>
          )}
          {view.level === "model" && view.provider && (
            <div role="group" aria-label={view.provider.section.label} data-model-section={view.provider.section.key}
              className={cn("py-0.5", view.skipped && style.divider)}>
              <div aria-hidden="true" className={cn("flex items-baseline gap-1.5", style.heading)}>
                <span className="truncate">{view.provider.section.label ?? t("model.step.model")}</span>
                {view.provider.section.note && <span data-model-section-note className="truncate opacity-80">· {view.provider.section.note}</span>}
              </div>
              {view.rows.map((row) => <ModelSearchRow key={row.key} {...rowProps(row, row.key)} />)}
            </div>
          )}
          {view.entries.length === 0 && <div data-model-no-match className={style.empty}>{t("model.noMatch")}</div>}
        </div>
      ) : root ? (
        <div ref={listRef} id={listboxId} role="menu" aria-label={label ?? t("model.models")} data-model-list
          data-model-list-scroll={after !== undefined ? "" : undefined}
          className={listScrollClass} style={listStyle}>
          {showingAll && (
            <button type="button" data-model-all-back onMouseDown={(event) => event.preventDefault()} onClick={closeAll}
              aria-label={t("model.settings.back", { title: t("model.providerRow") })}
              className="mb-1 flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium text-popover-ink-secondary outline-none hover:bg-popover-hover hover:text-popover-ink focus-visible:ring-2 focus-visible:ring-focus">
              <ChevronLeft size={14} aria-hidden="true" />
              <span>{t("model.back")}</span>
              <span aria-hidden="true" className="truncate font-normal">· {t("model.providerRow")}</span>
            </button>
          )}
          {!showingAll && root.top.length + (root.current ? 1 : 0) > 0 && (
            <div role="group" data-model-section="top" className="py-0.5">
              {root.top.map((row) => <ModelSearchRow key={row.key} {...rowProps(row, row.key)} />)}
              {root.current && <ModelSearchRow {...rowProps(root.current, `${CURRENT_KEY_PREFIX}${root.current.key}`)} />}
            </div>
          )}
          {!showingAll && root.favorites.length > 0 && (
            <div role="group" aria-label={t("model.favorites")} data-model-favorites className={cn("py-0.5", style.divider)}>
              <div aria-hidden="true" className={style.heading}>{t("model.favorites")}</div>
              {root.favorites.map((row) => <ModelSearchRow key={row.key} {...rowProps(row, `${FAVORITE_KEY_PREFIX}${row.key}`)} />)}
            </div>
          )}
          {grouped && !showingAll && root.providers.length > 0 && (
            <div role="group" data-model-all-group className={cn("py-0.5", style.divider)}>
              <AllModelsRow id={optionId(ALL_MODELS_KEY)} style={style} active={active === ALL_MODELS_KEY}
                current={root.providers.some((provider) => provider.current)}
                onHover={() => {
                  setMoved(ALL_MODELS_KEY);
                  if (openSub) later(leaveSubmenu);
                }}
                onOpen={openAll} />
            </div>
          )}
          {(!grouped || showingAll) && root.providers.length > 0 && (
            <div role="group" aria-label={t("model.providers")} data-model-providers className={cn("py-0.5", !showingAll && style.divider)}>
              {root.providers.map((provider) => (
                <ProviderRow key={provider.key} provider={provider} id={optionId(provider.key)} style={style}
                  active={provider.key === active} expanded={openSub?.key === provider.key}
                  onHover={() => {
                    setMoved(provider.key);
                    if (openSub?.key === provider.key) return clearTimer();
                    if (canHover()) later(() => openSubmenu(provider, "hover"));
                  }}
                  onOpen={() => openSubmenu(provider, "click")} />
              ))}
            </div>
          )}
          {entries!.length === 0 && <div data-model-no-match className={style.empty}>{t("model.noMatch")}</div>}
        </div>
      ) : (
        <div ref={listRef} id={listboxId} role="listbox" aria-label={label ?? t("model.models")} data-model-list
          data-model-list-scroll={after !== undefined ? "" : undefined}
          className={listScrollClass} style={listStyle}>
          {shown.length === 0 && !customOffer && <div data-model-no-match className={style.empty}>{t("model.noMatch")}</div>}
          {customOffer && (
            <div role="group" data-model-custom className="py-0.5">
              <ModelMenuItem variant={variant} data-model-custom-row onClick={() => custom!.onPick(customOffer)}>
                <span className="truncate">{custom!.label(customOffer)}</span>
              </ModelMenuItem>
            </div>
          )}
          {shown.map((section, index) => {
            const preview = previewSection(section);
            return (
              <div key={section.key} role="group" aria-label={section.label} data-model-section={section.key}
                className={cn("py-0.5", index > 0 && style.divider)}>
                {section.label && (
                  <div aria-hidden="true" className={cn("flex items-baseline gap-1.5", style.heading)}>
                    <span className="truncate">{section.label}</span>
                    {section.note && <span data-model-section-note className="truncate opacity-80">· {section.note}</span>}
                  </div>
                )}
                {preview.section.rows.map((row) => (
                  <Fragment key={row.key}>
                    <ModelSearchRow {...rowProps(row, row.key)} />
                    {row.kind === "auto" && autoPanel}
                  </Fragment>
                ))}
                {(preview.hidden > 0 || expandedProviders[section.key]) && section.label && (
                  <ShowMoreRow
                    sectionKey={section.key}
                    expanded={Boolean(expandedProviders[section.key])}
                    hidden={preview.hidden}
                    style={style}
                    onToggle={() => toggleProviderExpanded(section.key)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {after !== undefined && (
        <div role="presentation" data-model-menu-footer className={listMinHeight !== undefined ? "min-h-0 overflow-y-auto overscroll-contain" : "shrink-0"}>{after}</div>
      )}
      {openSub && openProvider && (
        <ModelSubmenu
          key={openProvider.key}
          provider={openProvider}
          placement={openSub.placement}
          focus={openSub.focus}
          style={style}
          disabled={disabled}
          favorites={favorites}
          expanded={Boolean(expandedProviders[openProvider.section.key])}
          onToggleExpanded={() => toggleProviderExpanded(openProvider.section.key)}
          onPick={onPick}
          onStay={clearTimer}
          onClose={() => closeSubmenu(true)}
          onType={(text) => {
            setOpenSub(null);
            setQuery(text);
            setMoved(null);
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function flatRowsOf(sections: readonly ModelMenuSection[]): ModelMenuRow[] {
  return sections.flatMap((section) => section.rows);
}

/** "Provider ›": the providers, listed in place of the root. */
function AllModelsRow({ id, style, active, current, onHover, onOpen }: {
  id: string;
  style: Style;
  active: boolean;
  /** The model in effect is under one of the providers. */
  current: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      id={id}
      role="menuitem"
      aria-haspopup="menu"
      data-model-row-key={ALL_MODELS_KEY}
      data-model-all
      // keep the focus in the search field
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onClick={onOpen}
      className={cn(
        "flex min-h-8 cursor-default items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px]",
        style.row,
        active && style.active,
      )}
    >
      <span className="truncate">{t("model.providerRow")}</span>
      <span className="flex shrink-0 items-center gap-1">
        {current && <span data-model-provider-current aria-hidden="true" className={cn("size-1.5 rounded-full bg-current", style.check)} />}
        <ChevronRight size={14} aria-hidden="true" className={style.detail} />
      </span>
    </div>
  );
}

/** #3116, step 1: a harness: its logo, its name, the current model when
 * it runs there (else how many providers or models), a chevron. */
function HarnessRow({ harness, id, style, active, mark, onHover, onOpen }: {
  harness: ModelMenuHarness;
  id: string;
  style: Style;
  active: boolean;
  mark?: ReactNode;
  onHover: () => void;
  onOpen: () => void;
}) {
  const current = harness.sections.flatMap((section) => section.rows).find((row) => row.current);
  const detail = current
    ? current.label
    : harness.sections.length > 1
      ? t("model.step.providers", { count: harness.sections.length })
      : harness.models === 1 ? t("model.step.oneModel") : t("model.step.models", { count: harness.models });
  return (
    <div
      id={id}
      role="menuitem"
      aria-haspopup="menu"
      data-model-row-key={harness.key}
      data-model-harness={harness.harness}
      // keep the focus in the search field
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onClick={onOpen}
      className={cn(
        "flex min-h-8 cursor-default items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px]",
        style.row,
        active && style.active,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {mark && <span aria-hidden="true" className="flex shrink-0 items-center">{mark}</span>}
        <span className="truncate">{harness.label}</span>
      </span>
      <span className="flex min-w-0 shrink items-center gap-1.5">
        <span data-model-harness-detail className={cn("truncate text-[12px]", style.detail)}>{detail}</span>
        {harness.current && <span data-model-provider-current aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full bg-current", style.check)} />}
        <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0", style.detail)} />
      </span>
    </div>
  );
}

/** A provider in the root: its name, its state, a chevron to its models. */
function ProviderRow({ provider, id, style, active, expanded, onHover, onOpen }: {
  provider: ModelMenuProvider;
  id: string;
  style: Style;
  active: boolean;
  expanded: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  const { section } = provider;
  return (
    <div
      id={id}
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={expanded}
      data-model-row-key={provider.key}
      data-model-provider={section.key}
      // keep the focus in the search field
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onClick={onOpen}
      className={cn(
        "flex min-h-8 cursor-default items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px]",
        style.row,
        (active || expanded) && style.active,
      )}
    >
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate">{section.label}</span>
        {section.note && <span data-model-section-note className={cn("min-w-0 shrink truncate", style.detail)}>{section.note}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {provider.current && <span data-model-provider-current aria-hidden="true" className={cn("size-1.5 rounded-full bg-current", style.check)} />}
        <ChevronRight size={14} aria-hidden="true" className={style.detail} />
      </span>
    </div>
  );
}

/** "Show more" / "Show less" under a provider's truncated model list (#2181). */
function ShowMoreRow({ sectionKey, expanded, hidden, style, onToggle }: {
  sectionKey: string;
  expanded: boolean;
  /** Models still folded away: "Show more (N)". */
  hidden: number;
  style: Style;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-model-show-more={sectionKey}
      aria-expanded={expanded}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      className={cn(
        "flex min-h-8 w-full cursor-default items-center rounded-lg px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-focus",
        style.row,
        style === STYLE.popover ? "hover:bg-popover-hover text-popover-ink-secondary" : "hover:bg-hover text-ink-secondary",
      )}
    >
      {expanded ? t("model.showLess") : hidden > 0 ? t("model.showMoreCount", { count: hidden }) : t("model.showMore")}
    </button>
  );
}

/** A provider's models, beside the menu or in its place. The focus moves
 * through the rows themselves; the right arrow reaches a row's star. */
function ModelSubmenu({ provider, placement, focus, style, disabled, favorites, expanded, onToggleExpanded, onPick, onStay, onClose, onType }: {
  provider: ModelMenuProvider;
  placement: Placement;
  focus: boolean;
  style: Style;
  disabled: boolean;
  favorites?: ModelMenuFavorites;
  expanded: boolean;
  onToggleExpanded: () => void;
  onPick: (row: ModelMenuRow) => void;
  onStay: () => void;
  onClose: () => void;
  onType: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const { section } = provider;
  const preview = previewProviderRows(section.rows, { expanded, favoriteKeys: favorites?.keys });
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>("[data-model-submenu-item]") ?? [])];

  // a flyout that would leave the window moves up until it fits
  useLayoutEffect(() => {
    if (placement.side === "stacked" || !ref.current || typeof window === "undefined") return;
    const box = ref.current.getBoundingClientRect();
    const over = box.bottom - (window.innerHeight - 8);
    if (over > 0) setShift(Math.min(over, Math.max(0, box.top - 8)));
  }, [placement]);
  useEffect(() => {
    if (!focus) return;
    const all = items();
    (all.find((item) => item.getAttribute("aria-checked") === "true" && item.getAttribute("aria-disabled") !== "true")
      ?? all.find((item) => item.getAttribute("aria-disabled") !== "true"))?.focus();
  }, [focus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = items().filter((item) => item.getAttribute("aria-disabled") !== "true");
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLElement>("[data-model-submenu-item]");
    const onStar = target.hasAttribute("data-model-favorite");
    const at = item ? all.indexOf(item) : -1;
    const move = (index: number) => {
      event.preventDefault();
      all[(index + all.length) % all.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at <= 0 ? all.length - 1 : at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(all.length - 1);
    else if (event.key === "ArrowRight" && item && !onStar) {
      const star = item.querySelector<HTMLElement>("[data-model-favorite]");
      if (star) {
        event.preventDefault();
        star.focus();
      }
    } else if (event.key === "ArrowLeft" && onStar && item) {
      event.preventDefault();
      item.focus();
    } else if (event.key === "ArrowLeft" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if ((event.key === "Enter" || event.key === " ") && item && !onStar) {
      event.preventDefault();
      const row = preview.rows.find((candidate) => candidate.key === item.dataset.modelRowKey);
      if (row && !row.unavailable && !disabled) onPick(row);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
      // typing searches, as in the root
      event.preventDefault();
      onType(event.key);
    }
  };

  const stacked = placement.side === "stacked";
  const list = (
    <div role="menu" aria-label={section.label} data-model-submenu-list
      className={cn("overflow-y-auto overscroll-contain px-1.5 pb-1", stacked ? "min-h-0 flex-1 py-1" : "max-h-[min(280px,calc(100dvh-16px))] pt-1")}>
      {section.note && <div data-model-section-note className={style.heading}>{section.note}</div>}
      {preview.rows.map((row) => (
        <ModelSearchRow key={row.key} row={row} domKey={row.key} active={false} style={style} disabled={disabled} nested submenu
          favorite={favorites ? { on: favorites.keys.includes(row.key), onToggle: () => favorites.onToggle(row) } : undefined}
          onHover={() => {}} onPick={() => onPick(row)} />
      ))}
      {(preview.hidden > 0 || expanded) && (
        <ShowMoreRow sectionKey={section.key} expanded={expanded} hidden={preview.hidden} style={style} onToggle={onToggleExpanded} />
      )}
    </div>
  );
  return (
    <div
      ref={ref}
      data-model-submenu={section.key}
      data-model-submenu-placement={placement.side}
      onKeyDown={onKeyDown}
      onMouseEnter={onStay}
      style={stacked ? undefined : {
        top: placement.top - shift,
        width: SUBMENU_WIDTH,
        ...(placement.side === "right" ? { left: `calc(100% + ${SUBMENU_GAP}px)` } : { right: `calc(100% + ${SUBMENU_GAP}px)` }),
      }}
      className={cn(
        "absolute z-30 flex flex-col text-popover-ink popover-surface bg-popover",
        stacked
          ? "inset-0 overflow-hidden rounded-xl py-1"
          : "max-w-[calc(100vw-16px)] rounded-xl border border-popover-hairline shadow-2xl shadow-black/50",
      )}
    >
      {stacked && (
        <button type="button" data-model-submenu-back onClick={onClose} aria-label={t("model.settings.back", { title: section.label ?? "" })}
          className="mx-1.5 mb-1 flex items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium text-popover-ink-secondary outline-none hover:bg-popover-hover hover:text-popover-ink focus-visible:ring-2 focus-visible:ring-focus">
          <ChevronLeft size={14} aria-hidden="true" />
          <span>{t("model.back")}</span>
          <span aria-hidden="true" className="truncate font-normal">· {section.label}</span>
        </button>
      )}
      {stacked ? <div className="flex min-h-0 flex-1 flex-col border-t border-popover-hairline pt-1">{list}</div> : list}
    </div>
  );
}

function ModelSearchRow({ row, id, domKey, active, style, disabled, nested = false, submenu = false, favorite, onAutoEdit, onHover, onPick }: {
  row: ModelMenuRow;
  id?: string;
  /** The key this row is drawn under (a favorite repeats a provider's row). */
  domKey: string;
  active: boolean;
  style: Style;
  disabled: boolean;
  /** In the composer's nested menu: menu items, not listbox options. */
  nested?: boolean;
  /** In a submenu: the row itself takes the focus. */
  submenu?: boolean;
  favorite?: { on: boolean; onToggle: () => void };
  /** #2106: Edit on the Auto row. */
  onAutoEdit?: () => void;
  onHover: () => void;
  onPick: () => void;
}) {
  const blocked = Boolean(row.unavailable) || disabled;
  const starred = Boolean(favorite?.on);
  return (
    <div
      id={id}
      role={nested ? "menuitemradio" : "option"}
      aria-selected={nested ? undefined : active}
      aria-checked={nested ? row.current : undefined}
      aria-current={row.current || undefined}
      aria-disabled={blocked || undefined}
      tabIndex={submenu ? -1 : undefined}
      data-model-row-key={domKey}
      data-model-submenu-item={submenu || undefined}
      data-model-option={row.kind === "model" ? row.modelId : undefined}
      data-model-auto-row={row.kind === "auto" || undefined}
      data-follow-bot-model={row.kind === "follow" || undefined}
      data-model-keep-row={row.kind === "keep" || undefined}
      data-model-unavailable={row.unavailable ? "" : undefined}
      title={row.unavailable ?? (row.warning ? [row.title ?? row.label, row.warning].join(" · ") : row.title)}
      // keep the focus in the search field (a submenu's row takes it)
      onMouseDown={submenu ? undefined : (event) => event.preventDefault()}
      onMouseMove={row.unavailable ? undefined : onHover}
      onClick={blocked ? undefined : onPick}
      className={cn(
        "group flex min-h-8 cursor-default items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13px] outline-none",
        style.row,
        active && !row.unavailable && style.active,
        submenu && !row.unavailable && (variantHover(style)),
        blocked && "opacity-50",
      )}
    >
      <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={row.subtext ? "min-w-0 break-words" : "truncate"}>{row.label}</span>
        {row.detail && <span data-model-row-detail className={cn("min-w-0 shrink truncate", style.detail)}>{row.detail}</span>}
        {row.tags?.map((tag) => <span key={tag} data-model-row-tag className={cn("shrink-0 self-center rounded px-1.5 py-px text-[10.5px]", style.tag)}>{tag}</span>)}
        {row.warning && (
          <span data-model-row-warning className="flex shrink-0 items-center gap-1 self-center text-[11.5px] text-warning">
            <TriangleAlert size={11} aria-hidden="true" />
            {row.warning}
          </span>
        )}
      </span>
      {row.subtext && <span data-model-row-sub className={cn("min-w-0 break-words text-[11.5px]", style.detail)}>{row.subtext}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {onAutoEdit && row.kind === "auto" && (
          <button
            type="button"
            tabIndex={-1}
            data-model-auto-edit=""
            aria-label={t("model.auto.edit")}
            title={t("model.auto.edit")}
            onMouseDown={submenu ? undefined : (event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onAutoEdit();
            }}
            className={cn(
              "rounded px-1.5 py-0.5 text-[11.5px] outline-none hover:bg-popover-hover focus-visible:ring-2 focus-visible:ring-focus",
              style.detail,
            )}
          >
            {t("model.auto.edit")}
          </button>
        )}
        {row.current && <Check size={14} aria-hidden="true" className={style.check} />}
        {favorite && row.kind === "model" && (
          <button
            type="button"
            tabIndex={-1}
            data-model-favorite={starred ? "on" : "off"}
            aria-pressed={starred}
            aria-label={t(starred ? "model.favorite.remove" : "model.favorite.add", { name: row.label })}
            title={t(starred ? "model.favorite.remove" : "model.favorite.add", { name: row.label })}
            onMouseDown={submenu ? undefined : (event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              favorite.onToggle();
            }}
            className={cn(
              "flex size-5 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-focus",
              starred ? style.check : cn(style.detail, "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 touch:opacity-100", active && "opacity-100"),
            )}
          >
            <Star size={13} aria-hidden="true" fill={starred ? "currentColor" : "none"} />
          </button>
        )}
      </span>
    </div>
  );
}

function variantHover(style: Style): string {
  return style === STYLE.popover ? "hover:bg-popover-hover focus:bg-popover-hover" : "hover:bg-hover focus:bg-hover";
}

/** A plain item below the list (Edit…), styled like a row. */
export function ModelMenuItem({ children, onClick, variant, ...data }: { children: ReactNode; onClick: () => void; variant: "popover" | "window" } & Record<`data-${string}`, string | boolean | undefined>) {
  const style = STYLE[variant];
  return (
    <button type="button" onClick={onClick} {...data}
      className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-focus",
        style.row, variant === "popover" ? "hover:bg-popover-hover" : "hover:bg-hover")}>
      {children}
    </button>
  );
}
