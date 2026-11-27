// Shared docked-panel chrome for the screen side panel (#4452) and for
// surfaces that reuse it (artifacts in the same column). One row of icon
// actions: Detach (own window), Expand (large takeover), Close. Marks and
// other tools sit in `leading` / `trailing` so callers keep their own buttons
// without copying this strip.
//
// Sizes are the app's own (M-20261127-179): the chat header's round control
// (CIRCLE_BUTTON, 36px) and glyph (CIRCLE_ICON, 18px), 8px apart as there,
// on a top row of the frame's shared header height (--app-topbar-height),
// so the panel's circles sit on the chat header's centre line.
import type { ReactNode } from "react";
import { ExternalLink, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CIRCLE_BUTTON, CIRCLE_ICON } from "@/lib/circle-button";

/** The panel's top row: the chat header's height, 12px gutters, a hairline under it. */
export const SCREEN_PANEL_TOP_ROW = "flex min-h-(--app-topbar-height) shrink-0 items-center gap-2 border-b border-hairline/40 px-3";
/** A docked panel's title (the side thread, the split pane, the artifact panel). */
export const SCREEN_PANEL_TITLE = "min-w-0 flex-1 truncate text-[13.5px] font-medium leading-5 text-ink";
/** A round control of the panel: the chat header's, dimmed while it cannot act. */
export const SCREEN_PANEL_TOOL = cn(CIRCLE_BUTTON, "disabled:cursor-not-allowed disabled:opacity-40");

// A panel row is a size container (`@container/screenbar`): when the panel is
// narrow its labels fold, never its sizes, the way the chat header folds its
// chips (src/lib/compact-chip.ts). Plain literals so Tailwind's scanner sees them.
export const SCREEN_PANEL_BAR = "@container/screenbar";
/** A labelled chip (the holder, Take control) folds to its 36px circle. */
export const FOLD_CHIP = "@max-[44rem]/screenbar:w-9 @max-[44rem]/screenbar:justify-center @max-[44rem]/screenbar:gap-0 @max-[44rem]/screenbar:px-0";
/** ...and its label goes (it stays in the tooltip and the accessible name). */
export const FOLD_CHIP_LABEL = "@max-[44rem]/screenbar:hidden";
/** A place tab keeps its icon and drops its label (still read out) first:
 * two places fit their labels from a 48rem row, three never beside the holder. */
export const foldTabLabel = (places: number) => places > 2 ? "@max-[60rem]/screenbar:sr-only" : "@max-[48rem]/screenbar:sr-only";
/** What only informs (the holder chip) goes where the chips fold: Take
 * control and Give back still say who drives, and a lone icon beside them
 * would only repeat them. */
export const FOLD_AWAY = "@max-[44rem]/screenbar:hidden";

export type ScreenPanelChromeProps = {
  /** Shown as the close / expand tooltip stem (bot or artifact name). */
  title: string;
  onClose: () => void;
  onDetach?: () => void;
  onExpand?: () => void;
  /** Extra tools before Detach (Mark up, place switcher, …). */
  leading?: ReactNode;
  /** Extra tools after Expand, before Close. */
  trailing?: ReactNode;
  className?: string;
};

/** Icon actions every docked screen surface shares. */
export function ScreenPanelChrome({
  title,
  onClose,
  onDetach,
  onExpand,
  leading,
  trailing,
  className,
}: ScreenPanelChromeProps) {
  return (
    <div data-screen-panel-chrome="" className={cn("flex shrink-0 items-center gap-2", className)}>
      {leading}
      {onDetach && (
        <button
          type="button"
          data-screen-panel-detach=""
          onClick={onDetach}
          aria-label={t("screenPanel.detach")}
          title={t("screenPanel.detach")}
          className={SCREEN_PANEL_TOOL}
        >
          <ExternalLink {...CIRCLE_ICON} aria-hidden="true" />
        </button>
      )}
      {onExpand && (
        <button
          type="button"
          data-screen-panel-expand=""
          onClick={onExpand}
          aria-label={t("screenPanel.expand")}
          title={t("screenPanel.expand")}
          className={SCREEN_PANEL_TOOL}
        >
          <Maximize2 {...CIRCLE_ICON} aria-hidden="true" />
        </button>
      )}
      {trailing}
      <button
        type="button"
        data-screen-panel-close=""
        onClick={onClose}
        aria-label={t("screenPanel.close")}
        title={title ? `${t("screenPanel.close")} · ${title}` : t("screenPanel.close")}
        className={SCREEN_PANEL_TOOL}
      >
        <X {...CIRCLE_ICON} aria-hidden="true" />
      </button>
    </div>
  );
}
