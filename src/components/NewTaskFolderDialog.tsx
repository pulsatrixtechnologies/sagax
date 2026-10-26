import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, X } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { RemoteFolderField } from "./remote-session/RemoteFolderField";
import { FIELD, FieldRow, PILL, PRIMARY_PILL, DIALOG, GROUP_CARD } from "./SettingsPrimitives";

/** An explicit pin is chosen while creating a thread, never by moving the
 * working directory of a provider session that already exists. */
export function NewTaskFolderDialog({ bot, onClose, onReturnFocus }: { bot: Bot; onClose: () => void; onReturnFocus?: () => void }) {
  const { dispatch } = useStore();
  const [cwd, setCwd] = useState(bot.cwd ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = () => { if (!pending.current) onClose(); };
  useModalDialog(dialog, close);
  // A menu item may disappear before this dialog closes. Its owner supplies
  // a stable fallback after the modal hook restores the original opener.
  const returnFocus = useRef(onReturnFocus);
  returnFocus.current = onReturnFocus;
  useEffect(() => () => { returnFocus.current?.(); }, []);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (saving) dialog.current?.focus();
    else if (error) input.current?.focus();
  }, [saving, error]);

  return createPortal(<div data-thread-overlay className={cn(DIALOG.backdrop, "z-50")}
    onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="new-task-folder-title" aria-busy={saving || undefined}
      className={`${DIALOG.frame} max-w-[440px]`}>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
        event.preventDefault();
        if (!cwd.trim() || pending.current) return;
        pending.current = true;
        setSaving(true);
        setError(null);
        const currentProject = bot.tasks?.find((task) => task.threadId === bot.threadId)?.projectId;
        const projectId = bot.projects?.find((project) => project.id === currentProject)?.id;
        dispatch({ type: "newTask", botId: bot.id, projectId, cwd: cwd.trim(), onCreated: onClose,
          onError: (message) => { pending.current = false; setSaving(false); setError(message); } });
      }}>
        <div className={DIALOG.header}>
          <h2 id="new-task-folder-title" className={`${DIALOG.title} flex items-center gap-2`}><FolderOpen size={16} aria-hidden="true" className="text-ink-secondary" />{t("task.folder.new")}</h2>
          <button type="button" disabled={saving} onClick={close} aria-label={t("common.close")} className={cn(DIALOG.close, "disabled:opacity-40")}><X size={18} className="pointer-events-none" /></button>
        </div>
        <div className={DIALOG.body}>
          <div className={GROUP_CARD}>
            <FieldRow label={t("task.folder.path")} hint={t("task.folder.detail")} hintId="new-task-folder-description">
              <RemoteFolderField botId={bot.id} inputRef={input} value={cwd} disabled={saving} aria-describedby="new-task-folder-description" autoComplete="off" spellCheck={false}
                onChange={(path) => { setCwd(path); setError(null); }} placeholder={t("task.folder.placeholder")}
                inputClassName={`${FIELD} font-mono`} />
            </FieldRow>
          </div>
          {error && <p role="alert" className="px-1 text-[12.5px] text-danger">{error}</p>}
        </div>
        <div className={DIALOG.footer}>
          <button type="button" disabled={saving} onClick={close} className={PILL}>{t("common.cancel")}</button>
          <button type="submit" disabled={saving || !cwd.trim()} className={PRIMARY_PILL}>{t(saving ? "task.folder.creating" : "task.newShort")}</button>
        </div>
      </form>
    </div>
  </div>, document.body);
}
