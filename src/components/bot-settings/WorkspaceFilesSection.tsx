// Files: the bot's whole workspace (docs/bot-workspace.md). Each file says
// when it reaches the bot (every turn, on demand, never loaded), its size
// against a budget when it has one, its dates, when the bot last used it,
// and whether it looks forgotten (no use in 30 days, not loaded every turn).
//
// Create a file or folder anywhere, upload any type (with progress), rename,
// move (drag or Move to…), delete (with a count for non-empty folders), and
// multi-select for bulk delete / move. SOUL.md, MEMORY.md and RULES.md keep
// their Every turn badge and cannot be deleted, renamed or moved.
//
// RULES.md and docs/ open in the markdown editor in place for whoever may
// edit the Soul; MEMORY.md and memory/ do too when the viewer may edit
// Memory. Images and PDFs open in the read-only previewer; other binaries
// show type icon, size and download.
import {
  Brain, File as FileIcon, FilePlus, Folder, FolderInput, FolderOpen, MoreHorizontal, Trash2, Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

import { AnchoredPopover } from "@/components/AnchoredPopover";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { WorkspaceListing } from "@/lib/workspace-files";
import type { Bot, BotSettingsSection } from "@/state/store";
import { HelpTip, PLAIN_CARD, PLAIN_FIELD, Switch, useSettingsSurface } from "../SettingsPrimitives";
import { MenuItem } from "./FilesSection";
import { inputCls } from "./field";
import { MemoryFolderOptions, type MemoryFolderParts } from "./MemoryFolderOptions";
import { MemoryToggleCard } from "./MemorySection";
import { PaneSection } from "./PaneSection";
import { ProfileRow } from "./ProfileRow";
import { buttonCls, iconButtonCls, type Creating } from "./WorkspaceFilesSection.tsx-parts/helpers";
import { WorkspaceFileList } from "./WorkspaceFilesSection.tsx-parts/WorkspaceFileList";
import { WorkspaceOverlays } from "./WorkspaceFilesSection.tsx-parts/WorkspaceOverlays";
import { useWorkspaceFiles } from "./WorkspaceFilesSection.tsx-parts/useWorkspaceFiles";

export { LoadBadge, entryDetails } from "./WorkspaceFilesSection.tsx-parts/helpers";

export function WorkspaceFilesSection({
  bot,
  active,
  onOpenSection,
  initial,
  initialExpanded,
  memoryEditable = false,
  memory,
}: {
  bot: Bot;
  active: boolean;
  memoryEditable?: boolean;
  memory?: { enabled: boolean; busy: boolean; onToggle: (enabled: boolean) => void };
  onOpenSection: (target: BotSettingsSection) => void;
  initial?: WorkspaceListing;
  initialExpanded?: Iterable<string>;
}) {
  const files = useWorkspaceFiles({ bot, active, onOpenSection, initial, initialExpanded, memoryEditable });
  const {
    advanced, listing, error, busy, newName, setNewName, creating, setCreating, showOptions, setShowOptions, selected, setSelected, setDropTarget, upload, setMoving, uploadRef, uploadFolderRef, reload, startCreate, create, askDelete, onUpload, onDragOver, onDrop,
  } = files;

  const plain = useSettingsSurface() === "plain";

  const toolbar = (
    <>
      <NewMenu memoryEditable={memoryEditable} busy={busy} onPick={(kind) => startCreate(kind)} />
      <button
        type="button"
        className={cn(buttonCls, "inline-flex items-center gap-1.5")}
        disabled={busy}
        onClick={() => { uploadFolderRef.current = null; uploadRef.current?.click(); }}
        data-files-upload=""
      >
        <Upload size={14} aria-hidden="true" />
        {t("persona.files.upload")}
      </button>
      {memoryEditable && (
        <button
          type="button"
          className={cn(iconButtonCls, plain ? "rounded-full p-1.5" : "ml-auto p-1.5")}
          aria-label={t("persona.files.options")}
          title={t("persona.files.options")}
          aria-expanded={showOptions}
          onClick={() => setShowOptions((shown) => !shown)}
          data-files-options=""
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      )}
      <input ref={uploadRef} type="file" multiple hidden onChange={onUpload} data-files-upload-input="" />
    </>
  );

  // a plain button beside a PILL: Cancel, Close
  const quietCls = plain ? buttonCls : "rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink";
  const lineCls = plain ? "px-4 py-2.5 text-[12px] leading-4" : "text-[12.5px]";

  const createBox = creating && (
    <div
      className={plain ? "flex flex-wrap items-center gap-2 px-4 py-2" : "flex flex-wrap items-center gap-2 rounded-xl border-[0.5px] border-border bg-elevated p-2"}
      data-files-create={creating}
    >
      <input
        autoFocus
        value={newName}
        onChange={(event) => setNewName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && newName.trim()) {
            event.preventDefault();
            create();
          }
          if (event.key === "Escape") setCreating(null);
        }}
        placeholder={t(
          creating === "topic" ? "botPanel.memory.topicPlaceholder"
            : creating === "folder" ? "persona.files.newFolderPlaceholder"
              : "persona.files.newFilePlaceholder",
        )}
        aria-label={t(
          creating === "topic" ? "botPanel.memory.topicAria"
            : creating === "folder" ? "persona.files.newFolderLabel"
              : "persona.files.newFileLabel",
        )}
        className={cn(plain ? PLAIN_FIELD : inputCls, "min-w-0 max-w-[240px] flex-1")}
        data-files-new-name=""
      />
      <button type="button" className={buttonCls} disabled={busy || !newName.trim()} onClick={create} data-files-new="">
        {t("persona.files.create")}
      </button>
      <button type="button" className={quietCls} onClick={() => setCreating(null)}>
        {t("common.cancel")}
      </button>
    </div>
  );

  const bulkBar = selected.size > 0 && (
    <div
      className={plain ? "flex flex-wrap items-center gap-2 px-4 py-2" : "flex flex-wrap items-center gap-2 rounded-xl border-[0.5px] border-border bg-elevated px-3 py-2"}
      data-files-bulk=""
    >
      <span className={plain ? "text-[12px] text-ink-secondary" : "text-[12.5px] text-ink-secondary"}>{t("persona.files.selected", { count: selected.size })}</span>
      <button type="button" className={buttonCls} disabled={busy} onClick={() => setMoving({ paths: [...selected], anchor: "bulk" })} data-files-bulk-move="">
        <FolderInput size={14} aria-hidden="true" className="mr-1 inline" />
        {t("persona.files.bulkMove")}
      </button>
      <button type="button" className={cn(buttonCls, "text-danger")} disabled={busy} onClick={() => void askDelete([...selected])} data-files-bulk-delete="">
        <Trash2 size={14} aria-hidden="true" className="mr-1 inline" />
        {t("persona.files.bulkDelete")}
      </button>
      <button type="button" className={plain ? buttonCls : "rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control"} onClick={() => setSelected(new Set())}>
        {t("common.cancel")}
      </button>
    </div>
  );

  const uploadLine = upload && (
    <p className={cn(lineCls, "text-ink-secondary")} data-files-upload-progress="">
      {t("persona.files.uploadProgress", { name: upload.name, percent: upload.percent })}
    </p>
  );

  const statusLines = (
    <>
      {error && <p role="alert" className={cn(lineCls, "text-danger")}>{error}</p>}
      {listing === null && !error && <p className={cn(lineCls, "text-ink-secondary")}>{t("persona.files.loading")}</p>}
      {listing?.truncated && <p className={cn(lineCls, "text-ink-secondary")}>{t("persona.files.truncated")}</p>}
    </>
  );

  const list = <WorkspaceFileList files={files} plain={plain} quietCls={quietCls} botId={bot.id} />;

  const overlays = <WorkspaceOverlays files={files} />;

  const dropProps = {
    onDragOver: (event: DragEvent<HTMLDivElement>) => onDragOver(event, null),
    onDragLeave: () => setDropTarget(null),
    onDrop: (event: DragEvent<HTMLDivElement>) => onDrop(event, null),
  };

  if (plain) {
    // The profile page (#2313): one labelled card of rows, "Bot folder",
    // with the toolbar at the right of its label; tidying and the change
    // log are two labelled cards under it when the "..." menu is open.
    const folder = (parts: MemoryFolderParts | null) => (
      <>
        <PaneSection title={t("botSettings.nav.files")} help={t("persona.files.intro")} action={toolbar} plain data-files-folder="">
          <div className={PLAIN_CARD} data-settings-surface="">
            {memory && (
              <ProfileRow
                icon={<Brain />}
                label={(
                  <span className="inline-flex items-center gap-1.5">
                    {t("botPanel.memory.let")}
                    <HelpTip label={t("settings.moreAbout", { title: t("botPanel.memory.let") })}>{t("botPanel.memory.off")}</HelpTip>
                  </span>
                )}
                state={memory.busy ? t("botPanel.memory.busy").trim() : undefined}
                action={<Switch checked={memory.enabled} disabled={memory.busy} aria-label={t("botPanel.memory.let")} onClick={() => memory.onToggle(!memory.enabled)} />}
                wrap
                data-memory-toggle=""
              />
            )}
            <ProfileRow
              icon={<FolderOpen />}
              label={t("persona.files.short")}
              state={advanced && listing ? <span className="break-all" data-workspace-path="">{listing.workspacePath}</span> : undefined}
              wrap
            />
            {parts?.notice}
            {createBox}
            {bulkBar}
            {uploadLine}
            {parts?.status}
            {statusLines}
            {list}
          </div>
        </PaneSection>
        {parts?.options}
      </>
    );
    return (
      <div className="flex flex-col gap-5" data-workspace-files="" {...dropProps}>
        {memoryEditable
          ? <MemoryFolderOptions bot={bot} active={active} showOptions={showOptions} onChanged={() => void reload()}>{folder}</MemoryFolderOptions>
          : folder(null)}
        {overlays}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-workspace-files="" {...dropProps}>
      {memory && <MemoryToggleCard enabled={memory.enabled} busy={memory.busy} onToggle={memory.onToggle} />}
      <div className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
        <span>{t("persona.files.short")}</span>
        <HelpTip label={t("settings.moreAbout", { title: t("botSettings.nav.files") })}>
          <span className="block">{t("persona.files.intro")}</span>
          {advanced && listing && <span className="mt-2 block break-all font-mono" data-workspace-path="">{listing.workspacePath}</span>}
        </HelpTip>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
      </div>

      {createBox}
      {bulkBar}
      {uploadLine}

      {memoryEditable && <MemoryFolderOptions bot={bot} active={active} showOptions={showOptions} onChanged={() => void reload()} />}

      {statusLines}
      {list}
      {overlays}
    </div>
  );
}


function NewMenu({ memoryEditable, busy, onPick }: { memoryEditable: boolean; busy: boolean; onPick: (kind: Creating) => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !buttonRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={cn(buttonCls, "inline-flex items-center gap-1.5")}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="menu"
        data-files-new-menu=""
        onClick={() => setOpen((value) => !value)}
      >
        <FilePlus size={14} aria-hidden="true" />
        {t("persona.files.newMenu")}
      </button>
      {open && (
        <AnchoredPopover
          anchorRef={buttonRef}
          popoverRef={menuRef}
          role="menu"
          aria-label={t("persona.files.newKindLabel")}
          align="start"
          className="flex w-[200px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px] shadow-lg popover-surface"
        >
          <MenuItem icon={<FileIcon size={14} />} label={t("persona.files.newKind.file")} data-files-kind="file" onClick={() => { setOpen(false); onPick("file"); }} />
          <MenuItem icon={<Folder size={14} />} label={t("persona.files.newKind.folder")} data-files-kind="folder" onClick={() => { setOpen(false); onPick("folder"); }} />
          {memoryEditable && (
            <MenuItem icon={<FileIcon size={14} />} label={t("persona.files.newKind.topic")} data-files-kind="topic" onClick={() => { setOpen(false); onPick("topic"); }} />
          )}
        </AnchoredPopover>
      )}
    </div>
  );
}
