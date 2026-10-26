// Settings > Computer > Local models. Both switches start off. Only the
// signed-in person can change their own list. Other people never edit it.
import { useEffect, useState } from "react";
import { Eye, EyeOff, Key, Server, Trash2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { loadLocalModels, localModelKeyBridge, normalizeLoopbackBase, saveLocalModels, type LocalModelSettings } from "@/lib/desktop-local-models";
import { cn } from "@/lib/cn";
import { DescribedRow, FIELD, FoldRow, PILL, SettingsGroup, SettingsTextRow, Switch, cardCount } from "../SettingsPrimitives";

type Endpoint = LocalModelSettings["endpoints"][number];

/** The name shown for a loopback server: its label, else host:port. */
export function endpointName(endpoint: Endpoint): string {
  if (endpoint.label) return endpoint.label;
  try { return new URL(endpoint.baseUrl).host; } catch { return endpoint.baseUrl; }
}

/**
 * The last probe outcome shown under one loopback server, so the owner can
 * tell a listed server ("N models") from one that is running but empty,
 * reachable but asking for an API key, or not responding at all. A server
 * that has not been probed yet (an older desktop, or none connected) shows
 * nothing. Only "N models" servers also reach the model picker.
 */
export function endpointStatus(
  endpoint: Endpoint,
  published: LocalModelSettings["published"],
  probes: LocalModelSettings["probes"],
): { tone: "ok" | "muted" | "warn"; text: string } | null {
  const models = published.find((row) => row.id === endpoint.id)?.models.length ?? 0;
  if (models > 0) return { tone: "ok", text: cardCount("models", models) };
  const status = probes.find((row) => row.id === endpoint.id)?.status;
  if (!status) return null;
  if (status === "needs_key") return { tone: "warn", text: t("localModels.probe.needsKey") };
  if (status === "empty") return { tone: "muted", text: t("localModels.probe.empty") };
  if (status === "offline") return { tone: "muted", text: t("localModels.probe.offline") };
  return null;
}

/** The one-line summary of the folded list: "8 local servers · DwarfStar, Ollama, …". */
export function endpointsSummary(endpoints: Endpoint[]): string {
  const count = cardCount("servers", endpoints.length);
  if (endpoints.length === 0) return count;
  const names = endpoints.slice(0, 3).map(endpointName).join(", ");
  return `${count} · ${names}${endpoints.length > 3 ? ", …" : ""}`;
}

/**
 * The per-endpoint API key editor, shown only on this person's own desktop
 * app (where window.ogb.localModels exists). The key is kept encrypted on
 * this computer and never crosses back over the bridge: this control only
 * ever learns whether a key is set, and sends a new one or clears it. A key
 * is optional: anonymous servers (Ollama, LM Studio) need none; a server that
 * reads "needs an API key" becomes selectable once a valid key is set.
 */
export function EndpointKeyEditor({ endpoint, hasKey, onChange }: { endpoint: Endpoint; hasKey: boolean; onChange: () => void }) {
  const bridge = localModelKeyBridge();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!bridge) return null;

  const close = () => { setEditing(false); setDraft(""); setReveal(false); };

  const commit = () => {
    const key = draft.trim();
    if (!key || busy) return;
    setBusy(true);
    void bridge.setKey(endpoint.baseUrl, key).then(() => { close(); onChange(); }).finally(() => setBusy(false));
  };

  const remove = () => {
    if (busy) return;
    setBusy(true);
    void bridge.clearKey(endpoint.baseUrl).then(() => { close(); onChange(); }).finally(() => setBusy(false));
  };

  const paste = () => {
    void navigator.clipboard?.readText?.().then((value) => { if (typeof value === "string") setDraft(value.trim()); }).catch(() => {});
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2 pl-[26px]" data-loopback-key={hasKey ? "set" : "none"}>
        <Key size={12} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-ink-secondary">
          {hasKey ? t("localModels.key.saved") : t("localModels.key.none")}
        </span>
        <button type="button" className="shrink-0 text-[12px] leading-4 text-accent hover:underline" onClick={() => setEditing(true)}>
          {hasKey ? t("localModels.key.change") : t("localModels.key.add")}
        </button>
        {hasKey && (
          <button type="button" disabled={busy} className="shrink-0 text-[12px] leading-4 text-ink-secondary hover:text-danger disabled:opacity-50" onClick={remove}>
            {t("localModels.key.remove")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 pl-[26px]" data-loopback-key-editing="true">
      <div className="flex items-center gap-2">
        <input value={draft} type={reveal ? "text" : "password"} autoComplete="off" spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") close(); }}
          placeholder={t("localModels.key.placeholder")} aria-label={t("localModels.key.placeholder")}
          className={cn(FIELD, "flex-1 font-mono text-[12px]")} />
        <button type="button" aria-label={reveal ? t("localModels.key.hide") : t("localModels.key.show")}
          title={reveal ? t("localModels.key.hide") : t("localModels.key.show")}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control" onClick={() => setReveal((value) => !value)}>
          {reveal ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || !draft.trim()} className={cn(PILL, "shrink-0")} onClick={commit}>{t("localModels.key.save")}</button>
        <button type="button" className="shrink-0 text-[12px] leading-4 text-accent hover:underline" onClick={paste}>{t("localModels.key.paste")}</button>
        <button type="button" className="shrink-0 text-[12px] leading-4 text-ink-secondary hover:underline" onClick={close}>{t("localModels.key.cancel")}</button>
      </div>
      <p className="text-[12px] leading-4 text-ink-secondary">{t("localModels.key.help")}</p>
    </div>
  );
}

const OFF: LocalModelSettings = { expose: false, share: false, endpoints: [], published: [], probes: [], connected: false };

export function LocalModelsSettings() {
  const [settings, setSettings] = useState<LocalModelSettings>(OFF);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState(false);
  // The loopback bases that have an API key on THIS computer. Only the list of
  // bases crosses the bridge, never a key value.
  const [keyedBases, setKeyedBases] = useState<string[]>([]);

  const refreshKeyBases = () => {
    const bridge = localModelKeyBridge();
    if (!bridge) return;
    void bridge.keyBases().then((bases) => setKeyedBases(Array.isArray(bases) ? bases : [])).catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    void loadLocalModels().then((value) => {
      if (cancelled || !value) return;
      setSettings(value);
      setLoaded(true);
    }).catch(() => { if (!cancelled) setError(true); });
    const bridge = localModelKeyBridge();
    if (bridge) void bridge.keyBases().then((bases) => { if (!cancelled) setKeyedBases(Array.isArray(bases) ? bases : []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const save = (patch: { expose?: boolean; share?: boolean; endpoints?: LocalModelSettings["endpoints"] }) => {
    setError(false);
    void saveLocalModels(patch).then((value) => {
      setSettings(value);
      setLoaded(true);
    }).catch(() => setError(true));
  };

  const add = () => {
    if (!loaded) return;
    const baseUrl = normalizeLoopbackBase(draft.trim());
    if (!baseUrl) { setInvalid(true); return; }
    setInvalid(false);
    setDraft("");
    save({ endpoints: [...settings.endpoints.filter((row) => row.baseUrl !== baseUrl), { id: "", label: "", baseUrl }] });
  };

  // 2026-10-18 (JC): a group of rows, as the other pages draw them
  // (SettingsPrimitives); the loopback servers fold under their row.
  return (
    <div data-settings-card="computer.localModels" data-local-models={settings.expose ? "on" : "off"} data-local-models-share={settings.share ? "on" : "off"}>
      <SettingsGroup title={t("localModels.title")} groupId="localModels">
        <SettingsTextRow>{t("localModels.help")}</SettingsTextRow>
        <DescribedRow label={t("localModels.expose")} description={t("localModels.exposeHelp")} rowId="localModels.expose">
          <Switch checked={settings.expose} aria-label={t("localModels.expose")} onClick={() => save({ expose: !settings.expose })} />
        </DescribedRow>
        <DescribedRow label={t("localModels.share")} description={t("localModels.shareHelp")} rowId="localModels.share">
          <Switch checked={settings.share} aria-label={t("localModels.share")} onClick={() => save({ share: !settings.share })} />
        </DescribedRow>
        <FoldRow cardId="computer.localModels.endpoints" label={t("localModels.endpoints")}
          description={loaded ? endpointsSummary(settings.endpoints) : undefined} count={loaded ? settings.endpoints.length : undefined}>
          <div className="flex flex-col gap-2" data-loopback-servers={settings.endpoints.length}>
            <p className="text-[12px] leading-4 text-ink-secondary">{t("localModels.endpointsHelp")} {t("localModels.suggestions")}</p>
            {loaded && settings.endpoints.length > 0 && (
              <ul className="flex flex-col">
                {settings.endpoints.map((endpoint) => {
                  const name = endpointName(endpoint);
                  const status = settings.expose && settings.connected ? endpointStatus(endpoint, settings.published, settings.probes) : null;
                  return (
                    <li key={endpoint.id || endpoint.baseUrl} className="group flex flex-col gap-1 py-1" data-loopback-server={endpoint.baseUrl} data-loopback-status={status?.tone ?? ""}>
                      <div className="flex min-h-[44px] items-center gap-3">
                        <Server size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] leading-[18px] text-ink">{name}</span>
                          <span className="block truncate font-mono text-[12px] leading-4 text-ink-secondary">{endpoint.baseUrl}</span>
                        </span>
                        {status && (
                          <span className={cn("shrink-0 text-[12px] leading-4", status.tone === "ok" ? "text-success" : status.tone === "warn" ? "text-warning" : "text-ink-secondary")}>
                            {status.text}
                          </span>
                        )}
                        <button type="button"
                          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-secondary opacity-0 transition-opacity hover:bg-control hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 motion-reduce:transition-none md:size-7"
                          aria-label={t("localModels.remove", { label: name })} title={t("localModels.remove", { label: name })}
                          onClick={() => save({ endpoints: settings.endpoints.filter((row) => row.baseUrl !== endpoint.baseUrl) })}>
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                      <EndpointKeyEditor endpoint={endpoint} hasKey={keyedBases.includes(normalizeLoopbackBase(endpoint.baseUrl) ?? endpoint.baseUrl)} onChange={refreshKeyBases} />
                    </li>
                  );
                })}
              </ul>
            )}
            <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); add(); }}>
              <input value={draft} onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
                placeholder={t("localModels.placeholder")} aria-label={t("localModels.endpoints")}
                className={cn(FIELD, "flex-1 font-mono text-[12px]")} />
              <button type="submit" disabled={!loaded} className={cn(PILL, "shrink-0")}>{t("localModels.add")}</button>
            </form>
            {invalid && <p role="alert" className="text-[12px] text-danger">{t("localModels.invalid")}</p>}
          </div>
        </FoldRow>
        {loaded && settings.expose && !settings.connected && <SettingsTextRow live>{t("localModels.offline")}</SettingsTextRow>}
        {loaded && settings.expose && settings.connected && settings.published.length === 0 && <SettingsTextRow live>{t("localModels.none")}</SettingsTextRow>}
        {error && <SettingsTextRow tone="danger">{t("localModels.error")}</SettingsTextRow>}
      </SettingsGroup>
    </div>
  );
}
