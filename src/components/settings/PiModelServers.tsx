// #2983: Settings > Providers > Model servers for pi (#4329 lot 1: each
// server is a provider of the list, its page draws PiServerDetail). The person's own
// OpenAI-compatible servers (oMLX, Ollama, LM Studio on this machine, or a
// remote one): add, test, edit and remove them. Each server's models become
// rows of the model picker when the engine is pi. The server keeps them
// sealed (server/pi-own-model-servers.ts) at /api/me/pi-model-servers; a key
// is write-only, a row says whether one is saved, never its value.
import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ConfirmPill, EditorBox, EditorField, FIELD, PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { StatusText } from "./SettingsPatterns";

export interface PiServerRow {
  id: string;
  name: string;
  url: string;
  configured: boolean;
  models: { id: string; contextWindow?: number }[];
  checkedAt?: string;
  provider: string;
}

export type TestAnswer = { ok: true; models: number } | { ok: false; error: string };
export type ServerAnswer = { server: PiServerRow; test?: TestAnswer };

const BASE = "/api/me/pi-model-servers";

/** The add or edit form. `server` set: edit (an empty key keeps the saved one). */
export function PiServerForm({ server, onDone }: { server?: PiServerRow; onDone: (answer?: ServerAnswer) => void }) {
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

/** The servers for pi, loaded where they are drawn (#4329 lot 1: each one is
 * a provider of Settings > Providers, its page holding what its card did).
 * Empty and never loaded unless this Sagax runs the pi engine. */
export function usePiServers() {
  const { state, refreshInstances } = useStore();
  const hasPi = state.instances.some((instance) => instance.driverKind === "piAgent");
  const [servers, setServers] = useState<PiServerRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, TestAnswer>>({});

  useEffect(() => {
    if (!hasPi) return;
    let live = true;
    api<{ servers: PiServerRow[] }>(BASE)
      .then((answer) => { if (live) setServers(answer.servers); })
      .catch((e: Error) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [hasPi]);

  const refresh = () => { void Promise.resolve(refreshInstances()).catch(() => {}); };
  const changed = (answer?: ServerAnswer) => {
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
    refresh();
  };
  const removed = (id: string) => {
    setServers((list) => (list ?? []).filter((row) => row.id !== id));
    refresh();
  };
  return { hasPi, servers: hasPi ? servers : [], loadError: hasPi ? loadError : null, notes, changed, removed };
}

export function piModelsLine(server: PiServerRow): string {
  return server.models.length > 0 ? t("piServers.models", { count: server.models.length }) : t("piServers.noModels");
}

/** Remove a server for pi (its line's button and its page). */
export function removePiServer(id: string): Promise<unknown> {
  return api(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** One server's page (#4329 lot 1): its models, Test, Edit and Remove on
 * the first level; its address, the technical provider name, the last test
 * and the context size per model in Advanced. */
export function PiServerDetail({ server, note, onChanged, onRemoved, advanced, frame = (body) => body }: {
  server: PiServerRow;
  note?: TestAnswer;
  onChanged: (answer?: ServerAnswer) => void;
  onRemoved: () => void;
  /** Where Advanced draws (the page's own fold). */
  advanced: (body: ReactNode) => ReactNode;
  /** The card the first level draws in. */
  frame?: (body: ReactNode) => ReactNode;
}) {
  const [busy, setBusy] = useState<"test" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
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
    removePiServer(server.id)
      .then(onRemoved)
      .catch((e: Error) => { setError(e.message); setBusy(null); });
  };
  if (editing) return <>{frame(<PiServerForm server={server} onDone={(answer) => { setEditing(false); onChanged(answer); }} />)}</>;
  return (
    <>
      {frame(<div className="flex min-w-0 flex-col gap-2 px-3.5 py-2.5" data-pi-server={server.id} data-pi-server-detail="">
        {note && (note.ok
          ? <p data-pi-server-test="ok" className="text-[12px]"><StatusText tone="success">{t("piServers.testOk", { count: note.models })}</StatusText></p>
          : <p data-pi-server-test="error" role="alert" className="text-[12px] text-danger">{note.error}</p>)}
        {server.models.length > 0
          ? (
            <ul data-pi-server-models="" className="flex flex-col gap-0.5">
              {server.models.map((model) => <li key={model.id} className="truncate text-[12px] leading-5 text-ink">{model.id}</li>)}
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
          <button type="button" onClick={() => setEditing(true)} disabled={busy !== null} className={PILL}>{t("piServers.edit")}</button>
          <ConfirmPill label={t("piServers.remove")} confirmLabel={t("piServers.removeConfirm")} ariaLabel={`${t("piServers.remove")} · ${server.name}`} onConfirm={remove} disabled={busy !== null} />
        </div>
      </div>)}
      {advanced(
        <dl data-pi-server-advanced="" className="flex flex-col gap-1 text-[12px] leading-4">
          <div className="flex flex-wrap gap-x-2"><dt className="text-ink-secondary">{t("piServers.url")}</dt><dd className="break-all font-mono text-ink">{server.url}</dd></div>
          <div className="flex flex-wrap gap-x-2"><dt className="text-ink-secondary">{t("piServers.provider")}</dt><dd className="font-mono text-ink">{server.provider}</dd></div>
          {server.checkedAt && <div className="flex flex-wrap gap-x-2"><dt className="text-ink-secondary">{t("piServers.checkedAt")}</dt><dd className="text-ink">{new Date(server.checkedAt).toLocaleString()}</dd></div>}
          {server.models.map((model) => (
            <div key={model.id} className="flex flex-wrap gap-x-2">
              <dt className="font-mono text-ink-secondary">{model.id}</dt>
              <dd className="text-ink">{model.contextWindow ? t("piServers.context", { count: model.contextWindow }) : t("piServers.contextDefault")}</dd>
            </div>
          ))}
        </dl>,
      )}
    </>
  );
}
