// The page's "+ Add" (#3399, shared with the Skills card for #3400): one pill
// whose menu lists described items, a title and a grey line that says what
// each one does. The arrows move in the menu, Home and End reach its ends,
// Escape closes it and gives the focus back to the pill, Tab leaves it.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { AnchoredPopover, useAnchoredDismissRoot } from "../../AnchoredPopover";
import { MENU_FIT_ROW, MENU_SURFACE, MenuDivider, MenuGlyph, menuRow } from "@/components/menu-look";
import { PILL, PRIMARY_PILL } from "../../SettingsPrimitives";

export interface AddMenuItem {
  id: string;
  icon: ReactNode;
  title: string;
  /** a grey line under the title; a menu of plain choices (the Vault's New item) has none */
  description?: string;
  /** a hairline above the item: it starts the menu's next section */
  separatorBefore?: boolean;
  onChoose: () => void;
}

/** One item of the Add menu: a title and a grey line that says what it does. */
function AddItem({ icon, title, description, onChoose, id, separatorBefore }: AddMenuItem) {
  return (
    <>
    {separatorBefore && <MenuDivider />}
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-bot-profile-add-item={id}
      onClick={onChoose}
      className={cn(menuRow(), description && "h-auto items-start py-1.5")}
    >
      <MenuGlyph>{icon}</MenuGlyph>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{title}</span>
        {description && <span data-bot-profile-add-description="" className="text-[12px] leading-4 text-ink-secondary">{description}</span>}
      </span>
    </button>
    </>
  );
}

/** "+ Add" and its described menu. An item closes the menu, then acts. */
export function AddMenu({ items, className, label = t("botProfile.add"), disabled, primary = false }: {
  items: readonly AddMenuItem[];
  className?: string;
  /** the page's one primary action (the Vault's "New item"): a filled pill, the words then a chevron */
  primary?: boolean;
  /** the pill's words and the menu's name */
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  const dismissRoot = useAnchoredDismissRoot(anchorRef, popoverRef);
  usePopoverDismiss(open, dismissRoot, () => setOpen(false));

  const menuItems = () => Array.from(popoverRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  // the menu takes the focus when it opens (its first item, or the last on Up)
  useEffect(() => {
    if (!open) return;
    const list = menuItems();
    (focusOnOpen.current === "last" ? list[list.length - 1] : list[0])?.focus();
    focusOnOpen.current = "first";
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) anchorRef.current?.focus();
  };
  const onKey = (event: ReactKeyboardEvent) => {
    if (!open) {
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && event.target === anchorRef.current) {
        event.preventDefault();
        focusOnOpen.current = event.key === "ArrowUp" ? "last" : "first";
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      // the menu only: the page and the profile stay open
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const list = menuItems();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (at + 1) % list.length
      : event.key === "ArrowUp" ? (at <= 0 ? list.length - 1 : at - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? list.length - 1
            : null;
    if (next === null) return;
    event.preventDefault();
    list[next]!.focus();
  };

  if (items.length === 0) return null;
  return (
    <div className={className} onKeyDown={onKey}>
      <button
        ref={anchorRef}
        type="button"
        data-bot-profile-add=""
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={cn(primary ? PRIMARY_PILL : PILL, "inline-flex shrink-0 items-center gap-1")}
      >
        {primary
          ? <>{label} <ChevronDown size={14} aria-hidden="true" /></>
          : <><Plus size={13} aria-hidden="true" /> {label}</>}
      </button>
      {open && (
        <AnchoredPopover
          anchorRef={anchorRef}
          popoverRef={popoverRef}
          align="end"
          role="menu"
          aria-label={label}
          className={cn(MENU_SURFACE, MENU_FIT_ROW)}
        >
          {items.map((item) => (
            <AddItem key={item.id} {...item} onChoose={() => { close(false); item.onChoose(); }} />
          ))}
        </AnchoredPopover>
      )}
    </div>
  );
}
