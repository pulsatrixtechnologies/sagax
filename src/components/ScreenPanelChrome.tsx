// Shared docked-panel chrome for the screen side panel (#4452) and for
// surfaces that reuse it (artifacts in the same column). One row of icon
// actions: Detach (own window), Expand (large takeover), Close. Marks and
// other tools sit in `leading` / `trailing` so callers keep their own buttons
// without copying this strip.
import type { ReactNode } from "react";
import { ExternalLink, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CIRCLE_BUTTON } from "@/lib/circle-button";

const ICON = { size: 15, strokeWidth: 1.75 } as const;
const TOOL = cn(CIRCLE_BUTTON, "size-7");

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
    <div data-screen-panel-chrome="" className={cn("flex shrink-0 items-center gap-0.5", className)}>
      {leading}
      {onDetach && (
        <button
          type="button"
          data-screen-panel-detach=""
          onClick={onDetach}
          aria-label={t("screenPanel.detach")}
          title={t("screenPanel.detach")}
          className={TOOL}
        >
          <ExternalLink {...ICON} aria-hidden="true" />
        </button>
      )}
      {onExpand && (
        <button
          type="button"
          data-screen-panel-expand=""
          onClick={onExpand}
          aria-label={t("screenPanel.expand")}
          title={t("screenPanel.expand")}
          className={TOOL}
        >
          <Maximize2 {...ICON} aria-hidden="true" />
        </button>
      )}
      {trailing}
      <button
        type="button"
        data-screen-panel-close=""
        onClick={onClose}
        aria-label={t("screenPanel.close")}
        title={title ? `${t("screenPanel.close")} · ${title}` : t("screenPanel.close")}
        className={TOOL}
      >
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
