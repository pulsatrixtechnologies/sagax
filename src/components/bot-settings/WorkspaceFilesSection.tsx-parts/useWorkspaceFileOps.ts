import type { ChangeEvent, DragEvent, Dispatch, MutableRefObject, SetStateAction } from "react";

import { discardConfirmRequest, type ConfirmFn } from "@/components/ConfirmProvider";
import { fetchMemoryDoc, formatMemoryBytes, saveMemoryDoc, topicFileName } from "@/lib/memory";
import {
  countWorkspaceFiles,
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspaceEntry,
  entryName,
  entryParent,
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
} from "@/lib/workspace-files";
import { t } from "@/lib/i18n";
import type { Bot, BotSettingsSection } from "@/state/store";
import type { PreviewImage } from "../../AttachmentPreview";
import { topicTemplate } from "../MemorySection";
import {
  EMPTY_HASH,
  WORKSPACE_DRAG,
  downloadEntry,
  isImageEntry,
  isPdfEntry,
  safeFileName,
  type Creating,
  type Open,
  type UploadState,
} from "./helpers";

export function useWorkspaceFileOps(args: {
  bot: Bot;
  listing: WorkspaceListing | null;
  open: Open | null;
  setOpen: Dispatch<SetStateAction<Open | null>>;
  setConflict: Dispatch<SetStateAction<{ current: string; currentHash: string } | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  newName: string;
  setNewName: Dispatch<SetStateAction<string>>;
  creating: Creating;
  setCreating: Dispatch<SetStateAction<Creating>>;
  createParent: string | null;
  setCreateParent: Dispatch<SetStateAction<string | null>>;
  renaming: { path: string; value: string } | null;
  setRenaming: Dispatch<SetStateAction<{ path: string; value: string } | null>>;
  removing: { paths: string[]; name: string; count?: number } | null;
  setRemoving: Dispatch<SetStateAction<{ paths: string[]; name: string; count?: number } | null>>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  setMoving: Dispatch<SetStateAction<{ paths: string[]; anchor: string } | null>>;
  setUpload: Dispatch<SetStateAction<UploadState | null>>;
  setDropTarget: Dispatch<SetStateAction<string | null>>;
  setPreview: Dispatch<SetStateAction<PreviewImage | null>>;
  setPdfUrl: Dispatch<SetStateAction<{ name: string; url: string } | null>>;
  uploadFolderRef: MutableRefObject<string | null>;
  maxUpload: number;
  confirm: ConfirmFn;
  run: (work: () => Promise<unknown>) => Promise<void>;
  reload: () => Promise<void> | void;
  reveal: (path: string) => void;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  onOpenSection: (target: BotSettingsSection) => void;
  editableHere: (entry: WorkspaceEntry) => boolean;
}) {
  const {
    bot, listing, open, setOpen, setConflict, setError,
    newName, setNewName, creating, setCreating, createParent, setCreateParent,
    renaming, setRenaming, removing, setRemoving, setSelected, setMoving, setUpload,
    setDropTarget, setPreview, setPdfUrl, uploadFolderRef, maxUpload, confirm, run,
    reload, reveal, setExpanded, onOpenSection, editableHere,
  } = args;

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


  return {
    openEntry, save, startCreate, create, askDelete, confirmDelete, rename,
    movePaths, uploadFiles, onUpload, onDragOver, onDrop, toggleSelect,
  };
}
