import { useEffect, useRef, useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { Card, PILL, PRIMARY_PILL, PillSelect, Switch } from "./SettingsPrimitives";
import { t } from "@/lib/i18n";
import { LendingActivityList } from "./LendingActivity";

type ExecutionAccess = "always" | "ask" | "never";

/** Paired workspace computer access through the desktop bridge (#4856):
 * always/ask/never for execution, linked folders as a distinct read setting. */
export function ComputerSharingSettings({ workspace, onClose }: { workspace: { id: string; name: string; origin: string }; onClose: () => void }) {
  const bridge = window.ogb?.computerSharing;
  const [state, setState] = useState<DesktopComputerSharing | null>(null);
  const [folders, setFolders] = useState<DesktopSharedFolder[]>([]);
  const [access, setAccess] = useState<ExecutionAccess>("ask");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<DesktopLendingActivity[] | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const apply = (next: DesktopComputerSharing) => {
    setState(next);
    setFolders(next.folders);
    const nextAccess = (next as DesktopComputerSharing & { access?: ExecutionAccess }).access;
    setAccess(nextAccess === "always" || nextAccess === "never" || nextAccess === "ask" ? nextAccess : next.enabled ? "always" : "never");
  };
  useEffect(() => {
    mounted.current = true;
    panel.current?.scrollIntoView({ block: "start" });
    void bridge?.state(workspace.id).then(next => { if (mounted.current) apply(next); })
      .catch(() => { if (mounted.current) setError(t("settings.share.loadFail")); });
    const refresh = () => {
      void bridge?.state(workspace.id).then(next => { if (mounted.current) setState(next); }).catch(() => {});
      void bridge?.activity?.(workspace.id).then(next => { if (mounted.current) setActivity(next); }).catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [bridge, workspace.id]);
  const perform = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await action(); }
    catch (failure) { if (mounted.current) setError(String((failure as Error)?.message ?? failure).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, "")); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  if (!bridge) return null;
  return <div ref={panel}><Card
    collapsible
    cardId={`organization.computerAccess.${workspace.id}`}
    title={t("settings.share.title", { name: workspace.name })}
    subtitle={workspace.origin}
    summary={!state ? t("common.checking") : access === "never" ? t("settings.card.notShared") : state.connected ? t("settings.card.sharing") : t("settings.card.waiting")}
  >
    <div className="flex flex-col gap-4 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <p role="status" className="text-ink-secondary">{!state ? t("settings.share.loading") : access === "never" ? t("settings.share.notShared") : state.connected ? t("settings.share.sharing") : t("settings.share.waiting")}</p>
        <button type="button" aria-label={t("settings.share.close")} onClick={onClose} className="rounded p-1 text-ink-secondary hover:bg-control"><X size={16} /></button>
      </div>
      <p className="text-ink-secondary">{t("settings.share.bridgeIntro")}</p>
      <fieldset disabled={busy || !state} className="flex flex-col gap-3 disabled:opacity-50">
        <legend className="mb-2 font-medium text-ink">{t("botWorkplace.execution")}</legend>
        <PillSelect value={access} disabled={busy || !state} ariaLabel={t("botWorkplace.execution")}
          options={[
            { value: "always", label: t("myDevices.access.always") },
            { value: "ask", label: t("myDevices.access.ask") },
            { value: "never", label: t("myDevices.access.never") },
          ]}
          onChange={(value) => setAccess(value as ExecutionAccess)} />
        <p className="text-[12px] text-ink-secondary">{t("botWorkplace.executionHint")}</p>
      </fieldset>
      <fieldset disabled={busy || !state || access === "never"} className="flex flex-col gap-3 border-t border-hairline/40 pt-3 disabled:opacity-50">
        <legend className="mb-2 font-medium text-ink">{t("settings.share.folders")}</legend>
        <p className="text-[12px] text-ink-secondary">{t("settings.share.foldersReadHint")}</p>
        {folders.length === 0 && <p className="text-[12px] text-ink-secondary">{t("settings.share.noFolders")}</p>}
        {folders.map(folder => <div key={folder.id} className="flex flex-wrap items-center gap-3 py-1">
          <div className="min-w-0 flex-1"><p className="font-medium text-ink">{folder.name}</p><p className="break-all text-[12px] text-ink-secondary">{folder.path}</p></div>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-secondary">{t("settings.share.edits")}<Switch checked={folder.write} onClick={() => setFolders(current => current.map(entry => entry.id === folder.id ? { ...entry, write: !entry.write } : entry))} /></label>
          <button type="button" aria-label={t("settings.share.removeFolder", { name: folder.name })} onClick={() => setFolders(current => current.filter(entry => entry.id !== folder.id))} className="rounded p-1 text-ink-secondary hover:bg-control"><X size={14} /></button>
        </div>)}
        <button type="button" disabled={folders.length >= 20} onClick={() => void perform(async () => {
          const folder = await bridge.chooseFolder();
          if (mounted.current && folder) setFolders(current => current.some(entry => entry.path === folder.path) ? current : [...current, folder]);
        })} className={`${PILL} inline-flex w-fit items-center gap-1.5`}><FolderPlus size={13} />{t("settings.share.choose")}</button>
      </fieldset>
      {(error || state?.error) && <p role="alert" className="text-[12px] text-danger">{error || state?.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !state} onClick={() => void perform(async () => {
          const next = await bridge.save(workspace.id, { folders, access, terminal: access === "always", computer: false });
          if (mounted.current && next) apply(next);
        })} className={PRIMARY_PILL}>{access === "never" ? t("settings.share.save") : state?.enabled ? t("settings.share.save") : t("settings.share.share")}</button>
        {state?.enabled && access !== "never" && <button type="button" disabled={busy} onClick={() => void perform(async () => {
          const next = await bridge.revoke(workspace.id); if (mounted.current) apply(next);
        })} className={`${PILL} text-danger`}>{t("settings.share.stop")}</button>}
      </div>
      {state?.enabled && access !== "never" && <p className="text-[12px] text-ink-secondary">{t("settings.share.stopHelp")}</p>}
      <div className="border-t border-hairline/40 pt-3"><LendingActivityList entries={activity} /></div>
    </div>
  </Card></div>;
}
