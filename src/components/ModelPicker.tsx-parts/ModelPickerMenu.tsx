// Composer model menu (extracted from ModelPicker.tsx, #1383).
import { type KeyboardEvent, type RefObject } from "react";
import type { MenuMotion } from "../MenuMotion";
import { Check, ChevronRight } from "lucide-react";
import type { Bot, InstanceInfo, ModelSelection } from "@/state/store";
import { ModelMenuItem, ModelSearchList, type ModelMenuRow, type ModelMenuSection } from "../ModelMenu";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ModelMenuSettings } from "../ModelMenuSettings";
import { ModelNoEngineNotice } from "../ModelNoEngineNotice";
import { EffortRow } from "./EffortControls";
import { toggleModelFavorite } from "@/lib/model-favorites";
import { fastBaseOf, fastTwinOf, modelDefaultEffort, modelEffortLevels } from "../../../shared/model-capabilities";
import type { EffortLevel } from "../../../shared/wire";
import { MENU_WIDTH } from "./helpers";
import { AnchoredPopover, enclosingWindowBounds } from "../AnchoredPopover";
import { AUTO_OPTIMIZE_VALUES, autoOptimizeOf, type AutoOptimize } from "../../../shared/model-auto-optimize";

function menuViewportHeight(fallback = 800): number {
  if (typeof window === "undefined") return fallback;
  return Number(window.innerHeight) || fallback;
}

/** The height a menu anchored by its bottom edge can take: up to 392px (30% under the old 560, #2181), never
 * past the window's top (8px margin). */
export function menuRoomAbove(bottom: number, viewportHeight = menuViewportHeight()): number {
  return Math.max(120, Math.min(392, viewportHeight - bottom - 8));
}

/** The height a menu anchored by its top edge can take: up to 392px, never
 * past the window's bottom (8px margin). */
export function menuRoomBelow(top: number, viewportHeight = menuViewportHeight()): number {
  return Math.max(120, Math.min(392, viewportHeight - top - 8));
}

/** Where the model window (`windowOnly`) pins its menu: top-left inside the
 * viewport. CSS `bottom: innerHeight - 96` put the bottom edge near the top
 * and drew the rest above the window (Refs #1979). */
export function windowOnlyMenuPlace(viewportHeight = menuViewportHeight()): { left: number; top: number } {
  // Keep the top edge inside the window even on a short viewport so the
  // menu can still grow downward (menuRoomBelow floor is 120px).
  const top = Math.min(96, Math.max(8, viewportHeight - 128));
  return { left: 24, top };
}

export function ModelPickerMenu({
  menuRef,
  menuAt,
  menuMotion,
  headless,
  closeMenu,
  menuSections,
  onRow,
  bot,
  favoriteKeys,
  viewerLocal,
  openProviders,
  advanced,
  threadId,
  selection,
  active,
  autoOn,
  setEffort,
  setAutoOptimize,
  autoEditOpen = false,
  setAutoEditOpen,
  pick,
  effortTitle,
  anchorRef,
  turnedOff = 0,
  openActiveModels,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  menuAt: { left?: number; right?: number; top?: number; bottom?: number } | null;
  menuMotion: MenuMotion;
  headless: boolean;
  closeMenu: (refocus?: boolean) => void;
  menuSections: ModelMenuSection[];
  onRow: (row: ModelMenuRow) => void;
  bot: Bot;
  favoriteKeys: readonly string[];
  viewerLocal: boolean;
  /** One place for connections: Settings > Providers (lot 7, no model window). */
  openProviders: () => void;
  advanced: boolean;
  threadId?: string;
  selection: ModelSelection;
  active: InstanceInfo | undefined;
  autoOn: boolean;
  setEffort: (effort: EffortLevel | undefined) => void;
  /** #2106: Auto Edit submenu (Intelligence / Balance / Cost). */
  setAutoOptimize?: (value: AutoOptimize) => void;
  /** #2106: Auto Edit panel open state lives on ModelPicker (no hooks here:
   * the interaction harness calls this menu as a function). */
  autoEditOpen?: boolean;
  setAutoEditOpen?: (open: boolean | ((prev: boolean) => boolean)) => void;
  pick: (instance: InstanceInfo, model: string, keepOpen?: boolean) => void;
  effortTitle: string;
  /** Hang the menu off this chip (Settings > Models list): under it or over
   * it, inside the window that holds it, above that window's layer. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Models this person or the organization turned off; the footer's
   * "n turned off · Active models" row opens Settings > Models > Advanced
   * (kept from the retired two-pane menu, #2050: one menu everywhere). */
  turnedOff?: number;
  openActiveModels?: () => void;
}) {
  const width = MENU_WIDTH;
  const currentOptimize = autoOptimizeOf(selection.autoOptimize);
  // The settings of the model in use, under the composer's list (the maintainer,
  // 2026-10-13, Cursor's second panel): Fast when it has a fast twin and
  // Effort › with only the levels it takes. The maintainer, 2026-10-14: Model › (the
  // provider submenus list the same models) and the Context line are gone.
  // On Auto the model changes per turn: only the effort stays.
  const activeOptions = active?.models.options ?? [];
  const activeOption = activeOptions.find((option) => option.id === selection.model);
  const fastBase = active && !autoOn ? fastBaseOf(activeOptions, selection.model) : undefined;
  const fastTwin = active && !autoOn ? fastTwinOf(activeOptions, selection.model) : undefined;
  const engineEfforts = active?.capabilities?.effortLevels;
  const menuEfforts = active?.capabilities?.modelVariants ? [] : modelEffortLevels(activeOption, engineEfforts);
  const settingsPanel = active ? (
    <ModelMenuSettings
      disabled={Boolean(bot.busy)}
      fast={active && (fastBase || fastTwin) ? { on: Boolean(fastBase), onToggle: () => pick(active, (fastBase ?? fastTwin)!, true) } : undefined}
      variantRow={active.capabilities?.modelVariants ? (
        <div data-model-menu-effort className="px-2 py-1.5">
          <EffortRow bot={bot} threadId={threadId} updateBotDefault={Boolean(threadId)} compact
            label={<span className="shrink-0 text-[12.5px] text-popover-ink-secondary">{effortTitle}</span>} />
        </div>
      ) : undefined}
      effort={menuEfforts.length ? {
        title: effortTitle,
        levels: menuEfforts,
        value: selection.effort && menuEfforts.includes(selection.effort) ? selection.effort : undefined,
        modelDefault: modelDefaultEffort(activeOption, engineEfforts),
        onPick: setEffort,
      } : undefined}
    />
  ) : null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // a submenu of the + menu: its keys stay here (the + menu moves its own focus)
    if (headless) event.stopPropagation();
    // the left arrow from an empty search steps back to the + menu's row
    if (headless && event.key === "ArrowLeft" && !event.defaultPrevented
      && event.target instanceof HTMLInputElement && event.target.value === "") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    closeMenu(true);
  };
  // #2106: Auto's Optimize choices sit right under the Auto row.
  // #2181: the model's settings and the Provider link sit in a fixed footer
  // under the scrolling list.
  const autoPanel = (
    <>
      {autoEditOpen && setAutoOptimize && setAutoEditOpen && (
        <div role="group" aria-label={t("model.auto.optimizeTitle")} data-model-auto-optimize
          className="py-1 pb-0.5">
          <div className="px-2 pb-1 pt-1 text-[11.5px] text-popover-ink-secondary">{t("model.auto.optimizeTitle")}</div>
          {AUTO_OPTIMIZE_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              data-model-auto-optimize-option={value}
              aria-checked={currentOptimize === value}
              role="menuitemradio"
              disabled={Boolean(bot.busy)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setAutoOptimize(value);
                setAutoEditOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-popover-ink outline-none hover:bg-popover-hover focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50",
              )}
            >
              <span>{t(`model.auto.optimize.${value}`)}</span>
              {currentOptimize === value && <Check size={14} aria-hidden="true" className="text-popover-accent" />}
            </button>
          ))}
        </div>
      )}
    </>
  );
  const below = (
    <>
      {!viewerLocal && <ModelNoEngineNotice className="border-t border-popover-hairline px-3 py-2" onConnect={() => closeMenu()} />}
      {advanced && settingsPanel}
      <div className="border-t border-popover-hairline px-1.5 pt-1">
        {openActiveModels && (
          <ModelMenuItem variant="popover" data-model-active-models onClick={openActiveModels}>
            <span>{turnedOff > 0 ? t("model.activeModelsLink", { count: turnedOff }) : t("model.activeModels")}</span>
            <ChevronRight size={14} aria-hidden="true" className="text-popover-ink-secondary" />
          </ModelMenuItem>
        )}
        <ModelMenuItem variant="popover" data-model-edit onClick={openProviders}>
          <span>{t("settings.section.providers")}</span>
          <ChevronRight size={14} aria-hidden="true" className="text-popover-ink-secondary" />
        </ModelMenuItem>
      </div>
    </>
  );
  const content = (
    <>
      <ModelSearchList variant="popover" autoFocus sections={menuSections} onPick={onRow} onEscape={() => closeMenu(true)} disabled={Boolean(bot.busy)}
        favorites={{ keys: favoriteKeys, onToggle: (row) => toggleModelFavorite(row.key) }}
        onAutoEdit={setAutoOptimize && setAutoEditOpen && !viewerLocal ? () => setAutoEditOpen((open) => !open) : undefined}
        after={below}
        autoPanel={autoPanel} />
    </>
  );

  if (anchorRef) return (
    <AnchoredPopover
      anchorRef={anchorRef}
      popoverRef={menuRef as RefObject<HTMLElement | null>}
      align="start"
      gap={6}
      maxHeight={392}
      bounds={enclosingWindowBounds}
      data-model-menu=""
      data-model-menu-anchored=""
      role="dialog"
      aria-label={t("model.menu")}
      style={{ width }}
      onKeyDown={onKeyDown}
      {...menuMotion.exitProps}
      className={cn(
        "flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl border border-popover-hairline popover-surface bg-popover py-1 text-popover-ink shadow-2xl shadow-black/50",
        menuMotion.className,
      )}
    >
      {content}
    </AnchoredPopover>
  );

  const menuMaxHeight = menuAt
    ? menuAt.top != null
      ? menuRoomBelow(menuAt.top)
      : menuAt.bottom != null
        ? menuRoomAbove(menuAt.bottom)
        : 392
    : undefined;
  const menuPanel = (
    <div
      ref={menuRef}
      data-model-menu
      role="dialog"
      aria-label={t("model.menu")}
      // Bottom-anchored menus open upward (2026-11-03); the model window
      // pins by its top so the list stays inside the viewport (Refs #1979).
      style={menuAt ? { left: menuAt.left, right: menuAt.right, top: menuAt.top, bottom: menuAt.bottom, width, maxHeight: menuMaxHeight } : { width }}
      onKeyDown={onKeyDown}
      {...menuMotion.exitProps}
      className={cn(
        "z-50 flex max-h-[min(392px,calc(100dvh-96px))] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl border border-popover-hairline popover-surface bg-popover py-1 text-popover-ink shadow-2xl shadow-black/50",
        menuAt ? "fixed" : "absolute bottom-full right-0 mb-1.5",
        menuMotion.className,
      )}
    >
      {content}
    </div>
  );

  return menuPanel;
}
