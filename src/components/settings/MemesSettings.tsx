// Settings > Providers > Other services > Memes (#2121): the person's own
// Tenor or GIPHY key for the Memes picker and send_meme. The key is sent once
// and never comes back: the row shows only that one is saved and its last four
// characters.
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { loadMemeSettings, removeMemeSettings, saveMemeSettings } from "@/lib/memes";
import { readableErrorMessage } from "@/lib/readable-error";
import { MEME_PROVIDERS, MEME_PROVIDER_INFO, type MemeProviderId, type MemeSettingsView } from "../../../shared/memes";
import { DescribedRow, FIELD, PILL, PRIMARY_PILL, PillSelect, SettingsGroup } from "../SettingsPrimitives";

type Choice = MemeProviderId | "";

/** `bare`: the rows alone, inside Providers > Other services. */
export function MemesSettings({ bare = false }: { bare?: boolean } = {}) {
  const [view, setView] = useState<MemeSettingsView | null>(null);
  const [hidden, setHidden] = useState(false);
  const [provider, setProvider] = useState<Choice>("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [editing, setEditing] = useState(false);

  const apply = useCallback((next: MemeSettingsView) => {
    setView(next);
    setProvider(next.provider ?? "");
    setKey("");
  }, []);

  useEffect(() => {
    let live = true;
    loadMemeSettings().then((next) => { if (live) apply(next); }).catch((failure) => {
      if (!live) return;
      if ((failure as { status?: unknown } | null)?.status === 401) setHidden(true);
      else setNote({ text: t("memes.settings.loadError"), error: true });
    });
    return () => { live = false; };
  }, [apply]);

  if (hidden) return null;

  const info = provider ? MEME_PROVIDER_INFO[provider] : null;
  const sameProvider = Boolean(view?.provider && view.provider === provider);
  const savedKey = sameProvider && view?.keyConfigured === true;
  const changed = provider !== (view?.provider ?? "") || key.trim() !== "";
  const canSave = Boolean(info) && changed && (savedKey || key.trim() !== "");
  const input = () => ({
    provider: provider as MemeProviderId,
    ...(key.trim() ? { key: key.trim() } : {}),
  });
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
    } catch (failure) {
      setNote({ text: readableErrorMessage(failure, t("memes.settings.actionError")), error: true });
    } finally {
      setBusy(false);
    }
  };

  const summary = view?.ready && view.provider
    ? view.last4
      ? t("memes.settings.summary.readyKey", { provider: MEME_PROVIDER_INFO[view.provider].label, last4: view.last4 })
      : t("memes.settings.summary.ready", { provider: MEME_PROVIDER_INFO[view.provider].label })
    : t("memes.settings.summary.none");

  // #2295: a compact row; the key field opens only behind "Change key", or
  // when the chosen service has no saved key yet (the same key block as the
  // providers: label, masked field, saved line, Save / Remove).
  const formOpen = Boolean(info) && (editing || !savedKey);
  const cancel = () => { setProvider(view?.provider ?? ""); setKey(""); setEditing(false); setNote(null); };
  return (
    <div data-settings-card="connections.memes" data-memes-settings="">
      <MemesGroup bare={bare}>
        <DescribedRow
          label={bare ? t("memes.settings.title") : t("memes.settings.provider")}
          description={summary}
          help={t("memes.settings.help")}
          rowId="memes.provider"
          below={info && formOpen && (
            <div className="mt-2 flex min-w-0 flex-col gap-2 sm:pl-[22px]" data-memes-form={info.id}>
              <label className="flex min-w-0 flex-col gap-1 text-[12px] text-ink-secondary">
                {t("memes.settings.key")}
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className={FIELD}
                  placeholder={savedKey ? t("memes.settings.key.replace") : t("memes.settings.key.placeholder")}
                  value={key}
                  disabled={busy}
                  onChange={(event) => setKey(event.target.value)}
                />
              </label>
              <p className="text-[12px] text-ink-secondary">
                {savedKey
                  ? (view?.last4 ? t("memes.settings.key.savedLast4", { last4: view.last4 }) : t("memes.settings.key.saved"))
                  : t("memes.settings.key.hint")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={PRIMARY_PILL}
                  disabled={busy || !canSave}
                  onClick={() => void run(async () => {
                    apply(await saveMemeSettings(input()));
                    setEditing(false);
                    setNote({ text: t("memes.settings.saved"), error: false });
                  })}
                >
                  {t("memes.settings.save")}
                </button>
                {(editing || (view?.provider && provider !== view.provider)) && (
                  <button type="button" className={PILL} disabled={busy} onClick={cancel}>{t("common.cancel")}</button>
                )}
                {info.keysUrl && (
                  <a className="ml-auto text-[12px] text-ink-secondary underline-offset-2 hover:underline" href={info.keysUrl} target="_blank" rel="noreferrer">
                    {t("memes.settings.getKey", { provider: info.label })}
                  </a>
                )}
              </div>
            </div>
          )}
        >
          <PillSelect<Choice>
            value={provider}
            ariaLabel={t("memes.settings.provider")}
            disabled={busy || view === null}
            options={[
              ...(view?.provider ? [] : [{ value: "" as Choice, label: t("memes.settings.choose") }]),
              ...MEME_PROVIDERS.map((id) => ({ value: id as Choice, label: MEME_PROVIDER_INFO[id].label })),
            ]}
            onChange={(next) => { setProvider(next); setKey(""); setEditing(false); setNote(null); }}
          />
          {savedKey && !editing && (
            <button type="button" className={PILL} disabled={busy} data-memes-change-key="" onClick={() => { setEditing(true); setNote(null); }}>
              {t("memes.settings.changeKey")}
            </button>
          )}
          {view?.provider && !formOpen && (
            <button
              type="button"
              className={cn(PILL, "text-danger")}
              disabled={busy}
              onClick={() => void run(async () => {
                apply(await removeMemeSettings());
                setNote({ text: t("memes.settings.removed"), error: false });
              })}
            >
              {t("memes.settings.remove")}
            </button>
          )}
        </DescribedRow>
        {note && (
          <p role={note.error ? "alert" : "status"} className={cn("px-3.5 pb-2 text-[12px]", note.error ? "text-danger" : "text-ink-secondary")}>
            {note.text}
          </p>
        )}
      </MemesGroup>
    </div>
  );
}

function MemesGroup({ bare, children }: { bare: boolean; children: ReactNode }) {
  if (bare) return <>{children}</>;
  return <SettingsGroup title={t("memes.settings.title")} groupId="memes">{children}</SettingsGroup>;
}
