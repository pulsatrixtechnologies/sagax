import { Download, FolderInput, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react";
import { useRef } from "react";

import { AnchoredPopover } from "@/components/AnchoredPopover";
import { t } from "@/lib/i18n";
import { entryName, type WorkspaceEntry } from "@/lib/workspace-files";
import { MenuItem, PopoverMenu } from "../FilesSection";
import { iconButtonCls } from "./helpers";

export function RowMenu({
  entry,
  core,
  busy,
  onRename,
  onMove,
  onDownload,
  onDelete,
  onUploadInto,
}: {
  entry: WorkspaceEntry;
  core: boolean;
  busy: boolean;
  onRename: () => void;
  onMove: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onUploadInto: () => void;
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
        className="flex max-h-72 min-w-[220px] flex-col gap-0.5 overflow-auto rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] shadow-2xl"
        data-files-move-menu=""
      >
        <div className="px-2 py-1 text-[11.5px] text-ink-tertiary">{t("persona.files.moveTo")}</div>
        <button type="button" className="rounded-md px-2 py-1.5 text-left hover:bg-hover" onClick={() => onPick(null)} data-files-move-root="">
          {t("persona.files.root")}
        </button>
        {folders.map((folder) => (
          <button key={folder} type="button" className="rounded-md px-2 py-1.5 text-left hover:bg-hover" onClick={() => onPick(folder)} data-files-move-to={folder}>
            {folder}/
          </button>
        ))}
        <button type="button" className="mt-1 rounded-md px-2 py-1.5 text-left text-ink-secondary hover:bg-hover" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </AnchoredPopover>
    </div>
  );
}
