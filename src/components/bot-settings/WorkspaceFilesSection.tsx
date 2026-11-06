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
  Brain, Check, ChevronRight, Download, File as FileIcon, FilePlus, Folder, FolderInput,
  FolderOpen, MoreHorizontal, Pencil, Trash2, Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

import { AnchoredPopover } from "@/components/AnchoredPopover";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  entryDepth,
  entryName,
  isCoreWorkspaceFile,
  type WorkspaceEntry,
  type WorkspaceListing,
} from "@/lib/workspace-files";
import type { Bot, BotSettingsSection } from "@/state/store";
import { AttachmentPreviewDialog } from "../AttachmentPreview";
import { ConfirmDialog } from "../ConfirmDialog";
import { HelpTip, PLAIN_CARD, PLAIN_FIELD, Switch, useSettingsSurface } from "../SettingsPrimitives";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { KIND_ICON, MenuItem, PopoverMenu } from "./FilesSection";
import { inputCls } from "./field";
import { MemoryFolderOptions, type MemoryFolderParts } from "./MemoryFolderOptions";
import { MemoryToggleCard } from "./MemorySection";
import { PaneSection } from "./PaneSection";
import { ProfileRow } from "./ProfileRow";
import { RulesCounter } from "./RulesSection";
import {
  LoadBadge,
  WORKSPACE_DRAG,
  buttonCls,
  downloadEntry,
  entryDetails,
  entryKind,
  iconButtonCls,
  type Creating,
} from "./WorkspaceFilesSection.tsx-parts/helpers";
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
  const {
    advanced, listing, error, open, setOpen, busy, newName, setNewName, creating, setCreating,
    showOptions, setShowOptions, renaming, setRenaming, conflict, setConflict, expanded, selected,
    setSelected, dropTarget, setDropTarget, upload, moving, setMoving, preview, setPreview, pdfUrl, setPdfUrl,
    uploadRef, uploadFolderRef, reload, toggleDir, run, openEntry, save, startCreate, create,
    removing, setRemoving, askDelete, confirmDelete, rename, movePaths, onUpload, onDragOver, onDrop,
    toggleSelect, now, rows, folderChoices, deleteBody,
  } = useWorkspaceFiles({ bot, active, onOpenSection, initial, initialExpanded, memoryEditable });

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

  const list = (
    <ul
      className={cn(
        plain ? "flex flex-col" : "flex flex-col divide-y divide-hairline/40 overflow-clip rounded-xl border-[0.5px] border-border bg-elevated",
        dropTarget === "" && (plain ? "rounded-xl bg-accent/10" : "ring-2 ring-accent/40"),
      )}
      data-files-list=""
    >
      {rows.map((entry) => {
        const depth = entryDepth(entry.path);
        const name = entryName(entry.path);
        const isOpen = open?.path === entry.path;
        const folderOpen = entry.kind === "dir" && expanded.has(entry.path);
        const core = isCoreWorkspaceFile(entry.path) || entry.virtual === "soul";
        const Icon = entry.kind === "dir" ? Folder : KIND_ICON[entryKind(entry)];
        const checked = selected.has(entry.path);
        const nameControl = entry.kind === "dir" ? null : renaming?.path === entry.path ? (
          <input
            autoFocus
            value={renaming.value}
            onChange={(event) => setRenaming({ path: entry.path, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") rename();
              if (event.key === "Escape") setRenaming(null);
            }}
            aria-label={t("persona.files.renameLabel")}
            className={cn(plain ? PLAIN_FIELD : inputCls, "min-w-0 flex-1")}
            data-file-rename-input={entry.path}
          />
        ) : (
          <button
            type="button"
            onClick={() => { void openEntry(entry); }}
            aria-expanded={entry.markdown ? isOpen : undefined}
            className={plain ? "min-w-0 truncate rounded-md text-left text-[14px] leading-5 text-ink hover:text-accent" : "min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline"}
            data-file-open={entry.path}
          >
            {name}
          </button>
        );
        const details = advanced && entry.kind === "file" ? entryDetails(entry, now) : null;
        return (
          <li
            key={entry.path}
            data-file-row={entry.path}
            data-forgotten={entry.forgotten ? "" : undefined}
            data-folder-expanded={entry.kind === "dir" ? (folderOpen ? "true" : "false") : undefined}
            data-core={core ? "" : undefined}
            className={cn(plain ? "px-4 py-1" : "px-3 py-2", dropTarget === entry.path && "bg-accent/10")}
            draggable={!core}
            onDragStart={(event) => {
              if (core) return;
              const paths = selected.has(entry.path) && selected.size > 1 ? [...selected] : [entry.path];
              event.dataTransfer.setData(WORKSPACE_DRAG, JSON.stringify(paths));
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={entry.kind === "dir" ? (event) => onDragOver(event, entry.path) : undefined}
            onDrop={entry.kind === "dir" ? (event) => onDrop(event, entry.path) : undefined}
          >
            <div className={plain ? "flex min-h-[44px] items-center gap-3" : "flex items-center gap-2"} style={{ paddingLeft: depth * 16 }}>
              {!core && (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={t("persona.files.select", { name })}
                  data-file-select={entry.path}
                  className={cn(
                    plain ? "flex size-4 shrink-0 items-center justify-center rounded bg-control text-ink" : "flex size-4 shrink-0 items-center justify-center rounded border border-hairline text-ink",
                    checked && (plain ? "bg-accent text-white" : "border-accent bg-accent text-white"),
                  )}
                  onClick={(event) => toggleSelect(entry.path, event.metaKey || event.ctrlKey || event.shiftKey || true)}
                >
                  {checked ? <Check size={10} aria-hidden="true" /> : null}
                </button>
              )}
              {entry.kind === "dir" ? (
                <button
                  type="button"
                  data-folder-toggle={entry.path}
                  aria-expanded={folderOpen}
                  aria-label={t(folderOpen ? "persona.files.collapse" : "persona.files.expand", { name })}
                  onClick={() => { void toggleDir(entry.path); }}
                  className={plain ? "flex min-w-0 flex-1 items-center gap-3 text-left text-ink" : "flex min-w-0 flex-1 items-center gap-2 text-left text-ink-secondary hover:text-ink"}
                >
                  <ChevronRight size={plain ? 14 : 12} aria-hidden="true" className={cn("shrink-0 transition-transform", plain && "text-ink-secondary", folderOpen && "rotate-90")} />
                  <Icon size={plain ? 20 : 14} aria-hidden="true" className={plain ? "shrink-0 text-ink-secondary" : "shrink-0"} />
                  <span className={plain ? "min-w-0 flex-1 truncate text-[14px] leading-5" : "min-w-0 flex-1 truncate text-[13px]"}>{name}/</span>
                </button>
              ) : (
                <span className={plain ? "w-3.5 shrink-0" : "w-3 shrink-0"} aria-hidden="true" />
              )}
              {entry.kind === "file" && <Icon size={plain ? 20 : 14} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
              {plain ? entry.kind === "file" && (
                <div className="flex min-w-0 flex-1 flex-col">
                  {nameControl}
                  {details && (
                    <span className={cn("truncate text-[12px] leading-4 text-ink-secondary", entry.budget?.over && "text-danger")} data-file-details="">{details}</span>
                  )}
                </div>
              ) : nameControl}
              {entry.forgotten && (
                <span data-forgotten-badge="" title={advanced ? t("persona.files.forgottenDetail", { days: listing?.forgottenAfterDays ?? 30 }) : undefined} className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] leading-4 text-warning">
                  {t("persona.files.forgotten")}
                </span>
              )}
              {entry.kind === "file" && <LoadBadge load={entry.load} detailed={advanced} />}
              <RowMenu
                entry={entry}
                core={core}
                busy={busy}
                onRename={() => setRenaming({ path: entry.path, value: name })}
                onMove={() => setMoving({ paths: [entry.path], anchor: entry.path })}
                onDownload={() => void run(() => downloadEntry(bot.id, entry.path))}
                onDelete={() => void askDelete([entry.path])}
                onUploadInto={() => { uploadFolderRef.current = entry.path; uploadRef.current?.click(); }}
              />
            </div>
            {!plain && details !== null && (
              <div className={cn("mt-0.5 text-[11.5px] text-ink-tertiary", entry.budget?.over && "text-danger")} style={{ paddingLeft: depth * 16 + 42 }} data-file-details="">
                {details}
              </div>
            )}
            {isOpen && open && (
              <div className={plain ? "mb-2 mt-1 flex flex-col gap-2" : "mt-2 flex flex-col gap-2"} data-file-editor={open.path}>
                {open.readOnly && <p className={plain ? "text-[12px] leading-4 text-ink-secondary" : "text-[12px] text-ink-secondary"}>{t("persona.files.readOnly")}</p>}
                <MarkdownEditor
                  ariaLabel={open.path}
                  value={open.text}
                  readOnly={open.readOnly}
                  onChange={(text) => setOpen({ ...open, text, dirty: true })}
                  minHeight={200}
                  dataField={`workspace-file:${open.path}`}
                  footer={open.path === "RULES.md" ? <RulesCounter text={open.text} /> : <span>{open.path}</span>}
                />
                {conflict && (
                  <div role="alert" className={plain ? "rounded-lg bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink" : "rounded-lg border border-warning/25 bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink"}>
                    <div className={plain ? undefined : "font-medium"}>{t("persona.rules.conflict")}</div>
                    <div className="mt-2 flex gap-2">
                      <button type="button" className={buttonCls} disabled={busy} onClick={() => { setOpen({ ...open, text: conflict.current, hash: conflict.currentHash, dirty: false }); setConflict(null); }}>
                        {t("persona.rules.reload")}
                      </button>
                      <button type="button" className={buttonCls} disabled={busy} onClick={() => void save(conflict.currentHash)}>
                        {t("persona.rules.overwrite")}
                      </button>
                    </div>
                  </div>
                )}
                {!open.readOnly && (
                  <div className="flex items-center gap-2">
                    <button type="button" className={buttonCls} disabled={busy || !open.dirty} onClick={() => void save(open.hash)} data-file-save="">
                      {t("persona.rules.save")}
                    </button>
                    <button type="button" className={quietCls} disabled={busy} onClick={() => { setOpen(null); setConflict(null); }}>
                      {t("common.close")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
      {listing && rows.length === 1 && listing.entries.length === 0 && (
        <li className={plain ? "px-4 py-2.5 text-[12px] leading-4 text-ink-secondary" : "px-3 py-2 text-[12.5px] text-ink-secondary"}>{t("persona.files.empty")}</li>
      )}
    </ul>
  );

  const overlays = (
    <>
      {moving && (
        <MovePopover
          folders={folderChoices}
          onPick={(folder) => movePaths(moving.paths, folder)}
          onClose={() => setMoving(null)}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t(removing && removing.paths.length > 1 ? "persona.files.bulkDelete" : "persona.files.delete", { name: removing?.name ?? "" })}
        body={deleteBody()}
        confirmLabel={t("common.delete")}
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={confirmDelete}
      />

      {preview && <AttachmentPreviewDialog image={preview} onClose={() => setPreview(null)} />}
      {pdfUrl && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-6" data-workspace-pdf="" role="dialog" aria-modal="true" aria-label={pdfUrl.name}>
          <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-elevated shadow-2xl">
            <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{pdfUrl.name}</span>
              <a className={buttonCls} href={pdfUrl.url} download={pdfUrl.name}>{t("attach.download")}</a>
              <button type="button" className={buttonCls} onClick={() => { URL.revokeObjectURL(pdfUrl.url); setPdfUrl(null); }}>{t("common.close")}</button>
            </div>
            <iframe title={pdfUrl.name} src={pdfUrl.url} className="min-h-0 flex-1 bg-white" />
          </div>
        </div>
      )}
    </>
  );

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

function RowMenu({
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

function MovePopover({ folders, onPick, onClose }: { folders: string[]; onPick: (folder: string | null) => void; onClose: () => void }) {
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

