import { useEffect, useRef, useState } from "react";
import { Check, Cloud, Laptop, Loader2, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmProvider";
import { Card, DANGER_PILL, DescribedRow, EditorBox, EditorField, FIELD, PILL, PRIMARY_PILL, SwitchRow } from "./SettingsPrimitives";
import { t } from "@/lib/i18n";
import { ComputerSharingSettings } from "./ComputerSharingSettings";
import { useStore } from "@/state/store";
import { sharedComputersEnabled } from "@/lib/feature-flags";

type SavedWorkspaces = Awaited<ReturnType<NonNullable<NonNullable<Window["ogb"]>["environments"]>["state"]>>;

/** These are this desktop's connections, not a fleet administration API. */
export function ConnectedWorkspacesSettings() {
  const confirm = useConfirm();
  const bridge = window.ogb?.environments;
  // Computer sharing is off unless this workspace's server turned it on. The
  // desktop bridge alone is not enough: never offer access the server refuses.
  const { state } = useStore();
  const sharingOffered = sharedComputersEnabled(state.config) && Boolean(window.ogb?.computerSharing);
  const [saved, setSaved] = useState<SavedWorkspaces | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [computerId, setComputerId] = useState<string | null>(() => new URLSearchParams(window.location?.search ?? "").get("share-computer"));
  // Local environments (named data dirs, packaged builds only): the create
  // form's fields, the pending Forget, and its keep-or-delete-files choice.
  const [envName, setEnvName] = useState("");
  const [envDir, setEnvDir] = useState("");
  const [envForget, setEnvForget] = useState<string | null>(null);
  const [envPurge, setEnvPurge] = useState(false);
  const [envError, setEnvError] = useState("");
  // Server mode locks this app to one organization server (docs/code/apps.md
  // "Launch flow"): no local environment is offered or switched to then.
  const [serverModeActive, setServerModeActive] = useState(false);
  useEffect(() => {
    let live = true;
    // Personal's page beside the server (`personal`) is still in server mode.
    void window.ogb?.serverMode?.state().then((mode) => { if (live) setServerModeActive(mode.active || ("personal" in mode && mode.personal === true)); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const pending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    void bridge?.state().then((state) => { if (generation.current === current) setSaved(state); })
      .catch(() => { if (generation.current === current) setError(t("settings.servers.loadError")); });
    return () => { generation.current++; };
  }, [bridge]);
  useEffect(() => {
    const consume = (id?: string | null) => {
      if (id) setComputerId(id);
      const url = new URL(window.location.href);
      url.searchParams.delete("share-computer");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    };
    consume();
    return bridge?.onOpenSettings?.(consume);
  }, [bridge]);
  const perform = async (action: () => Promise<unknown>, fail: (message: string) => void = setError) => {
    if (pending.current || !bridge) return;
    pending.current = true; setBusy(true); setError(""); setEnvError("");
    const current = generation.current;
    try {
      // A successful switch/connect unloads this local renderer. Do not ask
      // for its privileged saved list again after the active origin changes.
      if (await action() === true) return;
      const state = await bridge.state();
      if (generation.current === current) setSaved(state);
    } catch (nextError) {
      if (generation.current === current) fail(String((nextError as Error)?.message ?? nextError)
        .replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ""));
    } finally {
      pending.current = false;
      if (generation.current === current) setBusy(false);
    }
  };
  if (!bridge) return <p className="text-[13px] text-ink-secondary">{t("settings.servers.desktopOnly")}</p>;
  const connected = saved?.environments.find(entry => entry.id === computerId);
  const computerWorkspace = connected?.origin ? { id: connected.id, name: connected.name, origin: connected.origin } : undefined;
  const locals = saved?.environments.filter(entry => entry.kind === "local") ?? [];
  const forgetEntry = locals.find(entry => entry.id === envForget);
  return <>
    {saved?.packaged && !serverModeActive && <Card title={t("envLocal.title")} subtitle={t("envLocal.subtitle")}>
      {envError && <p role="alert" className="text-[12px] text-danger">{envError}</p>}
      {locals.length > 0 && <ul className="divide-y divide-hairline/40">
        {locals.map((entry) => {
          const active = entry.id === saved.activeId;
          return <li key={entry.id} className="flex items-center gap-3 py-3">
            <Laptop size={18} className="shrink-0 text-ink-secondary" />
            <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-ink">{entry.name}</div>
              <div className="break-all text-[12px] text-ink-secondary">{entry.dataDir}
                {entry.missing && <span className="ml-2 rounded-md bg-inset px-1.5 py-0.5 text-[11px]">{t("envLocal.missing")}</span>}</div></div>
            {active ? <span className="flex shrink-0 items-center gap-1 text-[12px] text-ink-secondary"><Check size={13} />{t("settings.servers.current")}</span> :
              <button type="button" disabled={busy} aria-label={t("envLocal.switchTo", { name: entry.name })}
                onClick={() => void perform(async () => {
                  if (!(await confirm({
                    title: t("envLocal.switchConfirm", { name: entry.name }),
                    confirmLabel: t("settings.servers.switch"),
                    tone: "neutral",
                  }))) return;
                  // Main's error strings are an open set ("dev", "busy", …):
                  // one generic sentence for all of them.
                  const result = await bridge.switch(entry.id);
                  if (result && result.ok === false) throw new Error(t("envLocal.switchFailed"));
                  return true;
                }, setEnvError)}
                className={PILL}>{t("settings.servers.switch")}</button>}
            {!active && <button type="button" disabled={busy} aria-label={t("envLocal.forgetName", { name: entry.name })} title={t("envLocal.forgetName", { name: entry.name })}
              onClick={() => { setEnvForget(entry.id); setEnvPurge(false); }}
              className="rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"><Trash2 size={14} /></button>}
          </li>;
        })}
      </ul>}
      {forgetEntry && <EditorBox label={t("envLocal.forgetName", { name: forgetEntry.name })} className="mt-3" actions={<>
        <button type="button" onClick={() => setEnvForget(null)} className={PILL}>{t("common.cancel")}</button>
        <button type="button" disabled={busy} onClick={() => void perform(async () => {
          // Main answers {ok:false} when it refuses or the folder delete fails;
          // the entry stays, so say so generically and leave the panel open.
          const result = envPurge ? await bridge.forget(forgetEntry.id, true) : await bridge.forget(forgetEntry.id);
          if (result && result.ok === false) throw new Error(t("envLocal.forgetFailed"));
          setEnvForget(null);
        }, setEnvError)} className={`${DANGER_PILL} min-h-[44px] md:min-h-0`}>{t("settings.servers.forgetShort")}</button>
      </>}>
        <SwitchRow className="px-3 py-1.5" label={t("envLocal.purge")}
          description={<><span className="break-all">{forgetEntry.dataDir}</span>. {t("envLocal.purgeHelp")}</>}
          checked={envPurge} disabled={busy} onChange={setEnvPurge} />
      </EditorBox>}
      <EditorBox label={t("envLocal.new")} className="mt-4" onSubmit={() => {
        if (!envName.trim()) return;
        void perform(async () => {
          // A failure carries main's reason; none of them is a sentence the
          // person can act on, so the form says one generic thing.
          const created = await bridge.create(envName.trim(), envDir.trim() || undefined);
          if (!created?.ok) throw new Error("Couldn't create the environment.");
          setEnvName(""); setEnvDir("");
        }, setEnvError);
      }} actions={
        <button type="submit" disabled={busy || !envName.trim()} className={`${PRIMARY_PILL} inline-flex items-center gap-1.5`}>
          {busy && <Loader2 size={13} className="animate-spin" />}{t("envLocal.create")}
        </button>
      }>
        <p className="px-3 py-1.5 text-[13px] leading-[18px] text-ink">{t("envLocal.new")}</p>
        <EditorField label={t("botPanel.identity.name")}>
          <input required value={envName} disabled={busy} maxLength={60} onChange={(event) => setEnvName(event.target.value)} placeholder={t("envLocal.namePlaceholder")} aria-label={t("botPanel.identity.name")} className={FIELD} />
        </EditorField>
        <EditorField label={t("envLocal.dataFolder")} hint={t("envLocal.dataFolderHint")}>
          <span className="flex min-w-0 flex-1 gap-2">
            <input value={envDir} disabled={busy} onChange={(event) => setEnvDir(event.target.value)} aria-label={t("envLocal.dataFolder")} className={FIELD} />
            <button type="button" disabled={busy} onClick={() => void perform(async () => {
              const picked = await bridge.pickDir();
              if (picked?.ok && picked.path) setEnvDir(picked.path);
            }, setEnvError)} className={`${PILL} shrink-0`}>{t("botPanel.access.choose")}</button>
          </span>
        </EditorField>
      </EditorBox>
    </Card>}
    {/* 0.5.6: one Grok-style row per server (name, address in grey,
        Switch and Forget at the right) under the page's Servers heading. */}
    <div data-settings-card="organization.servers" className="flex flex-col rounded-xl border-[0.5px] border-border bg-elevated py-1.5">
      {!saved ? (
        <DescribedRow label={t("settings.servers.title")} rowId="servers"
          description={<span role="status">{error ? t("settings.servers.couldNot") : t("settings.servers.loading")}</span>} />
      ) : [{ id: "local", name: t("settings.thisComputer.title"), origin: "" }, ...saved.environments.filter((entry) => entry.kind !== "local")].map((entry) => {
        const active = entry.id === saved.activeId;
        const Icon = entry.id === "local" ? Laptop : Cloud;
        return (
          <DescribedRow key={entry.id} rowId={`server:${entry.id}`} label={entry.name} icon={<Icon size={14} />}
            description={<span className="break-all">{entry.origin || t("settings.thisComputer.local")}</span>}>
            {active ? <span className="flex items-center gap-1 px-2.5 text-[13px] text-ink-secondary"><Check size={13} aria-hidden="true" />{t("settings.servers.current")}</span> :
              <button type="button" disabled={busy} aria-label={t("settings.servers.switchTo", { name: entry.name })} onClick={() => void perform(async () => { await bridge.switch(entry.id); return true; })}
                className={PILL}>{t("settings.servers.switch")}</button>}
            {entry.id !== "local" && sharingOffered && <button type="button" disabled={busy} aria-label={t("settings.servers.accessFor", { name: entry.name })} onClick={() => setComputerId(entry.id)} className={PILL}>{t("settings.servers.access")}</button>}
            {entry.id !== "local" && <button type="button" disabled={busy} aria-label={t("settings.servers.forget", { name: entry.name })}
              onClick={() => void perform(async () => {
                if (!(await confirm({
                  title: t("settings.servers.forgetConfirm", { name: entry.name }),
                  confirmLabel: t("settings.servers.forgetShort"),
                  tone: "danger",
                }))) return;
                return bridge.forget(entry.id);
              })} className={`${DANGER_PILL} min-h-[44px] md:min-h-0`}>{t("settings.servers.forgetShort")}</button>}
          </DescribedRow>
        );
      })}
    </div>
    {sharingOffered && computerWorkspace && <ComputerSharingSettings key={computerWorkspace.id} workspace={computerWorkspace} onClose={() => setComputerId(null)} />}
  </>;
}
