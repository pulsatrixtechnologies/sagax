import { useEffect, useRef, useState } from "react";

import { discardConfirmRequest, useConfirm } from "@/components/ConfirmProvider";
import { useAdvancedMode } from "@/lib/interface-mode";
import { t } from "@/lib/i18n";
import {
  entryAncestors,
  entryVisible,
  fetchWorkspace,
  isRulesOrDoc,
  type WorkspaceEntry,
  type WorkspaceListing,
} from "@/lib/workspace-files";
import type { Bot, BotSettingsSection } from "@/state/store";
import type { PreviewImage } from "../../AttachmentPreview";
import { errorText, type Creating, type Open, type UploadState } from "./helpers";
import { useWorkspaceFileOps } from "./useWorkspaceFileOps";

export function useWorkspaceFiles({
  bot,
  active,
  onOpenSection,
  initial,
  initialExpanded,
  memoryEditable = false,
}: {
  bot: Bot;
  active: boolean;
  memoryEditable?: boolean;
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
  const [removing, setRemoving] = useState<{ paths: string[]; name: string; count?: number } | null>(null);
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

  const ops = useWorkspaceFileOps({
    bot, listing, open, setOpen, setConflict, setError,
    newName, setNewName, creating, setCreating, createParent, setCreateParent,
    renaming, setRenaming, removing, setRemoving, setSelected, setMoving, setUpload,
    setDropTarget, setPreview, setPdfUrl, uploadFolderRef, maxUpload, confirm, run,
    reload, reveal, setExpanded, onOpenSection, editableHere,
  });

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

  return {
    advanced,
    listing,
    error,
    open,
    setOpen,
    busy,
    newName,
    setNewName,
    creating,
    setCreating,
    showOptions,
    setShowOptions,
    renaming,
    setRenaming,
    conflict,
    setConflict,
    expanded,
    selected,
    setSelected,
    dropTarget,
    setDropTarget,
    upload,
    moving,
    setMoving,
    preview,
    setPreview,
    pdfUrl,
    setPdfUrl,
    uploadRef,
    uploadFolderRef,
    reload,
    toggleDir,
    run,
    openEntry: ops.openEntry,
    save: ops.save,
    startCreate: ops.startCreate,
    create: ops.create,
    removing,
    setRemoving,
    askDelete: ops.askDelete,
    confirmDelete: ops.confirmDelete,
    rename: ops.rename,
    movePaths: ops.movePaths,
    onUpload: ops.onUpload,
    onDragOver: ops.onDragOver,
    onDrop: ops.onDrop,
    toggleSelect: ops.toggleSelect,
    now,
    rows,
    folderChoices,
    deleteBody,
    memoryEditable,
    bot,
  };
}
