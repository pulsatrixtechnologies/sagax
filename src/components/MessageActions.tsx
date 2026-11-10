import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { HOVER_ACTION_BUTTON, HOVER_ICON, MessageHoverActions, MessageMenuItem as MenuEntry, type HoverReactions } from "./MessageHoverActions";

/** One size and stroke for every icon beside a message and in its menu:
 * thin rounded outlines, like the rest of the chat chrome. */
export const ACTION_ICON = HOVER_ICON;

/** Class shared by every control that lives in the row: the row decides
 * when it is visible, so the buttons themselves never fade. */
export const messageActionClass = HOVER_ACTION_BUTTON;

export type MessageMenuItem = {
  key: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  title?: string;
  disabled?: boolean;
  /** "view": changes how the message is shown (read aloud, raw markdown),
   * listed in the menu's last section. */
  section?: "view";
};

/** Whether the chat's turn is running, apart from the row values every
 * message reads: a turn starting or ending re-renders only the few controls
 * that wait for it (Edit, Regenerate, the version arrows), not every row. */
export const ChatBusyContext = createContext(false);

/** What only works between turns: left out while the chat's turn runs. It
 * reads the turn itself, so the row around it does not. */
export function IdleOnly({ children }: { children: ReactNode }) {
  return use(ChatBusyContext) ? null : children;
}

/** Where a message row starts: the element that hovering, focusing or
 * tapping reveals the actions for. */
export const MESSAGE_ROW = "data-message-row";

const INTERACTIVE = "a, button, input, textarea, select, summary, label, [role=button], [contenteditable=true]";
const LONG_PRESS_MS = 450;

/** The menu's entries, or nothing when there are none. */
function entries(items: MessageMenuItem[]): ReactNode {
  if (items.length === 0) return null;
  return items.map((item) => (
    <MenuEntry key={item.key} icon={item.icon} label={item.label} title={item.title} disabled={item.disabled} onSelect={item.onSelect} />
  ));
}

function focusVisible(target: EventTarget | null): boolean {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** React, reply and a "…" menu beside a room message (MessageHoverActions,
 * the same tray as a 1:1 message). They show only while the pointer is over
 * the message, or keyboard focus is inside it, and on a touch screen after a
 * tap or a long press on the message. The "…" menu starts with the quick
 * reactions, then Reply, Copy, Copy request ID, then `menu`: edit,
 * regenerate and pin, then its "view" entries (read aloud, raw markdown)
 * in a last section. `forceOpen` keeps the row out while a control in
 * it has to stay reachable, like the stop button of a message being read
 * aloud. The row mirrors on the user side so the first control stays
 * nearest the bubble. */
export function MessageActions({
  side,
  forceOpen = false,
  className,
  menu = [],
  onReply,
  copy,
  requestId,
  react,
  persistent,
}: {
  side: "user" | "bot";
  forceOpen?: boolean;
  className?: string;
  menu?: MessageMenuItem[];
  onReply?: () => void;
  copy?: string;
  requestId?: string;
  react?: HoverReactions;
  persistent?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const shown = forceOpen || menuOpen || hovered || keyboardFocus || tapped;

  // The message row, not just this strip, reveals the actions.
  useEffect(() => {
    const row = rootRef.current?.closest<HTMLElement>(`[${MESSAGE_ROW}]`) ?? rootRef.current;
    rowRef.current = row;
    if (!row) return;
    let press: { x: number; y: number; at: number; timer: ReturnType<typeof setTimeout> } | null = null;
    const enter = (event: PointerEvent) => { if (event.pointerType !== "touch") setHovered(true); };
    const leave = (event: PointerEvent) => { if (event.pointerType !== "touch") setHovered(false); };
    const focusIn = (event: FocusEvent) => setKeyboardFocus(focusVisible(event.target));
    const focusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
      setKeyboardFocus(false);
    };
    const inside = (target: EventTarget | null) => target instanceof Element && Boolean(rootRef.current?.contains(target));
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || inside(event.target)) return;
      if (press) clearTimeout(press.timer);
      press = { x: event.clientX, y: event.clientY, at: Date.now(), timer: setTimeout(() => setTapped(true), LONG_PRESS_MS) };
    };
    const move = (event: PointerEvent) => {
      if (!press || event.pointerType !== "touch") return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
        clearTimeout(press.timer);
        press = null;
      }
    };
    const cancel = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };
    const up = (event: PointerEvent) => {
      if (!press || event.pointerType !== "touch") return;
      clearTimeout(press.timer);
      const quick = Date.now() - press.at < LONG_PRESS_MS;
      press = null;
      // a tap on a link or a button does its own thing, and a tap that
      // ends a text selection is not asking for the actions
      if (!quick || (event.target instanceof Element && event.target.closest(INTERACTIVE))) return;
      if (window.getSelection()?.toString()) return;
      setTapped((value) => !value);
    };
    row.addEventListener("pointerenter", enter);
    row.addEventListener("pointerleave", leave);
    row.addEventListener("focusin", focusIn);
    row.addEventListener("focusout", focusOut);
    row.addEventListener("pointerdown", down);
    row.addEventListener("pointermove", move);
    row.addEventListener("pointerup", up);
    row.addEventListener("pointercancel", cancel);
    return () => {
      if (press) clearTimeout(press.timer);
      row.removeEventListener("pointerenter", enter);
      row.removeEventListener("pointerleave", leave);
      row.removeEventListener("focusin", focusIn);
      row.removeEventListener("focusout", focusOut);
      row.removeEventListener("pointerdown", down);
      row.removeEventListener("pointermove", move);
      row.removeEventListener("pointerup", up);
      row.removeEventListener("pointercancel", cancel);
    };
  }, []);

  // a tap elsewhere puts a tap-revealed row away again
  usePopoverDismiss(tapped && !menuOpen, rowRef, () => setTapped(false));

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative flex items-center self-end pb-0.5",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
      data-testid="message-actions"
      data-shown={shown ? "true" : undefined}
    >
      <MessageHoverActions side={side} onReply={onReply} copy={copy} requestId={requestId} react={react} persistent={persistent} onOpenChange={setMenuOpen}
        view={entries(menu.filter((item) => item.section === "view"))}>
        {entries(menu.filter((item) => item.section !== "view"))}
      </MessageHoverActions>
    </div>
  );
}
