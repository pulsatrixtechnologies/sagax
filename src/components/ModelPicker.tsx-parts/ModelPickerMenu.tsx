// Composer model menu (extracted from ModelPicker.tsx, #1383).
import { type RefObject } from "react";
import type { MenuMotion } from "../MenuMotion";
import { ChevronRight } from "lucide-react";
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
  openWindow,
  advanced,
  threadId,
  selection,
  active,
  autoOn,
  setEffort,
  pick,
  effortTitle,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  menuAt: { left?: number; right?: number; bottom: number } | null;
  menuMotion: MenuMotion;
  headless: boolean;
  closeMenu: (refocus?: boolean) => void;
  menuSections: ModelMenuSection[];
  onRow: (row: ModelMenuRow) => void;
  bot: Bot;
  favoriteKeys: readonly string[];
  viewerLocal: boolean;
  openWindow: () => void;
  advanced: boolean;
  threadId?: string;
  selection: ModelSelection;
  active: InstanceInfo | undefined;
  autoOn: boolean;
  setEffort: (effort: EffortLevel | undefined) => void;
  pick: (instance: InstanceInfo, model: string, keepOpen?: boolean) => void;
  effortTitle: string;
}) {
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

  const menuPanel = (
    <div
      ref={menuRef}
      data-model-menu
      role="dialog"
      aria-label={t("model.menu")}
      style={menuAt ? { left: menuAt.left, right: menuAt.right, bottom: menuAt.bottom, width: MENU_WIDTH } : { width: MENU_WIDTH }}
      onKeyDown={(event) => {
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
      }}
      {...menuMotion.exitProps}
      className={cn(
        "z-50 flex max-h-[min(560px,calc(100dvh-96px))] max-w-[calc(100vw-16px)] flex-col rounded-xl border border-popover-hairline popover-surface bg-popover py-1 text-popover-ink shadow-2xl shadow-black/50",
        menuAt ? "fixed" : "absolute bottom-full right-0 mb-1.5",
        menuMotion.className,
      )}
    >
      <ModelSearchList variant="popover" autoFocus sections={menuSections} onPick={onRow} onEscape={() => closeMenu(true)} disabled={Boolean(bot.busy)}
        favorites={{ keys: favoriteKeys, onToggle: (row) => toggleModelFavorite(row.key) }} />
      {!viewerLocal && <ModelNoEngineNotice className="border-t border-popover-hairline px-3 py-2" onConnect={() => closeMenu()} />}
      {advanced && settingsPanel}
      <div className="border-t border-popover-hairline px-1.5 pt-1">
        <ModelMenuItem variant="popover" data-model-edit onClick={openWindow}>
          <span>{t("model.edit")}</span>
          <ChevronRight size={14} aria-hidden="true" className="text-popover-ink-secondary" />
        </ModelMenuItem>
      </div>
    </div>
  );

  return menuPanel;
}
