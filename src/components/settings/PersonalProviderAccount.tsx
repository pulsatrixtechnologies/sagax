import { useState } from "react";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { PROVIDER_ACCOUNTS_PATH, providerAccountsChanged, useProviderAccounts } from "@/lib/provider-accounts";
import type { PersonalProviderServer, ProviderAccountsView } from "../../../shared/provider-accounts";
import { FIELD, PILL, PillSelect } from "../SettingsPrimitives";

/** Secret input is local to this one provider; metadata alone returns. */
export function PersonalProviderKey({ provider, name, onDone }: { provider: string; name: string; onDone?(): void }) {
  const { refreshInstances } = useStore();
  const { view, unavailable, error } = useProviderAccounts();
  const current = view?.keys.find((key) => key.provider === provider);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const change = async (remove: boolean) => {
    setBusy(true); setNote(null);
    try {
      await api<ProviderAccountsView>(`${PROVIDER_ACCOUNTS_PATH}/keys/${encodeURIComponent(provider)}`, {
        method: remove ? "DELETE" : "PUT", ...(remove ? {} : { body: JSON.stringify({ key: value.trim() }) }),
      });
      setValue(""); providerAccountsChanged();
      await Promise.resolve(refreshInstances()).catch(() => {});
      setNote(t(remove ? "voiceKeys.removed" : "voiceKeys.saved"));
      onDone?.();
    } catch (failure) { setNote(failure instanceof Error ? failure.message : t("voiceKeys.error")); }
    finally { setBusy(false); }
  };
  if (unavailable) return <p data-needs-server-update="" className="text-[12px] text-ink-secondary">{unavailable}</p>;
  return <div className="flex min-w-0 flex-col gap-2" data-personal-provider-key={provider}>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-ink-secondary">
      {t("voiceKeys.key", { provider: name })}
      <input className={FIELD} type="password" autoComplete="off" spellCheck={false} value={value} disabled={busy}
        data-personal-provider-key-input={provider} onChange={(event) => setValue(event.target.value)}
        placeholder={t(current ? "voiceKeys.key.replace" : "voiceKeys.key.placeholder")} />
    </label>
    {current && <p className="text-[12px] text-ink-secondary">{current.last4 ? t("voiceKeys.key.savedLast4", { last4: current.last4 }) : t("voiceKeys.key.saved")}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={PILL} disabled={busy || !value.trim()} onClick={() => void change(false)}>{t("voiceKeys.save")}</button>
      {current && <button type="button" className={PILL} disabled={busy} onClick={() => void change(true)}>{t("voiceKeys.remove")}</button>}
    </div>
    {note && <p role="status" className="text-[12px] text-ink-secondary">{note}</p>}
  </div>;
}

export function PersonalProviderServerForm({ server, onDone }: { server?: PersonalProviderServer; onDone(): void }) {
  const { refreshInstances } = useStore();
  const { unavailable } = useProviderAccounts();
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [protocol, setProtocol] = useState<PersonalProviderServer["protocol"]>(server?.protocol ?? "openai");
  const [models, setModels] = useState(server?.models.map((model) => model.id === model.label ? model.id : `${model.id} | ${model.label}`).join("\n") ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instanceId = useState(() => server?.instanceId ?? `server-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`)[0];
  const save = async (remove: boolean) => {
    setBusy(true); setError(null);
    try {
      const path = `${PROVIDER_ACCOUNTS_PATH}/servers/${encodeURIComponent(instanceId)}`;
      const value: PersonalProviderServer = { instanceId, name: name.trim(), url: url.trim(), protocol,
        models: models.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
          const at = line.indexOf("|"); const id = (at < 0 ? line : line.slice(0, at)).trim();
          return { id, label: at < 0 ? id : line.slice(at + 1).trim() || id };
        }) };
      await api(path, { method: remove ? "DELETE" : "PUT", ...(remove ? {} : { body: JSON.stringify(value) }) });
      if (!remove && key.trim()) await api(`${PROVIDER_ACCOUNTS_PATH}/keys/${encodeURIComponent(`compat:${instanceId}`)}`, { method: "PUT", body: JSON.stringify({ key: key.trim() }) });
      setKey(""); providerAccountsChanged(); await Promise.resolve(refreshInstances()).catch(() => {}); onDone();
    } catch (failure) { providerAccountsChanged(); setError(failure instanceof Error ? failure.message : t("voiceKeys.error")); }
    finally { setBusy(false); }
  };
  if (unavailable) return <p data-needs-server-update="" className="text-[12px] text-ink-secondary">{unavailable}</p>;
  return <form className="flex min-w-0 flex-col gap-2" data-personal-provider-server="" onSubmit={(event) => { event.preventDefault(); void save(false); }}>
    <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("compatServers.name")}<input className={FIELD} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
    <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("compatServers.url")}<input type="url" className={FIELD} value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} placeholder="https://api.example.com/v1" /></label>
    <div className="flex flex-col items-start gap-1 text-[12px] text-ink-secondary">{t("providers.server.protocol")}<PillSelect<PersonalProviderServer["protocol"]> value={protocol} onChange={setProtocol} disabled={busy} ariaLabel={t("providers.server.protocol")} options={[{ value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Anthropic" }]} /></div>
    <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("providers.server.models")}<textarea className={FIELD} rows={3} value={models} onChange={(event) => setModels(event.target.value)} disabled={busy} /></label>
    <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("voiceKeys.key", { provider: name || t("providers.add.server") })}<input type="password" autoComplete="off" className={FIELD} value={key} onChange={(event) => setKey(event.target.value)} disabled={busy} /></label>
    <div className="flex flex-wrap gap-2"><button type="submit" className={PILL} disabled={busy || !name.trim() || !url.trim()}>{t("voiceKeys.save")}</button>{server && <button type="button" className={PILL} disabled={busy} onClick={() => void save(true)}>{t("compatServers.remove")}</button>}<button type="button" className={PILL} onClick={onDone}>{t("common.cancel")}</button></div>
    {server && <PersonalProviderKey provider={`compat:${instanceId}`} name={server.name} />}
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
  </form>;
}
