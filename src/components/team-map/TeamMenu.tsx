import { useState } from "react";
import { BookOpen, Brain, MoreHorizontal, Pencil, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { MENU_FIT_ROW, MENU_SURFACE, MenuGlyph, menuRow } from "../menu-look";

/** A team's "..." menu: the rows the old canvas had (add or move bots,
 * instructions, memory, rename, delete). It is a native details so a keyboard,
 * a screen reader and the UI smokes find it as before; it opens upward when the
 * team sits near the bottom of the map. */
export function TeamMenu({ sectionKey, label, onEditTeam, onInstructions, onMemory, onDeleteTeam }: {
  sectionKey: string;
  label: string;
  onEditTeam: (section: string, rename?: boolean) => void;
  onInstructions: (key: string, label: string) => void;
  onMemory?: (key: string, label: string) => void;
  onDeleteTeam: (section: string) => void;
}) {
  const [above, setAbove] = useState(false);
  return (
    <details className="relative" onToggle={(event) => {
      const details = event.currentTarget;
      if (!details.open) return;
      const viewport = details.closest<HTMLElement>("[data-team-canvas]");
      const bounds = viewport?.getBoundingClientRect();
      setAbove(Boolean(bounds && details.getBoundingClientRect().bottom > bounds.bottom - 210));
      viewport?.querySelectorAll("details[open]").forEach((other) => { if (other !== details) other.removeAttribute("open"); });
    }}>
      <summary aria-label={t("canvas.manageTeam", { name: label })} className="flex size-7 shrink-0 cursor-pointer list-none items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden"><MoreHorizontal size={16} /></summary>
      <div role="menu" aria-label={t("canvas.manageTeam", { name: label })} className={cn(MENU_SURFACE, MENU_FIT_ROW, "absolute right-0 z-50 animate-pop-in", above ? "bottom-8" : "top-8")} onClick={(event) => {
        const menu = event.currentTarget.closest("details");
        menu?.querySelector("summary")?.focus();
        menu?.removeAttribute("open");
      }}>
        <button type="button" role="menuitem" className={menuRow()} onClick={() => onEditTeam(sectionKey)} aria-label={t("team.moveTo", { name: label })}><MenuGlyph><Users /></MenuGlyph><span className="min-w-0 flex-1 truncate">{t("team.moveTo", { name: label })}</span></button>
        <button type="button" role="menuitem" className={menuRow()} onClick={() => onInstructions(sectionKey, label)} aria-label={t("team.instructionsEdit", { name: label })}><MenuGlyph><BookOpen /></MenuGlyph><span className="min-w-0 flex-1 truncate">{t("team.instructions")}</span></button>
        {onMemory && <button type="button" role="menuitem" className={menuRow()} onClick={() => onMemory(sectionKey, label)} aria-label={t("teamCanvas.memoryAria", { name: label })}><MenuGlyph><Brain /></MenuGlyph><span className="min-w-0 flex-1 truncate">{t("botPanel.teamMemorySharing")}</span></button>}
        {sectionKey && <button type="button" role="menuitem" className={menuRow()} onClick={() => onEditTeam(sectionKey, true)} aria-label={t("team.renameAria", { name: label })}><MenuGlyph><Pencil /></MenuGlyph><span className="min-w-0 flex-1 truncate">{t("team.rename")}</span></button>}
        {sectionKey && <button type="button" role="menuitem" className={menuRow("danger")} onClick={() => onDeleteTeam(sectionKey)} aria-label={t("team.deleteAria", { name: label })}><MenuGlyph danger><Trash2 /></MenuGlyph><span className="min-w-0 flex-1 truncate">{t("team.delete")}</span></button>}
      </div>
    </details>
  );
}
