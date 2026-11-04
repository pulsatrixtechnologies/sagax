import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Action } from "@/state/store";

/**
 * What a click on the chat header's bot pill dispatches (the reference design parity,
 * 2026-10-18): it opens the bot panel when none is open and closes it when
 * it is open, whichever tab (Details, Library, Computer) is showing. The
 * Computer tab is the computer slot, so closing clears both, like the
 * panel's own close button.
 */
export function botPillActions(panelOpen: boolean): Action[] {
  return panelOpen
    ? [{ type: "toggleSettings", open: false }, { type: "toggleComputer", open: false }]
    : [{ type: "toggleSettings", open: true }];
}

/**
 * The chat header's bot pill: mascot, name, then a small chevron that says
 * it opens something. A native button, so Enter and Space toggle it and
 * focus stays on it; aria-expanded follows the panel.
 */
export function BotHeaderPill({ name, panelOpen, onToggle, avatar }: {
  name: string;
  panelOpen: boolean;
  onToggle: () => void;
  avatar: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-bot-header-pill=""
      className="flex min-w-0 items-center gap-2 rounded-full border-[0.5px] border-hairline-weak bg-elevated py-[7.5px] pl-[7.5px] pr-[11.5px] transition-colors duration-[120ms] hover:bg-elevated-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      title={panelOpen ? t("chat.closePanel") : t("chat.openPanel")}
      aria-label={panelOpen ? t("chat.closePanelAria", { name }) : t("chat.openPanelAria", { name })}
      aria-expanded={panelOpen}
    >
      {avatar}
      <span className="truncate text-[14px] font-medium leading-5 text-ink">{name}</span>
      <ChevronRight
        data-bot-header-chevron=""
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        className={cn(
          "shrink-0 text-ink-tertiary transition-transform duration-[160ms] ease-out motion-reduce:transition-none",
          panelOpen && "rotate-90",
        )}
      />
    </button>
  );
}
