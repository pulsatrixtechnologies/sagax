// The sidebar section menu on a server signed in with Perspicax.
// Right-click, Shift+F10 or the ContextMenu key on a section header, or a
// right-click on the empty list area, opens it for every signed-in person.
// Sections are the person's own folders (src/lib/personal-sections.ts):
// they share nothing, so there is no members or sharing item. A bot is
// shared from its own panel; a group has its own people.
import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsDownUp, ChevronsUpDown, Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { MENU_ROW, MenuDivider } from "./menu-look";

export interface OrgSectionMenuActions {
  onRename?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onCollapseAll?: () => void;
  onExpandAll?: () => void;
  onDelete?: () => void;
}

/** Which items a section's menu shows: General and the empty list area
 * move and fold; one of the person's own sections also renames and deletes
 * (its items go back to General). A team is made from a bot's right-click
 * menu, Move to › New team… (2026-10-15), not typed in the sidebar. */
export function orgSectionMenuItems(input: { named: boolean; canMoveUp: boolean; canMoveDown: boolean; anyExpanded: boolean }): Array<keyof OrgSectionMenuActions> {
  const items: Array<keyof OrgSectionMenuActions> = [];
  if (input.named) items.push("onRename");
  if (input.canMoveUp) items.push("onMoveUp");
  if (input.canMoveDown) items.push("onMoveDown");
  items.push(input.anyExpanded ? "onCollapseAll" : "onExpandAll");
  if (input.named) items.push("onDelete");
  return items;
}

const ITEM_KEYS = {
  onRename: { label: "sidebar.section.rename", Icon: Pencil },
  onMoveUp: { label: "sidebar.section.moveUp", Icon: ArrowUp },
  onMoveDown: { label: "sidebar.section.moveDown", Icon: ArrowDown },
  onCollapseAll: { label: "sidebar.section.collapseAll", Icon: ChevronsDownUp },
  onExpandAll: { label: "sidebar.section.expandAll", Icon: ChevronsUpDown },
  onDelete: { label: "sidebar.section.delete", Icon: Trash2 },
} as const satisfies Record<keyof OrgSectionMenuActions, { label: string; Icon: typeof Pencil }>;

/** The section a menu item belongs to: organize (rename, move), view
 * (fold), then Delete alone in red, each set apart by a divider (the reference design's
 * sections, 2026-10-16). */
const ITEM_SECTION: Record<keyof OrgSectionMenuActions, number> = {
  onRename: 0, onMoveUp: 0, onMoveDown: 0, onCollapseAll: 1, onExpandAll: 1, onDelete: 2,
};

export function OrgSectionMenuItems({ items, actions }: { items: Array<keyof OrgSectionMenuActions>; actions: OrgSectionMenuActions }) {
  const item = MENU_ROW;
  const shown = items.filter((key) => Boolean(actions[key]));
  return (
    <>
      {shown.map((key, index) => {
        const action = actions[key]!;
        const { label, Icon } = ITEM_KEYS[key];
        const divided = index > 0 && ITEM_SECTION[shown[index - 1]!] !== ITEM_SECTION[key];
        return (
          <Fragment key={key}>
            {divided && <MenuDivider data-section-menu-divider="" />}
            <button type="button" role="menuitem" autoFocus={index === 0} className={cn(item, key === "onDelete" && "text-danger")} onClick={action}>
              <Icon size={14} aria-hidden="true" />{t(label)}
            </button>
          </Fragment>
        );
      })}
    </>
  );
}

/** A section name typed in place (a rename in the header): Enter or leaving
 * the field saves the stored name, Escape leaves it (#5065). */
export function SectionNameInput({ initial = "", onSave, onCancel }: { initial?: string; onSave: (name: string) => Promise<string | null>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // Set before the first await so Enter and the blur that follows it save once.
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = async () => {
    if (done.current) return;
    const name = value.trim();
    if (!name || name === initial.trim()) { done.current = true; onCancel(); return; }
    done.current = true;
    setSaving(true);
    const failed = await onSave(name);
    if (failed) {
      done.current = false;
      setSaving(false);
      setError(failed);
      return;
    }
    onCancel();
  };
  return (
    <div className="flex flex-col gap-1 px-2 py-1" data-section-name-input>
      <input
        ref={ref}
        value={value}
        maxLength={60}
        aria-label={t("sidebar.section.namePlaceholder")}
        placeholder={t("sidebar.section.namePlaceholder")}
        disabled={saving}
        onChange={(event) => { setValue(event.target.value); setError(null); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); void save(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); done.current = true; onCancel(); }
        }}
        onBlur={() => { void save(); }}
        className="w-full rounded-md border border-hairline/60 bg-inset px-2 py-1 text-[13px] font-normal text-sidebar-ink focus:outline-none"
      />
      {error && <span role="alert" className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}
