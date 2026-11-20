import { Download, FolderInput, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react";
import { Fragment, useRef, type ReactNode } from "react";

import { AnchoredPopover } from "@/components/AnchoredPopover";
import { t } from "@/lib/i18n";
import { entryName, type WorkspaceEntry } from "@/lib/workspace-files";
import { MenuItem, PopoverMenu } from "../FilesSection";
import { iconButtonCls } from "./helpers";
import { MENU_FIT_ROW, MENU_ROW, MENU_SURFACE, MenuDivider } from "@/components/menu-look";
import { cn } from "@/lib/cn";

/** One item a caller adds to the folder's "..." menu or to an entry's (the
 * bot page, M-20261119-081: what its removed Skills, Write a command and Its
 * work sections offered lives in these menus now). `divider`: a line before it. */
export interface WorkspaceMenuItem {
  id: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  /** a checkbox item (Learn from use, Upkeep and changes) */
  checked?: boolean;
  divider?: boolean;
  run: () => void;
}

/** What a caller adds to one entry of the folder: items first in its "..."
 * menu, a grey line under its name, and a muted name (a skill that is off). */
export interface WorkspaceEntryExtras {
  menu?: readonly WorkspaceMenuItem[];
  note?: ReactNode;
  muted?: boolean;
}

/** The items of a menu, a divider where one asks for it. */
export function menuItems(items: readonly WorkspaceMenuItem[], close: () => void) {
  return items.map((item, index) => (
    <Fragment key={item.id}>
      {item.divider && index > 0 && <MenuDivider />}
      <MenuItem
        icon={item.icon}
        label={item.label}
        disabled={item.disabled}
        {...(item.checked === undefined ? {} : { checked: item.checked })}
        data-files-menu-item={item.id}
        onClick={() => { close(); item.run(); }}
      />
    </Fragment>
  ));
}

/** The folder's own "..." menu, at the right of its toolbar. */
export function FolderMenu({ items, buttonClass, className }: { items: readonly WorkspaceMenuItem[]; buttonClass: string; className?: string }) {
  return (
    <PopoverMenu
      label={t("persona.files.options")}
      icon={<MoreHorizontal size={16} aria-hidden="true" />}
      buttonClass={buttonClass}
      menuLabel={t("persona.files.options")}
      className={className}
      data-files-options=""
    >
      {(close) => menuItems(items, close)}
    </PopoverMenu>
  );
}

export function RowMenu({
  entry,
  core,
  busy,
  onRename,
  onMove,
  onDownload,
  onDelete,
  onUploadInto,
  extra = [],
}: {
  entry: WorkspaceEntry;
  core: boolean;
  busy: boolean;
  onRename: () => void;
  onMove: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onUploadInto: () => void;
  /** the caller's items for this entry, first (a skill's actions on its folder) */
  extra?: readonly WorkspaceMenuItem[];
}) {
  const name = entryName(entry.path);
  return (
    <PopoverMenu
      label={t("persona.files.menu", { name })}
      icon={<MoreHorizontal size={14} aria-hidden="true" />}
      buttonClass={iconButtonCls}
      menuLabel={t("persona.files.menu", { name })}
      data-file-menu={entry.path}
    >
      {(close) => (
        <>
          {menuItems(extra, close)}
          {extra.length > 0 && <MenuDivider />}
          {!core && (
            <MenuItem icon={<Pencil size={14} />} label={t("persona.files.rename", { name })} disabled={busy} onClick={() => { close(); onRename(); }} />
          )}
          {!core && (
            <MenuItem icon={<FolderInput size={14} />} label={t("persona.files.moveTo")} disabled={busy} onClick={() => { close(); onMove(); }} />
          )}
          {entry.kind === "dir" && (
            <MenuItem icon={<Upload size={14} />} label={t("persona.files.uploadInto")} disabled={busy} onClick={() => { close(); onUploadInto(); }} />
          )}
          {entry.kind === "file" && !entry.virtual && (
            <MenuItem icon={<Download size={14} />} label={t("persona.files.download", { name })} disabled={busy} onClick={() => { close(); onDownload(); }} />
          )}
          {!core && (
            <MenuItem icon={<Trash2 size={14} />} label={t("persona.files.delete", { name })} ariaLabel={t("persona.files.delete", { name })} data-file-delete={entry.path} disabled={busy} onClick={() => { close(); onDelete(); }} />
          )}
        </>
      )}
    </PopoverMenu>
  );
}

export function MovePopover({ folders, onPick, onClose }: { folders: string[]; onPick: (folder: string | null) => void; onClose: () => void }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchorRef} className="fixed bottom-8 left-1/2 z-[75] -translate-x-1/2">
      <AnchoredPopover
        anchorRef={anchorRef}
        popoverRef={popoverRef}
        align="center"
        side="top"
        className={cn(MENU_SURFACE, MENU_FIT_ROW, "max-h-72 overflow-auto")}
        data-files-move-menu=""
      >
        <div className="px-2 py-1 text-[11.5px] text-ink-tertiary">{t("persona.files.moveTo")}</div>
        <button type="button" className={MENU_ROW} onClick={() => onPick(null)} data-files-move-root="">
          {t("persona.files.root")}
        </button>
        {folders.map((folder) => (
          <button key={folder} type="button" className={MENU_ROW} onClick={() => onPick(folder)} data-files-move-to={folder}>
            {folder}/
          </button>
        ))}
        <button type="button" className={cn(MENU_ROW, "text-ink-secondary")} onClick={onClose}>
          {t("common.cancel")}
        </button>
      </AnchoredPopover>
    </div>
  );
}
