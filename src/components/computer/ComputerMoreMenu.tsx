// The "..." beside the computer's main action (Open live desktop): the
// rarer actions, Open two desktops, Sleep, Works on and Delete the VM, in
// one small menu. A click outside or Escape closes it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { AnchoredPopover } from "@/components/AnchoredPopover";
import { MENU_SURFACE, MenuGlyph, menuRow, MENU_FIT_ROW } from "@/components/menu-look";

export type ComputerMoreItem = {
  id: string;
  icon: ReactNode;
  label: string;
  title?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

export function ComputerMoreMenu({ items, defaultOpen = false }: { items: ComputerMoreItem[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuElRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && !menuElRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative" data-computer-more="">
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("computer.more")}
        title={t("computer.more")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-full min-h-9 items-center justify-center rounded-lg bg-control px-2.5 text-ink-secondary hover:bg-raised-hover hover:text-ink"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <AnchoredPopover anchorRef={buttonRef} popoverRef={menuElRef} role="menu" aria-label={t("computer.more")} side="top" align="end" className={cn(MENU_SURFACE, MENU_FIT_ROW, "")}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-computer-more-item={item.id}
              disabled={item.disabled}
              title={item.title}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={menuRow(item.danger ? "danger" : "idle")}
            >
              <MenuGlyph danger={item.danger}>{item.icon}</MenuGlyph>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </AnchoredPopover>
      )}
    </div>
  );
}
