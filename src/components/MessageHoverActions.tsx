// The quiet actions beside a chat message, shared by 1:1 chats (MessageBar)
// and rooms (MessageActions), on a bot's answer and on a person's bubble.
//
// The maintainer, 2026-10-15: the same shapes and measures as the reference design's message tray,
// in Sagax's skin tokens so every skin draws it:
//
// - the row: smiley (react), reply, "…"; 24px square buttons, 6px corners,
//   2px apart, 16px thin icons, a 6% ink wash on hover and 10% when pressed
//   (120ms colour transition);
// - the smiley opens a pill of quick reactions (👍 👎 ❤️ 😂 🎉, then "more
//   reactions"): 32px round cells, 20px emoji, 4px apart, 6px inside;
// - "…" opens a menu (12px corners, 6px inside, 200px wide at least) that
//   starts with the same reactions, then Reply, Copy, Copy request ID, then
//   Sagax's own entries in two sections under half-pixel dividers (the maintainer,
//   2026-10-16): what changes the message (edit, regenerate, pin), then how
//   it is shown (read aloud, raw markdown). Rows are 30px high, 13px/18px text, 6px
//   corners, 8px between the 16px icon and the label.
//
// Keyboard: every popup takes focus on open, the arrows and Home/End move in
// it, Escape closes it and gives focus back to the button that opened it.
//
// Placement (2026-10-18): the pill, the menu and the full picker are
// drawn in a portal on document.body, fixed beside the row, so neither the
// transcript's scroller nor any other container cuts them. They open below
// the row (the picker above), on the other side when there is no room, and
// slide back inside the window at its borders (src/lib/popover-placement.ts).
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Copy, Ellipsis, Reply, Smile, SmilePlus } from "lucide-react";

import { useAnchoredPopover } from "@/hooks/use-anchored-popover";
import { popoverClosesOnKey, usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { BAR_REACTIONS } from "../../shared/reactions";
import { useMenuMotion } from "./MenuMotion";
import { ReactionPicker } from "./Reactions";
import { MENU_FIT_ROW, MENU_ROW, MENU_SURFACE, MenuDivider, MenuGlyph } from "@/components/menu-look";

/** One size and stroke for every icon in the row and its menu. */
export const HOVER_ICON = { size: 16, strokeWidth: 1.5 } as const;

/** A button of the row: 24px, 6px corners, muted until hovered or pressed. */
export const HOVER_ACTION_BUTTON =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-ink-secondary transition-colors duration-[120ms] hover:bg-ink/[0.06] active:bg-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-ink/[0.06] disabled:cursor-not-allowed disabled:opacity-50";

/** Where both popups sit: fixed in a portal, placed by useAnchoredPopover. */
const POPUP_PLACE = "fixed left-0 top-0 z-50";

/** The reaction pill's floating surface: elevated, a half-pixel edge and the
 * skin's popover shadow. The "…" menu takes the menu family's surface
 * (menu-look.tsx) instead. */
const POPUP_SURFACE = cn(POPUP_PLACE, "border-[0.5px] border-border bg-elevated popover-surface");

const EMOJI_CELL =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-full border-0 p-0 text-[20px] leading-none text-ink transition-colors duration-[120ms] hover:bg-ink/[0.06] active:bg-ink/10 focus-visible:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";


const CloseMenu = createContext<() => void>(() => {});

/** One entry of the "…" menu: an icon and a label. Choosing it closes the
 * menu. `hidden` keeps an entry in the tree but out of sight and reach. */
export function MessageMenuItem({
  label,
  icon,
  onSelect,
  disabled = false,
  active = false,
  hidden = false,
  shortcut,
  title,
}: {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** A mode that is on (raw markdown, speaking). */
  active?: boolean;
  hidden?: boolean;
  /** One letter that chooses this entry while the menu is open. */
  shortcut?: string;
  title?: string;
}) {
  const close = useContext(CloseMenu);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      aria-checked={active || undefined}
      aria-keyshortcuts={shortcut ? shortcut.toUpperCase() : undefined}
      data-shortcut={shortcut?.toLowerCase()}
      onClick={() => {
        close();
        onSelect();
      }}
      className={cn(MENU_ROW, active && "text-accent", hidden && "hidden")}
    >
      <MenuGlyph active={active}>{icon}</MenuGlyph>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && <kbd className="shrink-0 font-sans text-[11px] text-ink-tertiary">{shortcut.toUpperCase()}</kbd>}
    </button>
  );
}

/** One section of Sagax's own entries under a divider; the divider goes
 * when every entry of the section is hidden. */
function MenuSection({ extra = false, children }: { extra?: boolean; children: ReactNode }) {
  return (
    <div className="hidden flex-col gap-0.5 has-[>[role=menuitem]:not(.hidden)]:flex" data-menu-extra={extra ? "" : undefined} data-menu-view={extra ? undefined : ""}>
      <MenuDivider />
      {children}
    </div>
  );
}

/** The quick reactions in a row, then "more reactions". Shared by the pill
 * and the head of the "…" menu. */
function QuickReactionRow({ mine, onPick, onMore }: { mine: readonly string[]; onPick: (emoji: string) => void; onMore: () => void }) {
  return (
    <div role="group" aria-label={t("reactions.quick")} className="flex flex-row items-center gap-1" data-quick-reactions>
      {BAR_REACTIONS.map((emoji) => {
        const marked = mine.includes(emoji);
        return (
          <button
            key={emoji}
            type="button"
            role="menuitemcheckbox"
            aria-checked={marked}
            aria-label={t("reactions.reactWith", { emoji })}
            title={emoji}
            data-quick-reaction={emoji}
            onClick={() => onPick(emoji)}
            className={cn(EMOJI_CELL, marked && "bg-ink/[0.08] hover:bg-ink/[0.08]")}
          >
            {emoji}
          </button>
        );
      })}
      <button
        type="button"
        role="menuitem"
        aria-label={t("reactions.more")}
        title={t("reactions.more")}
        data-more-reactions
        onClick={onMore}
        className={cn(EMOJI_CELL, "text-ink-secondary")}
      >
        <SmilePlus size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}

/** The focusable entries of a popup, in order, without hidden or disabled ones. */
function entries(popup: HTMLElement | null): HTMLElement[] {
  if (!popup) return [];
  return [...popup.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')].filter(
    (entry) => !(entry as HTMLButtonElement).disabled && !entry.classList.contains("hidden"),
  );
}

/** Arrows, Home and End move through a popup's entries. */
function moveFocus(event: KeyboardEvent<HTMLElement>, popup: HTMLElement | null) {
  const items = entries(popup);
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const step: Record<string, number | "home" | "end"> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Home: "home", End: "end" };
  const move = step[event.key];
  if (move === undefined) return;
  event.preventDefault();
  const next = move === "home" ? 0 : move === "end" ? items.length - 1 : (index + move + items.length) % items.length;
  items[next]?.focus();
}

/** On document.body, out of every container that could cut it. */
const portal = (node: ReactNode) => (typeof document === "undefined" ? node : createPortal(node, document.body));

type Popup = "reactions" | "picker" | "menu" | null;

export type HoverReactions = {
  /** The emojis this viewer already put on the message. */
  mine: readonly string[];
  onPick: (emoji: string) => void;
};

/** The row of quiet actions and its two popups. `onOpenChange` tells the
 * container a popup is open, so it keeps the row in view. `persistent`
 * holds controls of a mode the person turned on (raw markdown, reading
 * aloud), drawn after "…". `children` are Sagax's own menu entries
 * (MessageMenuItem), under Reply, Copy and Copy request ID; `view` are the
 * entries that change how the message is shown (read aloud, raw markdown),
 * in a last section of their own. */
export function MessageHoverActions({
  side,
  onReply,
  copy,
  requestId,
  react,
  persistent,
  onOpenChange,
  children,
  view,
}: {
  side: "user" | "bot";
  onReply?: () => void;
  /** The message's text, when it has any to copy. */
  copy?: string;
  /** What "Copy request ID" puts on the clipboard. */
  requestId?: string;
  react?: HoverReactions;
  persistent?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
  /** The view entries (MessageMenuItem), after `children`. */
  view?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reactRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const barId = useId();
  const menuId = useId();
  const [popup, setPopupState] = useState<Popup>(null);
  const [announce, setAnnounce] = useState("");
  const mirrored = side === "user";
  const barMotion = useMenuMotion(popup === "reactions");
  const menuMotion = useMenuMotion(popup === "menu");
  // The reference design's placement: under the row, from the bubble's side
  const align = mirrored ? "end" : "start";
  useAnchoredPopover(Boolean(react) && barMotion.shown, rootRef, barRef, { prefer: "below", align });
  useAnchoredPopover(menuMotion.shown, rootRef, menuRef, { prefer: "below", align });
  // The popups live in a portal: a press in one is still a press inside.
  const inside = useRef({
    contains: (target: unknown) =>
      target instanceof Node && [rootRef, barRef, menuRef].some((ref) => Boolean(ref.current?.contains(target))),
  });

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const setPopup = (next: Popup) => {
    setPopupState(next);
    onOpenChangeRef.current?.(next !== null);
  };
  const close = (focus: RefObject<HTMLElement | null>) => {
    setPopup(null);
    focus.current?.focus();
  };

  usePopoverDismiss(popup === "reactions" || popup === "menu", inside, () => setPopup(null));

  useEffect(() => {
    if (popup === "reactions") entries(barRef.current)[0]?.focus();
    if (popup === "menu") entries(menuRef.current)[0]?.focus();
  }, [popup]);

  const pick = (emoji: string, from: RefObject<HTMLElement | null>) => {
    react?.onPick(emoji);
    close(from);
  };

  const onPopupKey = (event: KeyboardEvent<HTMLDivElement>, popupRef: RefObject<HTMLElement | null>, from: RefObject<HTMLElement | null>) => {
    if (popoverClosesOnKey(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
      close(from);
      return;
    }
    if (event.key === "Tab") {
      // the popup sits at the end of the page (a portal): put focus back on
      // its button first, so Tab carries on from the row, not from there
      close(from);
      return;
    }
    // a letter chooses the menu entry that carries it
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const entry = popupRef.current?.querySelector<HTMLElement>(`[role="menuitem"][data-shortcut="${CSS.escape(event.key.toLowerCase())}"]:not(:disabled)`);
      if (entry) {
        event.preventDefault();
        entry.click();
        return;
      }
    }
    moveFocus(event, popupRef.current);
  };

  const copied = (key: "chat.copyMessageDone" | "chat.copyRequestIdDone") => setAnnounce(t(key));
  const replyIcon = <Reply {...HOVER_ICON} aria-hidden="true" className={cn(mirrored && "-scale-x-100")} />;

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label={t("chat.messageActions")}
      data-hover-actions
      data-popup={popup ?? undefined}
      className={cn("relative flex flex-row flex-nowrap items-center gap-0.5 select-none", mirrored && "flex-row-reverse")}
      onKeyDown={(event) => {
        if (!(event.target instanceof Element) || event.target.parentElement !== rootRef.current) return;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)") ?? [])];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          const forward = (event.key === "ArrowRight") !== mirrored;
          buttons[(index + (forward ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
      }}
    >
      {react && (
        <button
          ref={reactRef}
          type="button"
          data-react-button
          aria-label={t("reactions.add")}
          title={t("reactions.add")}
          aria-haspopup="menu"
          aria-expanded={popup === "reactions" || popup === "picker"}
          aria-controls={popup === "reactions" ? barId : undefined}
          onClick={() => setPopup(popup === "reactions" || popup === "picker" ? null : "reactions")}
          className={HOVER_ACTION_BUTTON}
        >
          <Smile {...HOVER_ICON} aria-hidden="true" />
        </button>
      )}
      {onReply && (
        <button type="button" data-reply-button onClick={onReply} aria-label={t("chat.replyToMessage")} title={t("chat.reply")} className={HOVER_ACTION_BUTTON}>
          {replyIcon}
        </button>
      )}
      <button
        ref={moreRef}
        type="button"
        data-more-button
        onClick={() => setPopup(popup === "menu" ? null : "menu")}
        aria-label={t("chat.messageActions")}
        title={t("chat.messageActions")}
        aria-haspopup="menu"
        aria-expanded={popup === "menu"}
        aria-controls={popup === "menu" ? menuId : undefined}
        className={HOVER_ACTION_BUTTON}
      >
        <Ellipsis {...HOVER_ICON} aria-hidden="true" />
      </button>
      {persistent}
      <span className="sr-only" aria-live="polite">{announce}</span>

      {react && barMotion.shown && portal(
        <div
          ref={barRef}
          id={barId}
          role="menu"
          aria-label={t("reactions.quick")}
          aria-orientation="horizontal"
          data-reaction-bar
          onKeyDown={(event) => onPopupKey(event, barRef, reactRef)}
          className={cn(POPUP_SURFACE, "w-max max-w-[calc(100vw-1rem)] rounded-full p-1.5", barMotion.className)}
          {...barMotion.exitProps}
        >
          <QuickReactionRow mine={react.mine} onPick={(emoji) => pick(emoji, reactRef)} onMore={() => setPopup("picker")} />
        </div>,
      )}

      {react && popup === "picker" && (
        <ReactionPicker
          anchorRef={rootRef}
          align={align}
          mine={react.mine}
          onPick={react.onPick}
          onClose={() => close(reactRef)}
        />
      )}

      {menuMotion.shown && portal(
        <CloseMenu.Provider value={() => close(moreRef)}>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={t("chat.messageActions")}
            data-message-menu
            onKeyDown={(event) => onPopupKey(event, menuRef, moreRef)}
            className={cn(
              POPUP_PLACE,
              MENU_SURFACE,
              MENU_FIT_ROW,
              "overflow-y-auto",
              menuMotion.className,
            )}
            {...menuMotion.exitProps}
          >
            {react && (
              <>
                <QuickReactionRow mine={react.mine} onPick={(emoji) => pick(emoji, moreRef)} onMore={() => setPopup("picker")} />
                <MenuDivider />
              </>
            )}
            {onReply && <MessageMenuItem label={t("chat.reply")} icon={replyIcon} onSelect={onReply} />}
            {copy && (
              <MessageMenuItem
                label={t("chat.copy")}
                icon={<Copy {...HOVER_ICON} />}
                onSelect={() => {
                  void copyText(copy).then((result) => { if (result === "copied") copied("chat.copyMessageDone"); });
                }}
              />
            )}
            {requestId && (
              <MessageMenuItem
                label={t("chat.copyRequestId")}
                icon={<Copy {...HOVER_ICON} />}
                onSelect={() => {
                  void copyText(requestId).then((result) => { if (result === "copied") copied("chat.copyRequestIdDone"); });
                }}
              />
            )}
            {children && <MenuSection extra>{children}</MenuSection>}
            {view && <MenuSection>{view}</MenuSection>}
          </div>
        </CloseMenu.Provider>,
      )}
    </div>
  );
}
