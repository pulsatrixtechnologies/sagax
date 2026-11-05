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
  Check, ChevronRight, Download, File as FileIcon, FilePlus, Folder, FolderInput,
  MoreHorizontal, Pencil, Trash2, Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { discardConfirmRequest, useConfirm } from "@/components/ConfirmProvider";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { classifyFile, type FileKind } from "@/lib/chat-files";
import { fetchMemoryDoc, formatMemoryBytes, relativeTime, saveMemoryDoc, topicFileName } from "@/lib/memory";
import {
  countWorkspaceFiles,
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspaceEntry,
  entryAncestors,
  entryDepth,
  entryName,
  entryParent,
  entryVisible,
  fetchWorkspace,
  fetchWorkspaceDoc,
  isCoreWorkspaceFile,
  isRulesOrDoc,
  joinWorkspacePath,
  renameWorkspaceEntry,
  saveWorkspaceDoc,
  uploadWorkspaceFile,
  workspaceDownloadUrl,
  type WorkspaceEntry,
  type WorkspaceListing,
  type WorkspaceLoad,
} from "@/lib/workspace-files";
import type { LocaleKey } from "@/locales";
import type { Bot, BotSettingsSection } from "@/state/store";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { ConfirmDialog } from "../ConfirmDialog";
import { HelpTip, PILL } from "../SettingsPrimitives";
import { inputCls } from "./field";
import { RulesCounter } from "./RulesSection";
import { MemoryToggleCard, topicTemplate } from "./MemorySection";
import { MemoryFolderOptions } from "./MemoryFolderOptions";
import { readableError } from "@/lib/plain-error";
import { AnchoredPopover } from "@/components/AnchoredPopover";
import { KIND_ICON, MenuItem, PopoverMenu } from "./FilesSection";
import { AttachmentPreviewDialog, type PreviewImage } from "../AttachmentPreview";

const buttonCls = PILL;
const iconButtonCls = "rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50";
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const WORKSPACE_DRAG = "application/x-sagax-workspace-paths";

const LOAD_LABEL: Record<WorkspaceLoad, LocaleKey> = {
  "every-turn": "persona.files.load.everyTurn",
  "on-demand": "persona.files.load.onDemand",
  never: "persona.files.load.never",
};
const LOAD_DETAIL: Record<WorkspaceLoad, LocaleKey> = {
  "every-turn": "persona.files.load.everyTurnDetail",
  "on-demand": "persona.files.load.onDemandDetail",
  never: "persona.files.load.neverDetail",
};
const LOAD_TONE: Record<WorkspaceLoad, string> = {
  "every-turn": "bg-accent/15 text-ink",
  "on-demand": "bg-raised text-ink-secondary",
  never: "bg-transparent text-ink-tertiary border border-hairline/40",
};

interface Open {
  path: string;
  text: string;
  hash: string;
  dirty: boolean;
  readOnly: boolean;
}

type Creating = "file" | "folder" | "topic" | null;

interface UploadState {
  name: string;
  percent: number;
}

const errorText = (reason: unknown) => readableError(reason);

export function LoadBadge({ load, detailed }: { load: WorkspaceLoad; detailed: boolean }) {
  return (
    <span
      data-load-badge={load}
      title={detailed ? t(LOAD_DETAIL[load]) : undefined}
      className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4", LOAD_TONE[load])}
    >
      {t(LOAD_LABEL[load])}
    </span>
  );
}

function budgetText(entry: WorkspaceEntry): string | null {
  const budget = entry.budget;
  if (!budget) return null;
  return budget.maxLines
    ? t("persona.files.budgetLines", { lines: budget.lines, maxLines: budget.maxLines, bytes: formatMemoryBytes(budget.bytes), maxBytes: formatMemoryBytes(budget.maxBytes) })
    : t("persona.files.budgetBytes", { bytes: formatMemoryBytes(budget.bytes), maxBytes: formatMemoryBytes(budget.maxBytes) });
}

/** One row's details line (Advanced only): size or budget, dates, last use. */
export function entryDetails(entry: WorkspaceEntry, now: number): string {
  const parts = [budgetText(entry) ?? formatMemoryBytes(entry.bytes)];
  if (entry.createdAt) parts.push(t("persona.files.created", { when: relativeTime(entry.createdAt, now) }));
  if (entry.modifiedAt) parts.push(t("persona.files.modified", { when: relativeTime(entry.modifiedAt, now) }));
  parts.push(entry.lastUsedAt ? t("persona.files.lastUsed", { when: relativeTime(entry.lastUsedAt, now) }) : t("persona.files.neverUsed"));
  return parts.join(" · ");
}

function entryKind(entry: WorkspaceEntry): FileKind {
  return classifyFile({ name: entryName(entry.path) });
}

function isImageEntry(entry: WorkspaceEntry): boolean {
  return entry.kind === "file" && entryKind(entry) === "image";
}

function isPdfEntry(entry: WorkspaceEntry): boolean {
  return entry.kind === "file" && /\.pdf$/i.test(entry.path);
}

async function downloadEntry(botId: string, path: string): Promise<void> {
  const response = await fetch(workspaceDownloadUrl(botId, path));
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? t("attach.downloadFailed"));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = entryName(path);
  link.style.display = "none";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function safeFileName(name: string): string | null {
  const stem = name.trim().replace(/[\\/]/g, "-").replace(/^\.+/, "");
  if (!stem || stem.length > 190) return null;
  return stem;
}

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
  const confirm = useConfirm();
  const advanced = useAdvancedMode();
  const [listing, setListing] = useState<WorkspaceListing | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState<Creating>(null);
  const [createParent, setCreateParent] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const [conflict, setConflict] = useState<{ current: string; currentHash: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [moving, setMoving] = useState<{ paths: string[]; anchor: string } | null>(null);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const [pdfUrl, setPdfUrl] = useState<{ name: string; url: string } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadFolderRef = useRef<string | null>(null);

  const reload = () =>
    fetchWorkspace(bot.id).then(
      (next) => {
        setListing(next);
        setError(null);
      },
      (reason: unknown) => setError(errorText(reason)),
    );

  useEffect(() => {
    setExpanded(new Set(initialExpanded));
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);

  useEffect(() => {
    if (!active) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bot.id]);

  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl.url);
  }, [pdfUrl]);

  const reveal = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      for (const ancestor of entryAncestors(path)) next.add(ancestor);
      return next;
    });
  };

  const toggleDir = async (path: string) => {
    const closing = expanded.has(path);
    const hidesOpen = Boolean(open && (open.path === path || open.path.startsWith(`${path}/`)));
    if (closing && hidesOpen && open?.dirty && !(await confirm(discardConfirmRequest(t("persona.files.dropDraft"))))) return;
    if (closing && hidesOpen && open?.dirty) {
      setOpen(null);
      setConflict(null);
    }
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const editableHere = (entry: WorkspaceEntry) => entry.editable && (isRulesOrDoc(entry.path) || memoryEditable);
  const maxUpload = listing?.uploadMaxBytes ?? 250 * 1024 * 1024;

  const openEntry = async (entry: WorkspaceEntry) => {
    if (entry.virtual === "soul") return onOpenSection("soul");
    if (open?.dirty && !(await confirm(discardConfirmRequest(t("persona.files.dropDraft"))))) return;
    setConflict(null);
    if (open?.path === entry.path) return setOpen(null);
    reveal(entry.path);
    if (isImageEntry(entry)) {
      const url = workspaceDownloadUrl(bot.id, entry.path);
      setPreview({ src: url, name: entryName(entry.path), downloadUrl: url, downloadName: entryName(entry.path) });
      return;
    }
    if (isPdfEntry(entry)) {
      void run(async () => {
        const response = await fetch(workspaceDownloadUrl(bot.id, entry.path));
        if (!response.ok) throw new Error(t("persona.files.readFailed"));
        const blob = await response.blob();
        const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setPdfUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return { name: entryName(entry.path), url };
        });
      });
      return;
    }
    void run(async () => {
      if (editableHere(entry)) {
        const doc = isRulesOrDoc(entry.path) ? await fetchWorkspaceDoc(bot.id, entry.path) : await fetchMemoryDoc(bot.id, entry.path);
        setOpen({ path: entry.path, text: doc.text, hash: doc.hash, dirty: false, readOnly: false });
        return;
      }
      if (!entry.markdown) {
        await downloadEntry(bot.id, entry.path);
        return;
      }
      const response = await fetch(workspaceDownloadUrl(bot.id, entry.path));
      if (!response.ok) throw new Error(t("persona.files.readFailed"));
      setOpen({ path: entry.path, text: await response.text(), hash: "", dirty: false, readOnly: true });
    });
  };

  const save = (expectedHash: string) =>
    run(async () => {
      if (!open) return;
      const result = isRulesOrDoc(open.path)
        ? await saveWorkspaceDoc(bot.id, open.path, open.text, expectedHash)
        : await saveMemoryDoc(bot.id, open.path, open.text, expectedHash);
      if (!result.ok) {
        setConflict({ current: result.current, currentHash: result.currentHash });
        return;
      }
      setConflict(null);
      setOpen({ ...open, text: result.doc.text, hash: result.doc.hash, dirty: false });
      await reload();
    });

  const startCreate = (kind: Creating, parent: string | null = null) => {
    setCreating(kind);
    setCreateParent(parent);
    setNewName("");
  };

  const create = () => {
    const name = safeFileName(newName);
    if (!name || !creating) return;
    if (creating === "topic") {
      void run(async () => {
        const file = topicFileName(newName);
        if (!file) throw new Error(t("botPanel.memory.badTopic"));
        const path = `memory/${file}`;
        const result = await saveMemoryDoc(bot.id, path, topicTemplate(file), EMPTY_HASH);
        if (!result.ok) throw new Error(t("persona.files.exists", { path }));
        setNewName("");
        setCreating(null);
        await reload();
        reveal(path);
        setOpen({ path, text: result.doc.text, hash: result.doc.hash, dirty: false, readOnly: false });
      });
      return;
    }
    const path = joinWorkspacePath(createParent, name);
    void run(async () => {
      if (creating === "folder") {
        await createWorkspaceFolder(bot.id, path);
        setCreating(null);
        setNewName("");
        await reload();
        reveal(path);
        setExpanded((current) => new Set(current).add(path));
        return;
      }
      const text = /\.md$/i.test(name) ? `# ${name.replace(/\.md$/i, "")}\n` : "";
      await createWorkspaceFile(bot.id, path, text);
      setCreating(null);
      setNewName("");
      await reload();
      reveal(path);
      if (/\.md$/i.test(path) && (isRulesOrDoc(path) || path.startsWith("memory/"))) {
        const doc = isRulesOrDoc(path) ? await fetchWorkspaceDoc(bot.id, path) : await fetchMemoryDoc(bot.id, path);
        setOpen({ path, text: doc.text, hash: doc.hash, dirty: false, readOnly: false });
      }
    });
  };

  const [removing, setRemoving] = useState<{ paths: string[]; name: string; count?: number } | null>(null);

  const askDelete = async (paths: string[]) => {
    const usable = paths.filter((path) => !isCoreWorkspaceFile(path) && path !== "SOUL.md");
    if (!usable.length) {
      setError(t("persona.files.coreLocked"));
      return;
    }
    let count: number | undefined;
    if (usable.length === 1) {
      const path = usable[0]!;
      const entry = listing?.entries.find((row) => row.path === path);
      if (entry?.kind === "dir") {
        try {
          count = (await countWorkspaceFiles(bot.id, path)).count;
        } catch {
          count = 0;
        }
      }
    }
    setRemoving({ paths: usable, name: usable.length === 1 ? entryName(usable[0]!) : "", count });
  };

  const confirmDelete = () => {
    const target = removing;
    setRemoving(null);
    if (!target) return;
    void run(async () => {
      for (const path of target.paths) {
        await deleteWorkspaceEntry(bot.id, path, { recursive: true });
        if (open?.path === path || open?.path.startsWith(`${path}/`)) setOpen(null);
      }
      setSelected(new Set());
      await reload();
    });
  };

  const rename = () => {
    if (!renaming) return;
    if (isCoreWorkspaceFile(renaming.path)) {
      setError(t("persona.files.renameRefused"));
      setRenaming(null);
      return;
    }
    const name = safeFileName(renaming.value);
    if (!name) {
      setError(t("persona.files.badName"));
      return;
    }
    const parent = entryParent(renaming.path);
    const target = joinWorkspacePath(parent, name);
    void run(async () => {
      await renameWorkspaceEntry(bot.id, renaming.path, target);
      if (open?.path === renaming.path) setOpen({ ...open, path: target });
      setRenaming(null);
      await reload();
    });
  };

  const movePaths = (paths: string[], destFolder: string | null) => {
    const usable = paths.filter((path) => !isCoreWorkspaceFile(path));
    if (!usable.length) {
      setError(t("persona.files.coreLocked"));
      return;
    }
    void run(async () => {
      for (const path of usable) {
        const name = entryName(path);
        const to = joinWorkspacePath(destFolder, name);
        if (to === path || to.startsWith(`${path}/`)) continue;
        await renameWorkspaceEntry(bot.id, path, to);
        if (open?.path === path) setOpen({ ...open, path: to });
      }
      setSelected(new Set());
      setMoving(null);
      await reload();
      if (destFolder) reveal(destFolder);
    });
  };

  const uploadFiles = (files: FileList | File[], destFolder: string | null) => {
    const list = [...files];
    if (!list.length) return;
    void run(async () => {
      for (const file of list) {
        if (file.size > maxUpload) {
          setError(t("persona.files.tooLarge", { max: formatMemoryBytes(maxUpload) }));
          continue;
        }
        const name = safeFileName(file.name);
        if (!name) {
          setError(t("persona.files.badName"));
          continue;
        }
        const path = joinWorkspacePath(destFolder, name);
        setUpload({ name, percent: 0 });
        try {
          await uploadWorkspaceFile(bot.id, path, file, {
            onProgress: (uploaded, total) => setUpload({ name, percent: total ? Math.round((uploaded / total) * 100) : 0 }),
          });
        } catch (reason) {
          setError(t("persona.files.uploadFailed", { name }));
          throw reason;
        } finally {
          setUpload(null);
        }
        reveal(path);
      }
      await reload();
    });
  };

  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    const dest = uploadFolderRef.current;
    event.target.value = "";
    uploadFolderRef.current = null;
    if (files?.length) uploadFiles(files, dest);
  };

  const onDragOver = (event: DragEvent, folder: string | null) => {
    if (![...event.dataTransfer.types].some((type) => type === "Files" || type === WORKSPACE_DRAG)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes(WORKSPACE_DRAG) ? "move" : "copy";
    setDropTarget(folder ?? "");
  };

  const onDrop = (event: DragEvent, folder: string | null) => {
    event.preventDefault();
    setDropTarget(null);
    const raw = event.dataTransfer.getData(WORKSPACE_DRAG);
    if (raw) {
      try {
        const paths = JSON.parse(raw) as string[];
        if (Array.isArray(paths) && paths.length) movePaths(paths, folder);
      } catch {
        /* ignore */
      }
      return;
    }
    if (event.dataTransfer.files?.length) uploadFiles(event.dataTransfer.files, folder);
  };

  const toggleSelect = (path: string, additive: boolean) => {
    if (isCoreWorkspaceFile(path)) return;
    setSelected((current) => {
      const next = additive ? new Set(current) : new Set<string>();
      if (current.has(path) && additive) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const now = listing?.now ?? Date.now();
  const listedDirs = new Set((listing?.entries ?? []).filter((entry) => entry.kind === "dir").map((entry) => entry.path));
  const rows = listing ? [listing.soul, ...listing.entries].filter((entry) => entryVisible(entry.path, expanded, listedDirs)) : [];
  const folderChoices = (listing?.entries ?? []).filter((entry) => entry.kind === "dir").map((entry) => entry.path);

  const deleteBody = () => {
    if (!removing) return "";
    if (removing.paths.length > 1) return t("persona.files.confirmDeleteMany", { count: removing.paths.length });
    if (removing.count !== undefined && removing.count > 0) {
      return t("persona.files.confirmDeleteFolder", { name: removing.name, count: removing.count });
    }
    return t("persona.files.confirmDelete", { path: removing.paths[0] ?? removing.name });
  };

  return (
    <div
      className="flex flex-col gap-3"
      data-workspace-files=""
      onDragOver={(event) => onDragOver(event, null)}
      onDragLeave={() => setDropTarget(null)}
      onDrop={(event) => onDrop(event, null)}
    >
      {memory && <MemoryToggleCard enabled={memory.enabled} busy={memory.busy} onToggle={memory.onToggle} />}
      <div className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
        <span>{t("persona.files.short")}</span>
        <HelpTip label={t("settings.moreAbout", { title: t("botSettings.nav.files") })}>
          <span className="block">{t("persona.files.intro")}</span>
          {advanced && listing && <span className="mt-2 block break-all font-mono" data-workspace-path="">{listing.workspacePath}</span>}
        </HelpTip>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
            className={cn(iconButtonCls, "ml-auto p-1.5")}
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
      </div>

      {creating && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border-[0.5px] border-border bg-elevated p-2" data-files-create={creating}>
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
            className={cn(inputCls, "min-w-0 max-w-[240px] flex-1")}
            data-files-new-name=""
          />
          <button type="button" className={buttonCls} disabled={busy || !newName.trim()} onClick={create} data-files-new="">
            {t("persona.files.create")}
          </button>
          <button type="button" className="rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink" onClick={() => setCreating(null)}>
            {t("common.cancel")}
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border-[0.5px] border-border bg-elevated px-3 py-2" data-files-bulk="">
          <span className="text-[12.5px] text-ink-secondary">{t("persona.files.selected", { count: selected.size })}</span>
          <button type="button" className={buttonCls} disabled={busy} onClick={() => setMoving({ paths: [...selected], anchor: "bulk" })} data-files-bulk-move="">
            <FolderInput size={14} aria-hidden="true" className="mr-1 inline" />
            {t("persona.files.bulkMove")}
          </button>
          <button type="button" className={cn(buttonCls, "text-danger")} disabled={busy} onClick={() => void askDelete([...selected])} data-files-bulk-delete="">
            <Trash2 size={14} aria-hidden="true" className="mr-1 inline" />
            {t("persona.files.bulkDelete")}
          </button>
          <button type="button" className="rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control" onClick={() => setSelected(new Set())}>
            {t("common.cancel")}
          </button>
        </div>
      )}

      {upload && (
        <p className="text-[12.5px] text-ink-secondary" data-files-upload-progress="">
          {t("persona.files.uploadProgress", { name: upload.name, percent: upload.percent })}
        </p>
      )}

      {memoryEditable && <MemoryFolderOptions bot={bot} active={active} showOptions={showOptions} onChanged={() => void reload()} />}

      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      {listing === null && !error && <p className="text-[12.5px] text-ink-secondary">{t("persona.files.loading")}</p>}
      {listing?.truncated && <p className="text-[12.5px] text-ink-secondary">{t("persona.files.truncated")}</p>}

      <ul
        className={cn(
          "flex flex-col divide-y divide-hairline/40 overflow-clip rounded-xl border-[0.5px] border-border bg-elevated",
          dropTarget === "" && "ring-2 ring-accent/40",
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
          return (
            <li
              key={entry.path}
              data-file-row={entry.path}
              data-forgotten={entry.forgotten ? "" : undefined}
              data-folder-expanded={entry.kind === "dir" ? (folderOpen ? "true" : "false") : undefined}
              data-core={core ? "" : undefined}
              className={cn("px-3 py-2", dropTarget === entry.path && "bg-accent/10")}
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
              <div className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
                {!core && (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={t("persona.files.select", { name })}
                    data-file-select={entry.path}
                    className={cn("flex size-4 shrink-0 items-center justify-center rounded border border-hairline text-ink", checked && "border-accent bg-accent text-white")}
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
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-ink-secondary hover:text-ink"
                  >
                    <ChevronRight size={12} aria-hidden="true" className={cn("shrink-0 transition-transform", folderOpen && "rotate-90")} />
                    <Icon size={14} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{name}/</span>
                  </button>
                ) : (
                  <span className="w-3 shrink-0" aria-hidden="true" />
                )}
                {entry.kind === "file" && <Icon size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
                {entry.kind === "dir" ? null : renaming?.path === entry.path ? (
                  <input
                    autoFocus
                    value={renaming.value}
                    onChange={(event) => setRenaming({ path: entry.path, value: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") rename();
                      if (event.key === "Escape") setRenaming(null);
                    }}
                    aria-label={t("persona.files.renameLabel")}
                    className={cn(inputCls, "min-w-0 flex-1")}
                    data-file-rename-input={entry.path}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { void openEntry(entry); }}
                    aria-expanded={entry.markdown ? isOpen : undefined}
                    className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline"
                    data-file-open={entry.path}
                  >
                    {name}
                  </button>
                )}
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
              {advanced && entry.kind === "file" && (
                <div className={cn("mt-0.5 text-[11.5px] text-ink-tertiary", entry.budget?.over && "text-danger")} style={{ paddingLeft: depth * 16 + 42 }} data-file-details="">
                  {entryDetails(entry, now)}
                </div>
              )}
              {isOpen && open && (
                <div className="mt-2 flex flex-col gap-2" data-file-editor={open.path}>
                  {open.readOnly && <p className="text-[12px] text-ink-secondary">{t("persona.files.readOnly")}</p>}
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
                    <div role="alert" className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-[12.5px] leading-relaxed text-ink">
                      <div className="font-medium">{t("persona.rules.conflict")}</div>
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
                      <button type="button" className="rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink" disabled={busy} onClick={() => { setOpen(null); setConflict(null); }}>
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
          <li className="px-3 py-2 text-[12.5px] text-ink-secondary">{t("persona.files.empty")}</li>
        )}
      </ul>

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

