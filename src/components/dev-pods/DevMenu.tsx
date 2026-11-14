// The dev panel's menus: a pod's options, a folder's or a branch's actions,
// a change's actions. Drawn in a portal on <body> (AnchoredPopover), so the
// scrolling rail or a card never clips them; they flip above their button
// near the bottom and shift to stay inside the window. Close on a choice,
// Escape, or a press outside both the button and the menu.
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { AnchoredPopover } from "../AnchoredPopover";
import { useMenuMotion } from "../MenuMotion";
import { MENU_ROW, MENU_SURFACE } from "@/components/menu-look";

export const DEV_MENU_ITEM = MENU_ROW;

export function DevMenu({ open, anchorRef, label, onClose, width = 210, children }: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  label?: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const motion = useMenuMotion(open);
  const menuRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchorRef]);
  if (!motion.shown) return null;
  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      popoverRef={menuRef}
      role="menu"
      {...(label ? { "aria-label": label } : {})}
      side="bottom"
      align="end"
      className={cn(MENU_SURFACE, motion.className)}
      style={{ width }}
    >
      {/* a closing menu is only a picture of one (useMenuMotion exitProps) */}
      <div className="contents" {...motion.exitProps}>{children}</div>
    </AnchoredPopover>
  );
}
