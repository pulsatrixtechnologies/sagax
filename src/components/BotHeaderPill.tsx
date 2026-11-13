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

/** The one chat pill (JC 2026-11-06, hotfix 0.8.57; #4093): 36px, hairline
 * border, mascot then "Name · Title" on one line, as the reference. The bot chat, a group, a split
 * pane, a coding chat, a bot-to-bot conversation and a routine run all draw
 * it with this class, centered in ChatHeaderBar. */
export const CHAT_PILL_CLASS = "flex h-9 min-w-0 items-center gap-2 rounded-full border-[0.5px] border-hairline-weak bg-elevated pl-2 pr-3.5";
const CHAT_PILL_HOVER = "transition-colors duration-[120ms] hover:bg-elevated-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** The pill in a window's header (CodingChat, ExchangeSheet): the same pill
 * as the bot chat; a button that toggles the bot panel when the window sits
 * over a chat, a label otherwise. */
export function WindowHeaderPill({ children, label }: { children: ReactNode; label: string }) {
  const chat = useChatWindow();
  const className = CHAT_PILL_CLASS;
  if (!chat) return <div data-window-pill="" data-chat-pill="" className={className}>{children}</div>;
  return (
    <button
      type="button"
      data-window-pill=""
      data-chat-pill=""
      onClick={(event) => { event.stopPropagation(); chat.onTogglePanel(); }}
      aria-expanded={chat.panelOpen}
      aria-label={chat.panelOpen ? t("chat.closePanelAria", { name: label }) : t("chat.openPanelAria", { name: label })}
      title={chat.panelOpen ? t("chat.closePanel") : t("chat.openPanel")}
      className={cn(className, CHAT_PILL_HOVER)}
    >
      {children}
    </button>
  );
}

/**
 * The pill's text, as the reference app draws it (#4093, the owner's side
 * by side of 2026-11-12, which replaces the stacked lines of 2026-11-06 for
 * the chat header's pill): "Name · Title" on ONE line, 14px, the name in the
 * ink colour, the dot and the title in secondary grey. The title gives way
 * first: it ends in its own ellipsis, then the name does. The whole name and
 * title show on hover, one per line.
 */
export function PillName({ name, label, weight }: { name: string; label?: string; weight: string }) {
  const tag = label?.trim();
  return (
    <span data-bot-header-text="" title={tag ? `${name}\n${tag}` : name} className="flex min-w-0 items-baseline gap-1 whitespace-nowrap text-left text-[14px] leading-5">
      <span data-bot-header-name="" className={cn("block min-w-0 max-w-full shrink truncate text-ink", weight)}>{name}</span>
      {tag && <span aria-hidden="true" className="shrink-0 text-ink-secondary">·</span>}
      {tag && <span data-bot-header-label="" className="block min-w-0 shrink-[2] truncate font-normal text-ink-secondary">{tag}</span>}
    </span>
  );
}

/**
 * The chat header's bot pill: mascot, the name with the title under it, then a
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
      data-chat-pill=""
      data-bot-header-pill=""
      className={cn(CHAT_PILL_CLASS, CHAT_PILL_HOVER)}
      title={panelOpen ? t("chat.closePanel") : t("chat.openPanel")}
      aria-label={panelOpen ? t("chat.closePanelAria", { name }) : t("chat.openPanelAria", { name })}
      aria-expanded={panelOpen}
    >
      {avatar}
      <PillName name={name} label={label} weight="font-normal" />
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
 * The bot chat's header, like Grok Bot (#2141): the name pill alone, 36px
 * high (mascot about 20px, then "Name · Title" on one line, #4093), which opens and closes
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
        data-chat-pill=""
        data-bot-header-pill=""
        className={cn(CHAT_PILL_CLASS, CHAT_PILL_HOVER)}
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
