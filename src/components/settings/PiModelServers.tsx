// #2983: Settings > Providers > Model servers for pi. The person's own
// OpenAI-compatible servers (oMLX, Ollama, LM Studio on this machine, or a
// remote one): add, test, edit and remove them. Each server's models become
// rows of the model picker when the engine is pi. The server keeps them
// sealed (server/pi-own-model-servers.ts) at /api/me/pi-model-servers; a key
// is write-only, a row says whether one is saved, never its value.
import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Plus, Server } from "lucide-react";

import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ConfirmPill, EditorBox, EditorField, FIELD, HelpTip, InlineFold, PILL, PRIMARY_PILL, SettingsGroup, SettingsIconTile } from "../SettingsPrimitives";
import { SettingsEmpty, StatusText } from "./SettingsPatterns";

export interface PiServerRow {
  id: string;
  name: string;
  url: string;
  configured: boolean;
  models: { id: string; contextWindow?: number }[];
  checkedAt?: string;
  provider: string;
}

type TestAnswer = { ok: true; models: number } | { ok: false; error: string };
type ServerAnswer = { server: PiServerRow; test?: TestAnswer };

const BASE = "/api/me/pi-model-servers";

/** The add or edit form. `server` set: edit (an empty key keeps the saved one). */
function PiServerForm({ server, onDone }: { server?: PiServerRow; onDone: (answer?: ServerAnswer) => void }) {
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [key, setKey] = useState("");
  const [dropKey, setDropKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim() !== "" && url.trim() !== "";
  const submit = () => {
    if (busy || !ready) return;
    const body = server
      ? {
        ...(name.trim() !== server.name ? { name: name.trim() } : {}),
        ...(url.trim() !== server.url ? { url: url.trim() } : {}),
        ...(key.trim() ? { key: key.trim() } : dropKey ? { key: "" } : {}),
      }
      : { name: name.trim(), url: url.trim(), ...(key.trim() ? { key: key.trim() } : {}) };
    if (server && Object.keys(body).length === 0) { onDone(); return; }
    setBusy(true);
    setError(null);
    api<ServerAnswer>(server ? `${BASE}/${encodeURIComponent(server.id)}` : BASE, { method: server ? "PATCH" : "POST", body: JSON.stringify(body) })
      .then((answer) => onDone(answer))
      .catch((e: Error) => { setError(e.message); setBusy(false); });
  };
  return (
    <div className="mx-1.5 my-1">
      <EditorBox label={server ? t("piServers.editTitle", { name: server.name }) : t("piServers.addTitle")} onSubmit={submit} data-pi-server-form={server?.id ?? "new"}
        actions={(
          <>
            <button type="button" onClick={() => onDone()} className={PILL}>{t("common.cancel")}</button>
            <button type="submit" disabled={busy || !ready} className={cn(PRIMARY_PILL, "inline-flex items-center gap-1.5")}>
              {busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
              {server ? t("common.save") : t("piServers.add")}
            </button>
          </>
        )}>
        <EditorField label={t("piServers.name")}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("piServers.namePlaceholder")} maxLength={80} className={FIELD} />
        </EditorField>
        <EditorField label={t("piServers.url")} hint={t("piServers.urlHint")}>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:11434/v1" spellCheck={false} className={cn(FIELD, "font-mono")} />
        </EditorField>
        <EditorField label={t("piServers.key")} hint={server?.configured ? t("piServers.keyKeep") : t("piServers.keyHint")}>
          <input type="password" value={key} onChange={(e) => { setKey(e.target.value); if (e.target.value) setDropKey(false); }} autoComplete="off" placeholder={t("piServers.keyPlaceholder")} className={cn(FIELD, "font-mono")} />
        </EditorField>
        {server?.configured && !key && (
          <label className="flex min-h-[44px] items-center gap-2 px-3 py-1.5 text-[12.5px] text-ink md:min-h-0">
            <input type="checkbox" checked={dropKey} onChange={(e) => setDropKey(e.target.checked)} data-pi-server-drop-key="" />
            {t("piServers.dropKey")}
          </label>
        )}
        {error && <p role="alert" className="px-3 py-1 text-[12px] text-danger">{error}</p>}
      </EditorBox>
    </div>
  );
}

function modelsLine(server: PiServerRow) {
  return server.models.length > 0
    ? <StatusText tone="success">{t("piServers.models", { count: server.models.length })}</StatusText>
    : <StatusText tone="warning">{t("piServers.noModels")}</StatusText>;
}

/** One server: its row, and once open its models, Test, Edit and Remove. */
function PiServerItem({ server, open, onToggle, onEdit, onChanged, onRemoved, note }: {
  server: PiServerRow;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onChanged: (answer: ServerAnswer) => void;
  onRemoved: () => void;
  note?: TestAnswer;
}) {
  const [busy, setBusy] = useState<"test" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const test = () => {
    setBusy("test");
    setError(null);
    api<ServerAnswer>(`${BASE}/${encodeURIComponent(server.id)}/test`, { method: "POST" })
      .then(onChanged)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  const remove = () => {
    setBusy("remove");
    setError(null);
    api(`${BASE}/${encodeURIComponent(server.id)}`, { method: "DELETE" })
      .then(onRemoved)
      .catch((e: Error) => { setError(e.message); setBusy(null); });
  };
  return (
    <li data-pi-server={server.id} data-open={open ? "true" : "false"} className="min-w-0">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="mx-1.5 flex min-h-[44px] w-[calc(100%-12px)] min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none">
        <SettingsIconTile><Server size={14} /></SettingsIconTile>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-[18px] text-ink">{server.name}</span>
          <span className="block truncate text-[12px] leading-4 text-ink-secondary">
            <span className="font-mono" title={server.url}>{server.url}</span> · {modelsLine(server)}
          </span>
        </span>
        <ChevronDown size={13} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex min-w-0 flex-col gap-2 px-3.5 pb-2 sm:pl-[52px]" data-pi-server-detail="">
          {note && (note.ok
            ? <p data-pi-server-test="ok" className="text-[12px]"><StatusText tone="success">{t("piServers.testOk", { count: note.models })}</StatusText></p>
            : <p data-pi-server-test="error" role="alert" className="text-[12px] text-danger">{note.error}</p>)}
          {server.models.length > 0
            ? (
              <ul data-pi-server-models="" className="flex flex-col gap-0.5">
                {server.models.map((model) => <li key={model.id} className="truncate font-mono text-[12px] leading-5 text-ink">{model.id}</li>)}
              </ul>
            )
            : <p className="text-[12px] leading-4 text-ink-secondary">{t("piServers.noModelsHelp")}</p>}
          <p className="text-[12px] leading-4 text-ink-secondary">{server.configured ? t("providerKeys.saved") : t("piServers.noKey")}</p>
          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={test} disabled={busy !== null} data-pi-server-test-run="" className={cn(PILL, "inline-flex items-center gap-1.5")}>
              {busy === "test" && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
              {t("piServers.test")}
            </button>
            <button type="button" onClick={onEdit} disabled={busy !== null} className={PILL}>{t("piServers.edit")}</button>
            <ConfirmPill label={t("piServers.remove")} confirmLabel={t("piServers.removeConfirm")} ariaLabel={`${t("piServers.remove")} · ${server.name}`} onConfirm={remove} disabled={busy !== null} />
          </div>
          <InlineFold label={t("piServers.advanced")}>
            <dl data-pi-server-advanced="" className="flex flex-col gap-1 text-[12px] leading-4">
              <div className="flex flex-wrap gap-x-2"><dt className="text-ink-secondary">{t("piServers.provider")}</dt><dd className="font-mono text-ink">{server.provider}</dd></div>
              {server.checkedAt && <div className="flex flex-wrap gap-x-2"><dt className="text-ink-secondary">{t("piServers.checkedAt")}</dt><dd className="text-ink">{new Date(server.checkedAt).toLocaleString()}</dd></div>}
              {server.models.map((model) => (
                <div key={model.id} className="flex flex-wrap gap-x-2">
                  <dt className="font-mono text-ink-secondary">{model.id}</dt>
                  <dd className="text-ink">{model.contextWindow ? t("piServers.context", { count: model.contextWindow }) : t("piServers.contextDefault")}</dd>
                </div>
              ))}
            </dl>
          </InlineFold>
        </div>
      )}
    </li>
  );
}

/** The card: shown only when this Sagax runs the pi engine. */
export function PiModelServers() {
  const { state, refreshInstances } = useStore();
  const hasPi = state.instances.some((instance) => instance.driverKind === "piAgent");
  const [servers, setServers] = useState<PiServerRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, TestAnswer>>({});

  useEffect(() => {
    if (!hasPi) return;
    let live = true;
    api<{ servers: PiServerRow[] }>(BASE)
      .then((answer) => { if (live) setServers(answer.servers); })
      .catch((e: Error) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [hasPi]);

  if (!hasPi) return null;
  const refresh = () => { void Promise.resolve(refreshInstances()).catch(() => {}); };
  const changed = (answer?: ServerAnswer) => {
    setEditing(null);
    if (!answer) return;
    setServers((list) => {
      const rows = list ?? [];
      return rows.some((row) => row.id === answer.server.id) ? rows.map((row) => (row.id === answer.server.id ? answer.server : row)) : [...rows, answer.server];
    });
    const test = answer.test;
    setNotes((prev) => {
      const next = { ...prev };
      if (test) next[answer.server.id] = test;
      else delete next[answer.server.id];
      return next;
    });
    setOpen(answer.server.id);
    refresh();
  };
  const removed = (id: string) => {
    setServers((list) => (list ?? []).filter((row) => row.id !== id));
    if (open === id) setOpen(null);
    refresh();
  };

  return (
    <div data-settings-card="providers.modelServers">
      <SettingsGroup
        title={t("piServers.title")}
        groupId="providers-model-servers"
        accessory={<HelpTip label={t("settings.moreAbout", { title: t("piServers.title") })}>{t("piServers.help")}</HelpTip>}
      >
        {loadError && <p role="alert" className="mx-3.5 py-1 text-[12px] text-danger">{loadError}</p>}
        {servers === null && !loadError && <p className="mx-3.5 py-2 text-[12px] text-ink-secondary">{t("piServers.loading")}</p>}
        {servers !== null && servers.length === 0 && editing !== "new" && (
          <div data-pi-servers-empty=""><SettingsEmpty icon={Server}>{t("piServers.empty")}</SettingsEmpty></div>
        )}
        {servers !== null && servers.length > 0 && (
          <ul className="flex flex-col" data-pi-servers="">
            {servers.map((server) => editing === server.id
              ? <li key={server.id}><PiServerForm server={server} onDone={changed} /></li>
              : (
                <PiServerItem key={server.id} server={server} open={open === server.id} note={notes[server.id]}
                  onToggle={() => setOpen(open === server.id ? null : server.id)}
                  onEdit={() => setEditing(server.id)} onChanged={changed} onRemoved={() => removed(server.id)} />
              ))}
          </ul>
        )}
        {servers !== null && (editing === "new"
          ? <PiServerForm onDone={changed} />
          : (
            <div className="mx-1.5 mt-1 border-t border-hairline/40 pt-1.5">
              <button type="button" data-pi-server-add="" onClick={() => setEditing("new")} className={cn(PILL, "inline-flex w-full items-center justify-center gap-1.5")}>
                <Plus size={14} aria-hidden="true" className="shrink-0" />
                {t("piServers.addTitle")}
              </button>
            </div>
          ))}
      </SettingsGroup>
    </div>
  );
}
