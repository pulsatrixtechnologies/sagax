import { createContext, useContext, type ReactNode } from "react";
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
  // #2149 (JC 2026-11-06): a click closes the panel, the next one reopens
  // exactly the panel it closed (same tab, same section, same scroll).
  return panelOpen
    ? [{ type: "rememberBotPanel" }, { type: "toggleSettings", open: false }, { type: "toggleComputer", open: false }]
    : [{ type: "restoreBotPanel" }];
}

/** #2149: what a window over the chat (coding, a bot-to-bot or routine
 * conversation) needs from the chat under it: its header pill toggles the
 * bot panel like the chat's own pill, and the chat's composer stays below.
 * Null outside a chat (tests, galleries): the pill is a plain label. */
export interface ChatWindowContextValue {
  panelOpen: boolean;
  onTogglePanel: () => void;
  /** Height of the chat's composer dock: a window ends above it. */
  composerInset: number;
  /** The newest message the person sent in the chat; a window that is not
   * a chat of its own closes when it changes. */
  sentKey?: string;
}

const ChatWindowContext = createContext<ChatWindowContextValue | null>(null);
export const ChatWindowProvider = ChatWindowContext.Provider;
export function useChatWindow(): ChatWindowContextValue | null {
  return useContext(ChatWindowContext);
}

/** The pill in a window's header (CodingChat, ExchangeSheet): a button that
 * toggles the bot panel when the window sits over a chat, a label otherwise. */
export function WindowHeaderPill({ children, label }: { children: ReactNode; label: string }) {
  const chat = useChatWindow();
  const className = "flex items-center gap-1.5 rounded-full bg-elevated px-3 py-1.5";
  if (!chat) return <div data-window-pill="" className={className}>{children}</div>;
  return (
    <button
      type="button"
      data-window-pill=""
      onClick={(event) => { event.stopPropagation(); chat.onTogglePanel(); }}
      aria-expanded={chat.panelOpen}
      aria-label={chat.panelOpen ? t("chat.closePanelAria", { name: label }) : t("chat.openPanelAria", { name: label })}
      title={chat.panelOpen ? t("chat.closePanel") : t("chat.openPanel")}
      className={cn(className, "transition-colors duration-[120ms] hover:bg-elevated-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60")}
    >
      {children}
    </button>
  );
}

/**
 * The pill's text, like Grok Bot ("Cryptic · Chief of Staff"): the name in
 * the ink color and " · Title" in secondary grey on the SAME line, one
 * ellipsis for the whole line when it is too long (JC 2026-11-06: one line,
 * never the title stacked under the name).
 */
function PillName({ name, label, weight }: { name: string; label?: string; weight: string }) {
  const tag = label?.trim();
  return (
    <span data-bot-header-text="" className={cn("min-w-0 truncate whitespace-nowrap text-[15px]", weight, "leading-5")}>
      <span data-bot-header-name="" className="text-ink">{name}</span>
      {tag && <span data-bot-header-label="" className="text-ink-secondary"> · {tag}</span>}
    </span>
  );
}

/**
 * The chat header's bot pill: mascot, "Name · Title" on one line, then a
 * small chevron that says it opens something. A native button, so Enter and
 * Space toggle it and focus stays on it; aria-expanded follows the panel.
 */
export function BotHeaderPill({ name, label, panelOpen, onToggle, avatar }: {
  name: string;
  label?: string;
  panelOpen: boolean;
  onToggle: () => void;
  avatar: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-bot-header-pill=""
      className="flex h-10 min-w-0 items-center gap-2 rounded-full border-[0.5px] border-hairline-weak bg-elevated pl-2 pr-3.5 transition-colors duration-[120ms] hover:bg-elevated-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      title={panelOpen ? t("chat.closePanel") : t("chat.openPanel")}
      aria-label={panelOpen ? t("chat.closePanelAria", { name }) : t("chat.openPanelAria", { name })}
      aria-expanded={panelOpen}
    >
      {avatar}
      <PillName name={name} label={label} weight="font-medium" />
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
 * The bot chat's header, like Grok Bot (#2141): the name pill alone, 40px
 * high (#2298: mascot about 22px, then "Name · Title" on one line, the name
 * in 15px regular and " · Title" in secondary grey), which opens and closes
 * the bot panel. No sharing pill and no gear above the chat (JC 2026-11-06):
 * sharing lives in the bot panel, the pill already toggles it.
 */
export function BotChatHeader({ name, label, panelOpen, onToggle, avatar }: {
  name: string;
  label?: string;
  panelOpen: boolean;
  onToggle: () => void;
  avatar: ReactNode;
}) {
  return (
    <div data-bot-chat-header="" className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        data-bot-header-pill=""
        className="flex h-10 min-w-0 items-center gap-2 rounded-full border-[0.5px] border-hairline-weak bg-elevated pl-2 pr-3.5 transition-colors duration-[120ms] hover:bg-elevated-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        title={panelOpen ? t("chat.closePanel") : t("chat.openPanel")}
        aria-label={panelOpen ? t("chat.closePanelAria", { name }) : t("chat.openPanelAria", { name })}
        aria-expanded={panelOpen}
      >
        <span className="flex shrink-0 items-center">{avatar}</span>
        <PillName name={name} label={label} weight="font-normal" />
      </button>
    </div>
  );
}
