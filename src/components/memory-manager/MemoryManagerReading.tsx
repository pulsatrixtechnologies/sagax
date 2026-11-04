// Reading, create, move, import and preview panes for Tools > Memory.
import type { Dispatch, SetStateAction } from "react";
import { Loader2 } from "lucide-react";
import { t } from "@/lib/i18n";
import type { ImportWriters } from "@/lib/memory-import";
import type { MemoryNoteDetail, MemoryTierRow } from "@/lib/memory-manager";
import type { JournalFacts, PageLink, PageRow, PageTier } from "@/lib/memory-page";
import { MemoryImportDialog, type ImportDestination } from "./MemoryImportDialog";
import { MemoryNoteView, type NoteSave } from "./MemoryNoteView";
import { TEAM_KINDS } from "./memory-manager-helpers";
import { FIELD, PRIMARY_BUTTON } from "./memory-ui";
import type { Target } from "./useMemoryManagerActions";

type Screen =
  | { kind: "list" }
  | { kind: "note"; key: string; edit?: boolean }
  | { kind: "create" }
  | { kind: "move"; keys: string[] };

type View = "notes" | "map" | "tags" | "quality";

export interface MemoryManagerReadingProps {
  view: View;
  screen: Screen;
  preview: { entry: PageRow; detail: MemoryNoteDetail | null } | null;
  note: MemoryNoteDetail | null;
  noteEntry: PageRow | null;
  busy: boolean;
  pins: string[];
  targets: Target[];
  createTarget: string;
  createFolder: string;
  createTitle: string;
  newFolder: boolean;
  createTargetRow: Target | undefined;
  moveScope: string;
  moveTopic: string;
  pxTiers: MemoryTierRow[];
  meTier: MemoryTierRow | undefined;
  importOpen: boolean;
  importDestinations: ImportDestination[];
  importWriters: ImportWriters;
  noteTier: PageTier | undefined;
  noteLinks: { out: PageLink[]; back: PageLink[] };
  previewLinks: { out: PageLink[]; back: PageLink[] };
  factsByBot: Record<string, Map<string, JournalFacts> | undefined>;
  tierByKey: Map<string, PageTier>;
  rowByKey: Map<string, PageRow>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setNote: Dispatch<SetStateAction<MemoryNoteDetail | null>>;
  setPreview: Dispatch<SetStateAction<{ entry: PageRow; detail: MemoryNoteDetail | null } | null>>;
  setCreateTarget: Dispatch<SetStateAction<string>>;
  setCreateFolder: Dispatch<SetStateAction<string>>;
  setCreateTitle: Dispatch<SetStateAction<string>>;
  setMoveScope: Dispatch<SetStateAction<string>>;
  setMoveTopic: Dispatch<SetStateAction<string>>;
  setImportOpen: Dispatch<SetStateAction<boolean>>;
  setMapFocus: Dispatch<SetStateAction<string | null>>;
  setView: Dispatch<SetStateAction<View>>;
  setNotice: Dispatch<SetStateAction<{ text: string; undo?: () => Promise<void> } | null>>;
  togglePin: (key: string) => void;
  saveNote: (next: NoteSave) => Promise<boolean>;
  deleteKeys: (keys: string[]) => Promise<void>;
  startMove: (keys: string[]) => void;
  createNote: () => Promise<void>;
  runMove: () => Promise<void>;
  openNote: (entry: PageRow, edit?: boolean) => Promise<void>;
  openKey: (key: string, edit?: boolean) => void;
  previewKey: (key: string) => void;
  refresh: () => void;
}

export function MemoryManagerReading(props: MemoryManagerReadingProps) {
  const {
    view, screen, preview, note, noteEntry, busy, pins, targets,
    createTarget, createFolder, createTitle, newFolder, createTargetRow,
    moveScope, moveTopic, pxTiers, meTier, importOpen, importDestinations, importWriters,
    noteTier, noteLinks, previewLinks, factsByBot, tierByKey, rowByKey,
    setScreen, setNote, setPreview, setCreateTarget, setCreateFolder, setCreateTitle,
    setMoveScope, setMoveTopic, setImportOpen, setMapFocus, setView, setNotice,
    togglePin, saveNote, deleteKeys, startMove, createNote, runMove, openNote, openKey, previewKey, refresh,
  } = props;

  return (
    <>
        {view === "notes" && screen.kind !== "list" && !preview && (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" data-memory-reading="">

            {screen.kind === "note" && !note && busy && (
              <div className="flex min-h-[160px] items-center justify-center text-ink-secondary"><Loader2 size={18} className="animate-spin" aria-label={t("memoryManager.loading")} /></div>
            )}
            {screen.kind === "note" && note && noteEntry && (
              <MemoryNoteView
                key={`${noteEntry.key}:${screen.edit ? "edit" : "read"}`}
                entry={noteEntry}
                detail={note}
                tier={noteTier}
                facts={noteEntry.source.kind === "bot" && noteEntry.row.path ? factsByBot[noteEntry.source.botId ?? ""]?.get(noteEntry.row.path) : undefined}
                linksOut={noteLinks.out}
                backlinks={noteLinks.back}
                pinned={pins.includes(noteEntry.key)}
                startEditing={screen.edit}
                busy={busy}
                onBack={() => { setScreen({ kind: "list" }); setNote(null); }}
                onPin={() => togglePin(noteEntry.key)}
                onSave={saveNote}
                onDelete={note.mayEdit ? () => void deleteKeys([noteEntry.key]) : undefined}
                onMove={noteEntry.source.kind === "perspicax" && note.mayEdit ? () => startMove([noteEntry.key]) : undefined}
                onNeighbourhood={() => { setMapFocus(noteEntry.key); setView("map"); }}
                onOpenLink={(key) => openKey(key)}
                linkColor={(key) => tierByKey.get(rowByKey.get(key)?.tier ?? "")?.color}
              />
            )}

            {screen.kind === "create" && (
              <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3 rounded-xl border border-hairline/50 bg-panel p-5" data-memory-create-form="">
                <h2 className="text-[20px] font-semibold text-ink">{newFolder ? t("memoryManager.newFolder") : t("memoryManager.newNote")}</h2>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.where")}</span>
                  <select value={createTarget} onChange={(event) => { const next = targets.find((entry) => entry.id === event.target.value); setCreateTarget(event.target.value); setCreateFolder(next?.source.kind === "team" ? "term" : next?.freeFolder ? "notes" : ""); }} className={FIELD} data-memory-create-where="">
                    {targets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                  </select>
                </label>
                {createTargetRow && createTargetRow.source.kind === "team" && (
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.folder")}</span>
                    <select value={createFolder} onChange={(event) => setCreateFolder(event.target.value)} className={FIELD}>
                      {TEAM_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                    </select>
                  </label>
                )}
                {createTargetRow?.freeFolder && (
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.folder")}</span>
                    <input value={createFolder} onChange={(event) => setCreateFolder(event.target.value)} list="memory-create-folders" className={FIELD} data-memory-create-folder="" {...(newFolder ? { "data-initial-focus": "", autoFocus: true } : {})} />
                    <datalist id="memory-create-folders">{createTargetRow.folders.map((folder) => <option key={folder} value={folder} />)}</datalist>
                  </label>
                )}
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.titleField")}</span>
                  <input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createNote(); }} className={FIELD} data-memory-create-title="" {...(newFolder ? {} : { "data-initial-focus": "", autoFocus: true })} />
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" className="inline-flex h-8 items-center rounded-full px-3 text-[12.5px] text-ink hover:bg-hover" onClick={() => setScreen({ kind: "list" })}>{t("common.cancel")}</button>
                  <button type="button" className={PRIMARY_BUTTON} disabled={busy || !createTitle.trim() || (newFolder && !createFolder.trim())} onClick={() => void createNote()} data-memory-create-submit="">
                    {t("memoryManager.create")}
                  </button>
                </div>
              </div>
            )}

            {screen.kind === "move" && (
              <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3 rounded-xl border border-hairline/50 bg-panel p-5" data-memory-move="">
                <h2 className="text-[20px] font-semibold text-ink">{t("memoryManager.moveConfirm")}</h2>
                <p className="text-[13px] text-ink-secondary">{t("memoryManager.moveHint", { count: screen.keys.length })}</p>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.tier")}</span>
                  <select value={moveScope} onChange={(event) => setMoveScope(event.target.value)} className={FIELD} data-memory-move-tier="">
                    {pxTiers.filter((tier) => tier.mayWrite).map((tier) => (
                      <option key={tier.scope} value={tier.scope}>{tier.kind === "me" ? t("memoryManager.tierMine") : tier.kind === "org" ? t("memoryManager.tierOrg") : tier.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-ink-secondary">{t("memoryManager.folder")}</span>
                  <input value={moveTopic} onChange={(event) => setMoveTopic(event.target.value)} list="memory-move-folders" className={FIELD} data-memory-move-folder="" />
                  <datalist id="memory-move-folders">{(pxTiers.find((tier) => tier.scope === moveScope)?.folders ?? []).map((folder) => <option key={folder.id} value={folder.name} />)}</datalist>
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" className="inline-flex h-8 items-center rounded-full px-3 text-[12.5px] text-ink hover:bg-hover" onClick={() => setScreen({ kind: "list" })}>{t("common.cancel")}</button>
                  <button type="button" className={PRIMARY_BUTTON} disabled={busy || !moveTopic.trim()} onClick={() => void runMove()} data-memory-move-submit="">{t("memoryManager.moveConfirm")}</button>
                </div>
              </div>
            )}
          </div>
        )}
        {importOpen && importDestinations.length > 0 && (
          <MemoryImportDialog
            destinations={importDestinations}
            defaultId={importDestinations.find((entry) => entry.target.kind === "perspicax" && entry.target.scope === meTier?.scope)?.id ?? importDestinations[0]!.id}
            writers={importWriters}
            onClose={() => setImportOpen(false)}
            onImported={(count) => { setNotice({ text: t("memoryManager.importedNotice", { count }) }); refresh(); }}
          />
        )}
        {/* A click on a row: the note in the content, in the list's place, left of the rail. */}
        {preview && (view === "notes" || view === "map") && (
          <div role="region" aria-label={preview.entry.row.title} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" data-memory-preview-panel="">
            {preview.detail ? (
              <MemoryNoteView
                key={`preview:${preview.entry.key}`}
                variant="panel"
                entry={preview.entry}
                detail={preview.detail}
                tier={tierByKey.get(preview.entry.tier)}
                facts={preview.entry.source.kind === "bot" && preview.entry.row.path ? factsByBot[preview.entry.source.botId ?? ""]?.get(preview.entry.row.path) : undefined}
                linksOut={previewLinks.out}
                backlinks={previewLinks.back}
                pinned={pins.includes(preview.entry.key)}
                busy={busy}
                onBack={() => setPreview(null)}
                onPin={() => togglePin(preview.entry.key)}
                onSave={async () => false}
                onEditPage={() => void openNote(preview.entry, true)}
                onDelete={preview.detail.mayEdit ? () => { const key = preview.entry.key; setPreview(null); void deleteKeys([key]); } : undefined}
                onMove={preview.entry.source.kind === "perspicax" && preview.detail.mayEdit ? () => { const key = preview.entry.key; setPreview(null); startMove([key]); } : undefined}
                onNeighbourhood={() => { setMapFocus(preview.entry.key); setPreview(null); setView("map"); }}
                onOpenLink={previewKey}
                linkColor={(key) => tierByKey.get(rowByKey.get(key)?.tier ?? "")?.color}
              />
            ) : (
              <div className="flex min-h-[160px] items-center justify-center text-ink-secondary"><Loader2 size={18} className="animate-spin" aria-label={t("memoryManager.loading")} /></div>
            )}
          </div>
        )}
    </>
  );
}
