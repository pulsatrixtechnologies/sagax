import { useEffect, useRef, useState, type RefObject } from "react";
import { FolderOpen } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { AnchoredPopover, useAnchoredDismissRoot } from "./AnchoredPopover";
import { RemoteFolderField } from "./remote-session/RemoteFolderField";
import { FIELD, PILL, PRIMARY_PILL } from "./SettingsPrimitives";

/** An explicit pin is chosen while creating a thread, never by moving the
 * working directory of a provider session that already exists.
 * 2026-11-01 lot 7: anchored popover (one path field + folder picker). */
export function NewTaskFolderDialog({ bot, anchorRef, onClose, onReturnFocus }: {
  bot: Bot;
  /** The control that opened this (sidebar New in folder). */
  anchorRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  onReturnFocus?: () => void;
}) {
  const { dispatch } = useStore();
  const solo = usePerspicaxOrg() === null;
  const [cwd, setCwd] = useState(bot.cwd ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const fallbackAnchor = useRef<HTMLDivElement>(null);
  const resolvedAnchor = anchorRef ?? fallbackAnchor;
  const popoverRef = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const triggerRoot = useRef<HTMLElement | null>(null);
  triggerRoot.current = resolvedAnchor.current;
  const dismissRoot = useAnchoredDismissRoot(triggerRoot, popoverRef);
  const close = () => { if (!pending.current) onClose(); };
  usePopoverDismiss(!saving, dismissRoot, close);
  const returnFocus = useRef(onReturnFocus);
  returnFocus.current = onReturnFocus;
  useEffect(() => () => { returnFocus.current?.(); }, []);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (saving) popoverRef.current?.focus();
    else if (error) input.current?.focus();
  }, [saving, error]);

  return (
    <>
      {!anchorRef && <div ref={fallbackAnchor} className="pointer-events-none fixed left-4 top-24 size-0" aria-hidden="true" />}
      <AnchoredPopover
        anchorRef={resolvedAnchor}
        popoverRef={popoverRef}
        side="bottom"
        align="start"
        role="dialog"
        tabIndex={-1}
        aria-labelledby="new-task-folder-title"
        aria-busy={saving || undefined}
        data-new-task-folder=""
        className="w-[min(400px,calc(100vw-24px))] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-4 text-ink shadow-xl outline-none"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || pending.current) return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
      >
        <form className="flex flex-col gap-3" onSubmit={(event) => {
          event.preventDefault();
          if (!cwd.trim() || pending.current) return;
          pending.current = true;
          setSaving(true);
          setError(null);
          const currentProject = bot.tasks?.find((task) => task.threadId === bot.threadId)?.projectId;
          const projectId = bot.projects?.find((project) => project.id === currentProject)?.id;
          dispatch({
            type: "newTask", botId: bot.id, projectId, cwd: cwd.trim(), onCreated: onClose,
            onError: (message) => { pending.current = false; setSaving(false); setError(message); },
          });
        }}>
          <h2 id="new-task-folder-title" className="flex items-center gap-2 text-[14px] font-medium">
            <FolderOpen size={16} aria-hidden="true" className="text-ink-secondary" />{t("task.folder.new")}
          </h2>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-secondary">{t("task.folder.path")}</span>
            <span id="new-task-folder-description" className="text-[11px] leading-relaxed text-ink-secondary">{t("task.folder.detail")}</span>
            <RemoteFolderField botId={bot.id} solo={solo} inputRef={input} value={cwd} disabled={saving} aria-describedby="new-task-folder-description" autoComplete="off" spellCheck={false}
              onChange={(path) => { setCwd(path); setError(null); }} placeholder={t("task.folder.placeholder")}
              inputClassName={`${FIELD} font-mono`} />
          </label>
          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={close} className={PILL}>{t("common.cancel")}</button>
            <button type="submit" disabled={saving || !cwd.trim()} className={PRIMARY_PILL}>{t(saving ? "task.folder.creating" : "task.newShort")}</button>
          </div>
        </form>
      </AnchoredPopover>
    </>
  );
}
