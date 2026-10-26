// The "..." beside the computer's main action (Open live desktop): the
// rarer actions, Open two desktops, Sleep, Works on and Delete the VM, in
// one small menu. A click outside or Escape closes it.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { AnchoredPopover } from "@/components/AnchoredPopover";

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
        <AnchoredPopover anchorRef={buttonRef} popoverRef={menuElRef} role="menu" aria-label={t("computer.more")} side="top" align="end" className="flex w-[230px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px] shadow-lg popover-surface">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-computer-more-item={item.id}
              disabled={item.disabled}
              title={item.title}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40",
                item.danger ? "text-danger" : "text-ink",
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </AnchoredPopover>
      )}
    </div>
  );
}
