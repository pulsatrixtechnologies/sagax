import { Check, ChevronRight, Folder } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { entryDepth, entryName, isCoreWorkspaceFile } from "@/lib/workspace-files";
import { MarkdownEditor } from "../../markdown/MarkdownEditor";
import { PLAIN_FIELD } from "../../SettingsPrimitives";
import { KIND_ICON } from "../FilesSection";
import { inputCls } from "../field";
import { RulesCounter } from "../RulesSection";
import { LoadBadge, WORKSPACE_DRAG, buttonCls, downloadEntry, entryDetails, entryKind } from "./helpers";
import { RowMenu } from "./menus";
import type { useWorkspaceFiles } from "./useWorkspaceFiles";

type Files = ReturnType<typeof useWorkspaceFiles>;

export function WorkspaceFileList({ files, plain, quietCls, botId }: { files: Files; plain: boolean; quietCls: string; botId: string }) {
  const {
    advanced, listing, open, setOpen, busy, renaming, setRenaming, conflict, setConflict, expanded, selected,
    dropTarget, setMoving, uploadRef, uploadFolderRef, toggleDir, run, openEntry, save, askDelete, rename,
    onDragOver, onDrop, toggleSelect, now, rows,
  } = files;
  return (
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
                onDownload={() => void run(() => downloadEntry(botId, entry.path))}
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
}
