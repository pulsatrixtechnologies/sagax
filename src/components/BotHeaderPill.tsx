import type { ReactNode } from "react";
import { ChevronRight, Lock, Settings, Users } from "lucide-react";
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

/**
 * The bot chat's header, like Grok Bot (JC 2026-11-06, #2141): one centred
 * row with the name pill (mascot about 20px, then "Name · Label" in 14px
 * regular), a pill that says who sees the bot ("Private", or the existing
 * sharing label), then a round gear that opens and closes the bot panel.
 * The name pill keeps its toggle too, so no action is lost.
 */
export function BotChatHeader({ name, label, audience, shared, panelOpen, onToggle, avatar }: {
  name: string;
  label?: string;
  audience: string;
  shared: boolean;
  panelOpen: boolean;
  onToggle: () => void;
  avatar: ReactNode;
}) {
  const tag = label?.trim();
  const AudienceIcon = shared ? Users : Lock;
  return (
    <div data-bot-chat-header="" className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        data-bot-header-pill=""
        className="flex h-8 min-w-0 items-center gap-2 rounded-full border-[0.5px] border-hairline-weak bg-elevated pl-[6px] pr-3 transition-colors duration-[120ms] hover:bg-elevated-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        title={panelOpen ? t("chat.closePanel") : t("chat.openPanel")}
        aria-label={panelOpen ? t("chat.closePanelAria", { name }) : t("chat.openPanelAria", { name })}
        aria-expanded={panelOpen}
      >
        <span className="flex shrink-0 items-center">{avatar}</span>
        <span className="truncate text-[14px] font-normal leading-5 text-ink">
          {name}
          {tag && <span data-bot-header-label="" className="text-ink-secondary"> · {tag}</span>}
        </span>
      </button>
      <span
        data-bot-header-audience=""
        className="flex h-8 max-w-[12rem] shrink-0 items-center gap-1.5 rounded-full border-[0.5px] border-hairline-weak bg-elevated px-3 text-[13px] leading-5 text-ink-secondary"
        title={audience}
      >
        <AudienceIcon size={13} strokeWidth={2} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{audience}</span>
      </span>
      <button
        type="button"
        onClick={onToggle}
        data-bot-header-gear=""
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border-[0.5px] border-hairline-weak bg-elevated text-ink-secondary transition-colors duration-[120ms] hover:bg-elevated-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          panelOpen && "bg-elevated-hover text-ink",
        )}
        title={panelOpen ? t("chat.closePanel") : t("chat.openPanel")}
        aria-label={panelOpen ? t("chat.closePanel") : t("chat.openPanel")}
        aria-pressed={panelOpen}
      >
        <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
