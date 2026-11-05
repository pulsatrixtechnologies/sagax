import { useStoreSelector } from "@/state/store-selector";
import { equalRows, peerBots, peerGroups } from "@/state/view-slices";
import { useEffect, useRef, useState } from "react";
import { Check, FolderMinus } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useHeldMenuMotion } from "../MenuMotion";

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
  const state = useStoreSelector((current) => ({ bots: peerBots(current), groups: peerGroups(current), sections: current.sections }), (a, b) => equalRows(a.bots, b.bots) && equalRows(a.groups, b.groups) && a.sections === b.sections);
  const [name, setName] = useState("");
  const motion = useHeldMenuMotion(anchor);
  const shown = motion.value;
  const heldCurrent = useRef(current);
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

  // Hidden bots can carry a stale assignment; don't offer it as a context.
  // Channels and bots share one namespace, so Work or Personal can hold both.
  const sections = names ? [...names] : [
    ...new Set([
      ...(state.sections ?? []),
      ...state.bots.filter((b) => !b.hidden && b.section).map((b) => b.section!),
      ...state.groups.filter((g) => g.section).map((g) => g.section!),
    ]),
  ];

  const assign = (section: string) => {
    onAssign(section);
    onClose();
  };

  if (!motion.shown || !shown) return null;
  const sectionCurrent = heldCurrent.current;
  const top = Math.max(8, Math.min(shown.y, window.innerHeight - 300));
  const left = Math.min(shown.x, window.innerWidth - 260);

  return (
    <div
      data-section-picker
      style={{ top, left }}
      className={cn("fixed z-40 w-[236px] min-w-[200px] overflow-hidden rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 flex flex-col gap-0.5 text-[13px] leading-[18px]", motion.className)} {...motion.exitProps}
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
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px]",
                section === sectionCurrent ? "bg-selected text-ink" : "text-ink hover:bg-hover",
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
          <div className="mx-2 my-1 h-[0.5px] bg-border" />
          <button
            onClick={() => assign("")}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-danger hover:bg-hover"
          >
            <FolderMinus size={15} />
            {t("sidebar.section.removeFromContext")}
          </button>
        </>
      )}
    </div>
  );
}
