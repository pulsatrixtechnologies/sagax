// Settings > Models and voice > Web search (2026-10-26): the person's own
// search provider and key, for the engines that have no web search of their
// own (local models, OpenAI-compatible endpoints...). The person's setting,
// no admin right, also on an organization server. The key is sent once and
// never comes back: the row shows only that one is saved and its last four
// characters (server/routes/web-search.ts).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableErrorMessage } from "@/lib/readable-error";
import { loadWebSearch, removeWebSearch, saveWebSearch, testWebSearch } from "@/lib/web-search";
import { api } from "@/state/store";
import { WEB_SEARCH_PROVIDERS, WEB_SEARCH_PROVIDER_INFO, type WebSearchProviderId, type WebSearchSettingsView } from "../../../shared/web-search";
import { DescribedRow, FIELD, FieldRow, PILL, PillSelect, SettingsGroup } from "../SettingsPrimitives";

type Choice = WebSearchProviderId | "";

/** `bare` (2026-11-05): the rows alone, inside Providers > Other services. */
export function WebSearchSettings({ bare = false }: { bare?: boolean } = {}) {
  const [view, setView] = useState<WebSearchSettingsView | null>(null);
  const [hidden, setHidden] = useState(false);
  const [provider, setProvider] = useState<Choice>("");
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  const apply = useCallback((next: WebSearchSettingsView) => {
    setView(next);
    setProvider(next.provider ?? "");
    setBaseUrl(next.baseUrl ?? "");
    setKey("");
  }, []);

  useEffect(() => {
    let live = true;
    loadWebSearch(api).then((next) => { if (live) apply(next); }).catch((failure) => {
      if (!live) return;
      // No person behind this session: there is no personal setting to show.
      if ((failure as { status?: unknown } | null)?.status === 401) setHidden(true);
      else setNote({ text: t("webSearch.loadError"), error: true });
    });
    return () => { live = false; };
  }, [apply]);

  if (hidden) return null;

  const info = provider ? WEB_SEARCH_PROVIDER_INFO[provider] : null;
  const sameProvider = Boolean(view?.provider && view.provider === provider);
  const savedKey = sameProvider && view?.keyConfigured === true;
  const changed = provider !== (view?.provider ?? "") || key.trim() !== "" || (info?.baseUrl === true && baseUrl.trim() !== (view?.baseUrl ?? ""));
  const canSave = Boolean(info) && changed && (!info!.keyRequired || savedKey || key.trim() !== "") && (!info!.baseUrl || baseUrl.trim() !== "");
  const canTest = Boolean(info) && (!info!.keyRequired || savedKey || key.trim() !== "") && (!info!.baseUrl || baseUrl.trim() !== "");
  const input = () => ({
    provider: provider as WebSearchProviderId,
    ...(key.trim() ? { key: key.trim() } : {}),
    ...(info?.baseUrl ? { baseUrl: baseUrl.trim() } : {}),
  });
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
    } catch (failure) {
      setNote({ text: readableErrorMessage(failure, t("webSearch.actionError")), error: true });
    } finally {
      setBusy(false);
    }
  };

  const summary = view?.ready && view.provider
    ? view.last4
      ? t("webSearch.summary.readyKey", { provider: WEB_SEARCH_PROVIDER_INFO[view.provider].label, last4: view.last4 })
      : t("webSearch.summary.ready", { provider: WEB_SEARCH_PROVIDER_INFO[view.provider].label })
    : t("webSearch.summary.none");

  return (
    <div data-settings-card="connections.webSearch" data-web-search="">
      <WebSearchGroup bare={bare}>
        <DescribedRow
          label={bare ? t("webSearch.title") : t("webSearch.provider")}
          description={summary}
          help={t("webSearch.help")}
          icon={<Search size={14} />}
          rowId="webSearch.provider"
        >
          <PillSelect<Choice>
            value={provider}
            ariaLabel={t("webSearch.provider")}
            disabled={busy || view === null}
            options={[
              ...(view?.provider ? [] : [{ value: "" as Choice, label: t("webSearch.choose") }]),
              ...WEB_SEARCH_PROVIDERS.map((id) => ({ value: id as Choice, label: WEB_SEARCH_PROVIDER_INFO[id].label })),
            ]}
            onChange={(next) => { setProvider(next); setKey(""); setNote(null); }}
          />
        </DescribedRow>
        {info && (
          <div className="flex flex-col" data-web-search-form={info.id}>
            {info.baseUrl && (
              <FieldRow label={t("webSearch.baseUrl")} hint={t("webSearch.baseUrl.hint")}>
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  className={FIELD}
                  placeholder="https://search.example.org"
                  value={baseUrl}
                  disabled={busy}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </FieldRow>
            )}
            <FieldRow
              label={info.keyRequired ? t("webSearch.key") : t("webSearch.key.optional")}
              hint={savedKey
                ? (view?.last4 ? t("webSearch.key.savedLast4", { last4: view.last4 }) : t("webSearch.key.saved"))
                : t("webSearch.key.hint")}
            >
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                className={FIELD}
                placeholder={savedKey ? t("webSearch.key.replace") : t("webSearch.key.placeholder")}
                value={key}
                disabled={busy}
                onChange={(event) => setKey(event.target.value)}
              />
            </FieldRow>
            <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
              <button
                type="button"
                className="ui-button ui-button-primary min-h-[44px] disabled:opacity-50 md:min-h-0"
                disabled={busy || !canSave}
                onClick={() => void run(async () => {
                  apply(await saveWebSearch(api, input()));
                  setNote({ text: t("webSearch.saved"), error: false });
                })}
              >
                {t("webSearch.save")}
              </button>
              <button
                type="button"
                className={PILL}
                disabled={busy || !canTest}
                onClick={() => void run(async () => {
                  const answer = await testWebSearch(api, input());
                  setNote({ text: answer.results > 0 ? t("webSearch.test.ok") : t("webSearch.test.empty"), error: false });
                })}
              >
                {t("webSearch.test")}
              </button>
              {view?.provider && (
                <button
                  type="button"
                  className={cn(PILL, "text-danger")}
                  disabled={busy}
                  onClick={() => void run(async () => {
                    apply(await removeWebSearch(api));
                    setNote({ text: t("webSearch.removed"), error: false });
                  })}
                >
                  {t("webSearch.remove")}
                </button>
              )}
              {info.keysUrl && (
                <a className="ml-auto text-[12px] text-ink-secondary underline-offset-2 hover:underline" href={info.keysUrl} target="_blank" rel="noreferrer">
                  {t("webSearch.getKey", { provider: info.label })}
                </a>
              )}
            </div>
          </div>
        )}
        {note && (
          <p role={note.error ? "alert" : "status"} className={cn("px-3.5 pb-2 text-[12px]", note.error ? "text-danger" : "text-ink-secondary")}>
            {note.text}
          </p>
        )}
      </WebSearchGroup>
    </div>
  );
}

function WebSearchGroup({ bare, children }: { bare: boolean; children: ReactNode }) {
  if (bare) return <>{children}</>;
  return <SettingsGroup title={t("webSearch.title")} groupId="webSearch">{children}</SettingsGroup>;
}
