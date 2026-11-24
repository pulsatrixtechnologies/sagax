// Composer model menu (extracted from ModelPicker.tsx, #1383).
import { type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { MenuMotion } from "../MenuMotion";
import type { Bot, InstanceInfo, ModelSelection } from "@/state/store";
import type { ModelMenuRow, ModelMenuSection } from "../ModelMenu";
import { ModelPanel, type ModelPanelProps } from "../ModelPanel";
import { cn } from "@/lib/cn";
import { COMPOSER_POPOVER_RISE_CLASS, MENU_BOX } from "../menu-look";
import { t } from "@/lib/i18n";
import type { ContextSizeChoice, RunsWithChoice } from "../ModelMenuSettings";
import { ModelNoEngineNotice } from "../ModelNoEngineNotice";
import { EffortRow } from "./EffortControls";
import { toggleModelFavorite } from "@/lib/model-favorites";
import { fastBaseOf, fastTwinOf, modelDefaultEffort, modelEffortLevels } from "../../../shared/model-capabilities";
import type { EffortLevel } from "../../../shared/wire";
import { MENU_MAX_HEIGHT, MENU_WIDTH } from "./helpers";
import { AnchoredPopover, enclosingWindowBounds } from "../AnchoredPopover";
import { autoOptimizeOf, type AutoOptimize } from "../../../shared/model-auto-optimize";

function menuViewportHeight(fallback = 800): number {
  if (typeof window === "undefined") return fallback;
  return Number(window.innerHeight) || fallback;
}

/** The height a menu anchored by its bottom edge can take: up to MENU_MAX_HEIGHT
 * (#2963: larger and flat, every section open), never past the window's top
 * (8px margin). */
export function menuRoomAbove(bottom: number, viewportHeight = menuViewportHeight()): number {
  return Math.max(120, Math.min(MENU_MAX_HEIGHT, viewportHeight - bottom - 8));
}

/** The height a menu anchored by its top edge can take: up to MENU_MAX_HEIGHT, never
 * past the window's bottom (8px margin). */
export function menuRoomBelow(top: number, viewportHeight = menuViewportHeight()): number {
  return Math.max(120, Math.min(MENU_MAX_HEIGHT, viewportHeight - top - 8));
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
  pick,
  effortTitle,
  anchorRef,
  turnedOff = 0,
  openActiveModels,
  customModel,
  onManage,
  engineMark,
  runsWith,
  contextSize,
  modeMenu,
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
  /** Pick-only surfaces that take a model typed in the search. */
  customModel?: { label: (text: string) => string; onPick: (text: string) => void };
  /** #2963: the one footer link, "Manage models", opening the model window
   * (engines, favorites, on/off switches). Absent on pick-only surfaces. */
  onManage?: () => void;
  /** #2963: the engine chips at the top of the list (engine first, then its
   * models): each engine section's mark. */
  engineMark?: (sectionKey: string) => ReactNode;
  /** #4329 lot 6: "Runs with" for the bot (src/components/RunsWith.tsx),
   * computed by the picker (this menu stays hook-free). */
  runsWith?: readonly RunsWithChoice[];
  /** #4417: "Context size" for the bot (src/components/ContextSize.tsx),
   * computed by the picker. */
  contextSize?: readonly ContextSizeChoice[];
  /** #4900, #5088, M-20261123-045: the chat bar's mode menu (Auto, Fast,
   * Expert, Heavy, Build, Reasoning, All models), the model panel's short view. */
  modeMenu?: ModelPanelProps["modes"];
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
  const variantRow = active?.capabilities?.modelVariants ? (
    <div data-model-menu-effort>
      <EffortRow bot={bot} threadId={threadId} updateBotDefault={Boolean(threadId)} compact
        label={<span className="sr-only">{effortTitle}</span>} />
    </div>
  ) : undefined;

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
  const menuMaxHeight = menuAt
    ? menuAt.top != null
      ? menuRoomBelow(menuAt.top)
      : menuAt.bottom != null
        ? menuRoomAbove(menuAt.bottom)
        : MENU_MAX_HEIGHT
    : undefined;
  const content = (
    <>
      <ModelPanel
        sections={menuSections}
        onPick={onRow}
        disabled={Boolean(bot.busy)}
        favorites={{ keys: favoriteKeys, onToggle: (row) => toggleModelFavorite(row.key) }}
        mark={(key) => engineMark?.(key) ?? null}
        autoOn={autoOn}
        optimize={setAutoOptimize && !viewerLocal ? { value: currentOptimize, onPick: setAutoOptimize } : undefined}
        effort={menuEfforts.length ? {
          title: effortTitle,
          levels: menuEfforts,
          value: selection.effort && menuEfforts.includes(selection.effort) ? selection.effort : undefined,
          modelDefault: modelDefaultEffort(activeOption, engineEfforts),
          onPick: setEffort,
        } : undefined}
        variantRow={variantRow}
        fast={active && (fastBase || fastTwin) ? { on: Boolean(fastBase), onToggle: () => pick(active, (fastBase ?? fastTwin)!, true) } : undefined}
        contextSize={contextSize}
        runsWith={runsWith}
        manage={{ onManage, turnedOff, openActiveModels, openProviders }}
        custom={customModel}
        showSettings={advanced}
        modes={modeMenu}
      />
      {!viewerLocal && <ModelNoEngineNotice className="border-t border-popover-hairline px-3 py-2" onConnect={() => closeMenu()} />}
    </>
  );

  if (anchorRef) return (
    <AnchoredPopover
      anchorRef={anchorRef}
      popoverRef={menuRef as RefObject<HTMLElement | null>}
      align="start"
      gap={6}
      maxHeight={MENU_MAX_HEIGHT}
      bounds={enclosingWindowBounds}
      data-model-menu=""
      data-model-menu-anchored=""
      role="dialog"
      aria-label={t("model.menu")}
      style={{ width }}
      onKeyDown={onKeyDown}
      {...menuMotion.exitProps}
      className={cn(
        "flex max-w-[calc(100vw-16px)] flex-col overflow-hidden py-1 text-popover-ink",
        MENU_BOX,
        menuMotion.className,
      )}
    >
      {content}
    </AnchoredPopover>
  );

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
        "z-50 flex max-h-[min(520px,calc(100dvh-96px))] max-w-[calc(100vw-16px)] flex-col overflow-hidden py-1 text-popover-ink",
        MENU_BOX,
        menuAt ? "fixed" : "absolute bottom-full right-0 " + COMPOSER_POPOVER_RISE_CLASS,
        menuMotion.className,
      )}
    >
      {content}
    </div>
  );

  return menuPanel;
}
