// The model panel (owner decision, 2026-11-17: the composer's model picker
// becomes the reference's compact panel). One component for every place the
// model menu opens (composer chip, bot Model row, wizard, team settings,
// launch composer): a segmented row of providers, "Model" (that provider's
// models, each with a one-line description), "Reasoning" (the levels the
// model really takes) and a quiet footer (Runs with, Manage models). No
// submenus: a long list scrolls inside, with a search field past a few rows.
// Everything the old menu did stays reachable: Auto (and Optimize for) and
// Favorites are segments, "Use the bot's model" and "Keep" are the first
// rows of the list, Fast and Context size sit under Reasoning.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronRight, Search, Sparkles, Star } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { effortLabel } from "@/lib/effort-label";
import { isUltracodeEffort } from "../../shared/ultracode-effort";
import { AUTO_OPTIMIZE_VALUES, type AutoOptimize } from "../../shared/model-auto-optimize";
import type { EffortLevel } from "../../shared/wire";
import { filterModelSections, type ModelMenuRow, type ModelMenuSection } from "@/lib/model-menu";
import { runsWithOptionLabel, runsWithShown, type RunsWithChoice } from "@/lib/runs-with";
import { ModelMenuSettings, type ContextSizeChoice } from "./ModelMenuSettings";
import { foldItems, foldMoreLabel } from "./ShowMoreFold";
import { SHOW_MORE_ROW } from "@/lib/grouped-card";
import { MODELS_SHOWN } from "./settings/ModelSwitchesSettings";

/** A provider with more models than this gets a search field over its list. */
export const PANEL_SEARCH_FROM = 8;

type ViewKey = string;
const AUTO_VIEW = "view:auto";
const FAVORITES_VIEW = "view:favorites";

export interface ModelPanelProps {
  sections: ModelMenuSection[];
  onPick: (row: ModelMenuRow) => void;
  disabled?: boolean;
  favorites: { keys: readonly string[]; onToggle: (row: ModelMenuRow) => void };
  /** Each provider's mark, by section key. */
  mark: (sectionKey: string) => ReactNode;
  autoOn: boolean;
  /** The Optimize choice (Intelligence, Balance, Cost) while Auto is on. */
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
}

/** The view the panel opens on: Auto when it is on, else the provider that
 * holds the current model, else the first provider. */
export function initialPanelView(sections: readonly ModelMenuSection[], autoOn: boolean): ViewKey {
  if (autoOn) return AUTO_VIEW;
  const providers = panelProviders(sections);
  return (providers.find((section) => section.rows.some((row) => row.current)) ?? providers[0])?.key ?? FAVORITES_VIEW;
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
const HEADING = "shrink-0 px-2 pb-1 pt-2 text-[11.5px] text-popover-ink-secondary";

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
  const { sections, onPick, disabled = false, favorites, mark, autoOn, optimize, effort, variantRow, fast, contextSize, runsWith, manage, custom, showSettings } = props;
  const providers = panelProviders(sections);
  const top = sections.filter((section) => !section.label).flatMap((section) => section.rows);
  const autoRow = top.find((row) => row.kind === "auto");
  const leadRows = top.filter((row) => row.kind === "follow" || row.kind === "keep");
  const favoriteRows = sections.find((section) => section.key === "favorites")?.rows ?? [];
  const [chosen, setView] = useState<ViewKey>(() => initialPanelView(sections, autoOn));
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  // no useId or useRef: the interaction harness runs this function outside React
  const modelsId = "model-panel-models";
  const [listRef] = useState(() => ({ current: null as HTMLDivElement | null }));
  // a view that vanished (a provider went away) falls back to the first
  const known = chosen === AUTO_VIEW ? Boolean(autoRow) : chosen === FAVORITES_VIEW ? favoriteRows.length > 0 : providers.some((section) => section.key === chosen);
  const view = known ? chosen : initialPanelView(sections, false);

  const segments: Array<{ key: ViewKey; label: string; icon: ReactNode; current: boolean }> = [
    ...(autoRow ? [{ key: AUTO_VIEW, label: t("model.auto.label"), icon: <Sparkles size={14} aria-hidden="true" />, current: autoOn }] : []),
    ...(favoriteRows.length > 0 ? [{ key: FAVORITES_VIEW, label: t("model.favorites"), icon: <Star size={14} aria-hidden="true" />, current: false }] : []),
    ...providers.map((section) => ({
      key: section.key, label: section.label ?? section.key, icon: mark(section.key), current: !autoOn && section.rows.some((row) => row.current),
    })),
  ];

  const section = providers.find((candidate) => candidate.key === view);
  const viewRows: ModelMenuRow[] = view === FAVORITES_VIEW ? favoriteRows : section?.rows ?? [];
  const searchable = view !== AUTO_VIEW && viewRows.length > PANEL_SEARCH_FROM;
  const typed = searchable ? query.trim() : "";
  const shownRows = typed ? filterModelSections([{ key: view, label: "", rows: viewRows }], typed).flatMap((candidate) => candidate.rows) : viewRows;
  const lead = view === AUTO_VIEW || typed ? [] : leadRows;
  // the first rows, then "Show N more"; the model in use is never folded away, a search lists every match
  const fold = typed ? { head: shownRows, rest: [] as ModelMenuRow[] } : foldItems(shownRows, MODELS_SHOWN, (candidate) => candidate.current);
  const listedRows = expanded ? [...fold.head, ...fold.rest] : fold.head;

  // the focus lands on the model in use (or the search field of a long list)
  useEffect(() => {
    const root = listRef.current?.closest<HTMLElement>("[data-model-panel]");
    const target = root?.querySelector<HTMLElement>("[data-model-panel-search]") ?? root?.querySelector<HTMLElement>('[data-model-panel-row][aria-checked="true"]') ?? root?.querySelector<HTMLElement>("[data-model-panel-row]");
    target?.focus({ preventScroll: true });
    // once, when the panel opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [view]);

  const switchView = (key: ViewKey) => {
    setView(key);
    setQuery("");
    setExpanded(false);
  };

  // every row is one line, the same height: the name and its markers at the left,
  // what the app knows (context size, origin, a warning) muted at the right
  const modelRow = (row: ModelMenuRow) => {
    const starred = favorites.keys.includes(row.key);
    const description = rowDescription(row);
    return (
      <div key={`${view}:${row.key}`} className="group flex h-9 items-center gap-0.5 rounded-lg hover:bg-popover-hover focus-within:bg-popover-hover">
        <button type="button" role="radio" aria-checked={row.current} data-model-panel-row={row.key} data-model-option={row.modelId} data-model-row-kind={row.kind} data-follow-bot-model={row.kind === "follow" ? "true" : undefined}
          disabled={disabled || Boolean(row.unavailable)} title={row.unavailable ?? row.title ?? (description ? `${row.label} · ${description}` : undefined)}
          tabIndex={row.current || (!viewRows.some((candidate) => candidate.current) && row === listedRows[0]) ? 0 : -1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(row)}
          className={cn("flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50", row.unavailable && "opacity-60")}>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="truncate text-[13px] text-popover-ink">{row.label}</span>
            {row.tags?.map((tag) => (
              <span key={tag} className="shrink-0 rounded bg-popover-field px-1 text-[11px] leading-4 text-popover-ink-secondary">{tag}</span>
            ))}
          </span>
          {description && <span data-model-panel-description data-model-row-warning={row.warning ? "" : undefined} className="max-w-[45%] shrink-0 truncate text-[12px] text-popover-ink-secondary">{description}</span>}
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            {row.current && <Check size={14} aria-hidden="true" className="text-popover-accent" />}
          </span>
        </button>
        {row.kind === "model" && (
          <button type="button" aria-pressed={starred} data-model-favorite={row.key}
            aria-label={t(starred ? "model.favorite.remove" : "model.favorite.add", { name: row.label })}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => favorites.onToggle(row)}
            className={cn("flex size-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus",
              starred ? "text-popover-accent" : "text-popover-ink-secondary opacity-0 hover:text-popover-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100")}>
            <Star size={13} aria-hidden="true" fill={starred ? "currentColor" : "none"} />
          </button>
        )}
      </div>
    );
  };

  const effortLevels = effort?.levels ?? [];
  // the model's own default level reads as the checked one while none is chosen
  const effortValue = effort ? (effort.value && effortLevels.includes(effort.value) ? effort.value : effort.modelDefault) : undefined;
  const effortChoices: Array<EffortLevel | undefined> = effort && !effort.modelDefault ? [undefined, ...effortLevels] : [...effortLevels];
  const hasReasoning = showSettings && (Boolean(variantRow) || effortLevels.length > 0);
  const runsShown = !autoOn && runsWith && runsWithShown(runsWith) ? runsWith : undefined;
  const runsCurrent = runsShown?.find((choice) => choice.current);

  return (
    <div data-model-panel className="flex min-h-0 flex-col text-popover-ink">
      <div role="radiogroup" aria-label={t("model.providers")} data-model-panel-segments
        onKeyDown={(event) => arrowRadios(event, "[data-model-panel-segment]", "horizontal")}
        className="mx-1.5 mb-1 mt-0.5 flex shrink-0 gap-0.5 overflow-x-auto rounded-lg bg-popover-hover/60 p-0.5">
        {segments.map((segment) => {
          const on = segment.key === view;
          return (
            <button key={segment.key} type="button" role="radio" aria-checked={on} aria-label={segment.label} title={segment.label}
              data-model-panel-segment={segment.key} data-model-provider={segment.key.startsWith("view:") ? undefined : segment.key} data-model-segment-current={segment.current ? "" : undefined}
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

      <div className={HEADING} id={modelsId}>{t("model.settings.model")}</div>
      {searchable && (
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
                listRef.current?.querySelector<HTMLElement>("[data-model-panel-row]:not([disabled])")?.focus();
              } else if (event.key === "Enter" && typed) {
                event.preventDefault();
                const first = shownRows.find((row) => !row.unavailable);
                if (first) onPick(first);
                else if (custom) custom.onPick(typed);
              }
            }}
            className="w-full bg-transparent text-[13px] text-popover-ink placeholder:text-popover-placeholder focus:outline-none" />
        </label>
      )}
      <div className="flex max-h-[min(264px,36dvh)] min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-1.5 pb-1" data-model-panel-scroll>
      <div ref={listRef} role="radiogroup" aria-labelledby={modelsId} data-model-panel-list
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" && searchable && document.activeElement === listRef.current?.querySelector("[data-model-panel-row]")) {
            event.preventDefault();
            event.stopPropagation();
            listRef.current?.closest("[data-model-panel]")?.querySelector<HTMLElement>("[data-model-panel-search]")?.focus();
            return;
          }
          arrowRadios(event, "[data-model-panel-row]", "vertical");
        }}
        className="shrink-0">
        {view === AUTO_VIEW ? (
          <>
            {autoRow && modelRow({ ...autoRow, label: t("model.auto.label"), kind: "auto" })}
            {optimize && (
              <div role="radiogroup" aria-label={t("model.auto.optimizeTitle")} data-model-auto-optimize>
                <div className={HEADING}>{t("model.auto.optimizeTitle")}</div>
                {AUTO_OPTIMIZE_VALUES.map((value) => (
                  <button key={value} type="button" role="radio" aria-checked={autoOn && optimize.value === value} disabled={disabled}
                    data-model-auto-optimize-option={value} onMouseDown={(event) => event.preventDefault()}
                    onClick={() => optimize.onPick(value)}
                    className="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none hover:bg-popover-hover focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">
                    <span>{t(`model.auto.optimize.${value}`)}</span>
                    {autoOn && optimize.value === value && <Check size={14} aria-hidden="true" className="text-popover-accent" />}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {lead.map(modelRow)}
            {listedRows.map(modelRow)}
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
      {view !== AUTO_VIEW && fold.rest.length > 0 && (
        <button type="button" data-model-panel-fold={expanded ? "less" : "more"} aria-expanded={expanded}
          onMouseDown={(event) => event.preventDefault()} onClick={() => setExpanded((open) => !open)} className={cn(SHOW_MORE_ROW, "text-popover-ink-secondary hover:text-popover-ink")}>
          {expanded ? t("fold.showLess") : foldMoreLabel(fold.rest.length)}
        </button>
      )}
      </div>

      {hasReasoning && (
        <div data-model-panel-reasoning data-model-settings-effort="" className="shrink-0 border-t border-popover-hairline px-3.5 pb-2 pt-1.5">
          <div className="flex items-baseline justify-between gap-3 pb-1">
            <span className="text-[11.5px] text-popover-ink-secondary">{t("model.reasoning")}</span>
            {!variantRow && <span className="text-[11.5px] text-popover-ink-secondary">{t("model.effort.slowerHint")}</span>}
          </div>
          {variantRow ?? (effort && (
            <div role="radiogroup" aria-label={effort.title} data-model-effort-menu
              onKeyDown={(event) => arrowRadios(event, "[data-model-effort-choice]", "horizontal")}
              className="flex min-w-0 gap-0.5 rounded-lg bg-popover-hover/60 p-0.5">
              {effortChoices.map((level) => {
                const on = level === undefined ? effortValue === undefined : level === effortValue;
                return (
                  <button key={level ?? "default"} type="button" role="radio" aria-checked={on} disabled={disabled}
                    tabIndex={on ? 0 : -1} data-model-effort-choice={level ?? "default"}
                    title={level === undefined ? t("model.effort.defaultTitle") : isUltracodeEffort(level) ? t("model.effort.ultracodeHint") : t("model.effort.levelTitle", { level: effortLabel(level) })}
                    // the model's own default level is picked as "no level sent"
                    onClick={() => effort.onPick(level === undefined || level === effort.modelDefault ? undefined : level)}
                    className={cn("min-h-7 flex-1 whitespace-nowrap rounded-md px-2 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 motion-reduce:transition-none",
                      on ? "bg-popover font-medium text-popover-ink shadow-[0_1px_2px_rgb(0_0_0/0.18)]" : "text-popover-ink-secondary hover:text-popover-ink")}>
                    <span className={cn(level !== undefined && isUltracodeEffort(level) && "ultracode-effort-option")}>
                      {level === undefined ? t("model.defaultTag") : effortLabel(level)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {showSettings && (fast || (contextSize && contextSize.length > 0)) && (
        <ModelMenuSettings disabled={disabled} fast={fast} contextSize={autoOn ? undefined : contextSize} />
      )}

      <div data-model-panel-footer className="shrink-0 border-t border-popover-hairline px-1.5 py-1">
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
                  {manage.turnedOff > 0 && <span data-model-manage-off>{t(manage.turnedOff === 1 ? "model.manageOffOne" : "model.manageOff", { count: manage.turnedOff })}</span>}
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
