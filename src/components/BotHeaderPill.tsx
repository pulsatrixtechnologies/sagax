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

/** The one chat pill (JC 2026-11-06, hotfix 0.8.57; #4093, #4163): measured
 * on the reference in the owner's configuration, 40px tall (a 24px mascot
 * centred, 7.5px above and below it, and a 0.5px ring; the height is fixed
 * rather than padded so the bot-to-bot sheet's stacked title still fits),
 * 7.5px before the mascot, 8px to
 * the text, 13.5px after it, the round controls' fill and ring, no shadow
 * (the reference's resting chip draws none); its width follows the text up
 * to the reference's 420px, the title and then the name cut inside it. The bot chat, a group, a split pane, a coding chat, a
 * bot-to-bot conversation and a routine run all draw it with this class,
 * centered in ChatHeaderBar. */
export const CHAT_PILL_CLASS = "group/pill flex h-10 min-w-0 items-center gap-2 rounded-full border-[0.5px] border-circle-ring bg-circle max-w-[420px] pl-[7.5px] pr-[13.5px]";
/** A group's pill starts 9.5px before its stacked faces (the reference's). */
export const CHAT_PILL_GROUP_CLASS = "pl-[9.5px]";
/** The mascot's box in the pill, the reference's 24px. */
export const CHAT_PILL_AVATAR_PX = 24;
/** The pill's type, one size, weight and ink for every word in it (the
 * owner, 2026-11-13: the role after the dot as the name): 14/20 medium in
 * the primary ink, as the reference. */
export const CHAT_PILL_TEXT_CLASS = "text-[14px] font-medium leading-5 text-ink";
/** The pill as a button: the round controls' hover wash and the focus ring. */
export const CHAT_PILL_HOVER = "transition-colors duration-[120ms] ease-out hover:bg-circle-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** The pill in a window's header (CodingChat, ExchangeSheet): the same pill
 * as the bot chat; a button that toggles the bot panel when the window sits
 * over a chat, a label otherwise. */
export function WindowHeaderPill({ children, label }: { children: ReactNode; label: string }) {
  const chat = useChatWindow();
  const className = cn(CHAT_PILL_CLASS, CHAT_PILL_TEXT_CLASS);
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
 * by side of 2026-11-12; #4163, 2026-11-13): "Name · Title" on ONE line,
 * 14/20 medium, the name, the dot and the title in the same primary ink.
 * The title gives way first: it ends in its own ellipsis, then the name
 * does. The whole name and title show on hover, one per line.
 */
export function PillName({ name, label }: { name: string; label?: string }) {
  const tag = label?.trim();
  return (
    <span data-bot-header-text="" title={tag ? `${name}\n${tag}` : name} className={cn("flex min-w-0 items-baseline gap-1 whitespace-nowrap text-left", CHAT_PILL_TEXT_CLASS)}>
      <span data-bot-header-name="" className="block min-w-0 max-w-full shrink truncate">{name}</span>
      {tag && <span aria-hidden="true" className="shrink-0">·</span>}
      {tag && <span data-bot-header-label="" className="block min-w-0 shrink-[2] truncate">{tag}</span>}
    </span>
  );
}

/**
 * The chat header's bot pill: mascot, "Name · Title", then a small chevron
 * that says it opens something. As the reference, the chevron (12px,
 * tertiary) unfolds on hover or keyboard focus and stays folded at rest and
 * while the panel is open, so the pill at rest is as wide as its text. A
 * native button, so Enter and Space toggle it and focus stays on it;
 * aria-expanded follows the panel.
 */
export function BotHeaderPill({ name, label, panelOpen, onToggle, avatar, group }: {
  name: string;
  label?: string;
  panelOpen: boolean;
  onToggle: () => void;
  avatar: ReactNode;
  /** A group's stacked faces: the reference's 9.5px start. */
  group?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-chat-pill=""
      data-bot-header-pill=""
      className={cn(CHAT_PILL_CLASS, CHAT_PILL_HOVER, group && CHAT_PILL_GROUP_CLASS)}
      title={panelOpen ? t("chat.closePanel") : t("chat.openPanel")}
      aria-label={panelOpen ? t("chat.closePanelAria", { name }) : t("chat.openPanelAria", { name })}
      aria-expanded={panelOpen}
    >
      <span className="flex shrink-0 items-center">{avatar}</span>
      <PillName name={name} label={label} />
      <ChevronRight
        data-bot-header-chevron=""
        size={12}
        strokeWidth={2}
        aria-hidden="true"
        className={cn(
          "-ml-2 w-0 shrink-0 text-ink-tertiary opacity-0 transition-[width,margin,opacity] duration-[160ms] ease-out motion-reduce:transition-none",
          !panelOpen && "touch:ml-0 touch:w-3 touch:opacity-100 group-hover/pill:ml-0 group-hover/pill:w-3 group-hover/pill:opacity-100 group-focus-visible/pill:ml-0 group-focus-visible/pill:w-3 group-focus-visible/pill:opacity-100",
        )}
      />
    </button>
  );
}

/**
 * The bot chat's header, like Grok Bot (#2141): the name pill alone, 40px
 * high (a 24px mascot, then "Name · Title" on one line, #4093, #4163), which opens and closes
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
        <PillName name={name} label={label} />
      </button>
    </div>
  );
}
