import { useStoreSelector } from "@/state/store-selector";
import { useEffect, useRef, useState } from "react";
import { Check, FolderMinus } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useHeldMenuMotion } from "../MenuMotion";
import { MENU_ROW_DANGER, MENU_SURFACE, MenuDivider, menuRow, MENU_FIT_ROW, useMenuInWindow } from "../menu-look";

/** Move-to-section popover: existing sections as chips (checkmark on the
 * target's current one), a create field, and a remove action. Serves bots
 * and channels alike — the caller supplies the assignment. Mirrors the
 * context menu's fixed positioning + dismiss-on-outside-click contract. */
export function SectionPicker({
  current,
  anchor,
  onClose,
  onAssign,
  names,
}: {
  /** the viewer's own sections (organization server); else the server's */
  names?: readonly string[] | undefined;
  /** the target's current section; undefined = none */
  current: string | undefined;
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  /** "" clears — the server drops an empty section */
  onAssign: (section: string) => void;
}) {
  const state = useStoreSelector((current) => ({ sections: current.sections }), (a, b) => a.sections === b.sections);
  const [name, setName] = useState("");
  const motion = useHeldMenuMotion(anchor);
  const shown = motion.value;
  const heldCurrent = useRef(current);
  const pickerRef = useRef<HTMLDivElement>(null);
  useMenuInWindow(pickerRef, shown && { left: shown.x, top: shown.y });
  if (anchor) heldCurrent.current = current;
  const trimmed = name.trim();

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-section-picker]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [anchor, onClose]);

  // Prefer the caller's list (personal folders on an organization server).
  // Fallback is the server's sections for this viewer only (#2045): never
  // harvest bot.section / group.section, or a shared bot would offer its
  // owner's team name here.
  const sections = names ? [...names] : [...(state.sections ?? [])];

  const assign = (section: string) => {
    onAssign(section);
    onClose();
  };

  if (!motion.shown || !shown) return null;
  const sectionCurrent = heldCurrent.current;

  return (
    <div
      ref={pickerRef}
      data-section-picker
      style={{ top: shown.y, left: shown.x }}
      className={cn(MENU_SURFACE, MENU_FIT_ROW, "fixed z-40 overflow-hidden", motion.className)} {...motion.exitProps}
    >
      <div className="px-2 pb-1 pt-0.5 text-[12px] leading-4 text-ink-secondary">
        {t("sidebar.section.moveToContext")}
      </div>
      {sections.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {sections.map((section) => (
            <button
              key={section}
              onClick={() => assign(section)}
              className={cn(
                menuRow(section === sectionCurrent ? "active" : "idle"),
                "justify-between",
              )}
            >
              <span className="truncate">{section}</span>
              {section === sectionCurrent && <Check size={14} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-1.5 px-0.5 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmed || trimmed.length > 60) return;
          assign(trimmed);
        }}
      >
        <input
          autoFocus
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("sidebar.section.newContext")}
          aria-label={t("sidebar.section.newContextAria")}
          className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none"
        />
        <button
          type="submit"
          disabled={!trimmed || trimmed.length > 60}
          className={cn(
            "shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-medium",
            trimmed ? "bg-accent text-accent-ink" : "bg-hover text-ink-secondary",
          )}
        >
          {t("common.add")}
        </button>
      </form>
      {sectionCurrent && (
        <>
          <MenuDivider />
          <button
            onClick={() => assign("")}
            className={MENU_ROW_DANGER}
          >
            <FolderMinus size={15} />
            {t("sidebar.section.removeFromContext")}
          </button>
        </>
      )}
    </div>
  );
}
