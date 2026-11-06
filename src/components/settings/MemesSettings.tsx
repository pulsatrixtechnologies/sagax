// Settings > Providers > Other services > Memes (#2121): the person's own
// Tenor or GIPHY key for the Memes picker and send_meme. The key is sent once
// and never comes back: the row shows only that one is saved and its last four
// characters.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ImagePlay } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { loadMemeSettings, removeMemeSettings, saveMemeSettings } from "@/lib/memes";
import { readableErrorMessage } from "@/lib/readable-error";
import { MEME_PROVIDERS, MEME_PROVIDER_INFO, type MemeProviderId, type MemeSettingsView } from "../../../shared/memes";
import { DescribedRow, FIELD, FieldRow, PILL, PillSelect, SettingsGroup } from "../SettingsPrimitives";

type Choice = MemeProviderId | "";

/** `bare`: the rows alone, inside Providers > Other services. */
export function MemesSettings({ bare = false }: { bare?: boolean } = {}) {
  const [view, setView] = useState<MemeSettingsView | null>(null);
  const [hidden, setHidden] = useState(false);
  const [provider, setProvider] = useState<Choice>("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

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

  return (
    <div data-settings-card="connections.memes" data-memes-settings="">
      <MemesGroup bare={bare}>
        <DescribedRow
          label={bare ? t("memes.settings.title") : t("memes.settings.provider")}
          description={summary}
          help={t("memes.settings.help")}
          icon={<ImagePlay size={14} />}
          rowId="memes.provider"
        >
          <PillSelect<Choice>
            value={provider}
            ariaLabel={t("memes.settings.provider")}
            disabled={busy || view === null}
            options={[
              ...(view?.provider ? [] : [{ value: "" as Choice, label: t("memes.settings.choose") }]),
              ...MEME_PROVIDERS.map((id) => ({ value: id as Choice, label: MEME_PROVIDER_INFO[id].label })),
            ]}
            onChange={(next) => { setProvider(next); setKey(""); setNote(null); }}
          />
        </DescribedRow>
        {info && (
          <div className="flex flex-col" data-memes-form={info.id}>
            <FieldRow
              label={t("memes.settings.key")}
              hint={savedKey
                ? (view?.last4 ? t("memes.settings.key.savedLast4", { last4: view.last4 }) : t("memes.settings.key.saved"))
                : t("memes.settings.key.hint")}
            >
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
            </FieldRow>
            <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
              <button
                type="button"
                className="ui-button ui-button-primary min-h-[44px] disabled:opacity-50 md:min-h-0"
                disabled={busy || !canSave}
                onClick={() => void run(async () => {
                  apply(await saveMemeSettings(input()));
                  setNote({ text: t("memes.settings.saved"), error: false });
                })}
              >
                {t("memes.settings.save")}
              </button>
              {view?.provider && (
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
              {info.keysUrl && (
                <a className="ml-auto text-[12px] text-ink-secondary underline-offset-2 hover:underline" href={info.keysUrl} target="_blank" rel="noreferrer">
                  {t("memes.settings.getKey", { provider: info.label })}
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
      </MemesGroup>
    </div>
  );
}

function MemesGroup({ bare, children }: { bare: boolean; children: ReactNode }) {
  if (bare) return <>{children}</>;
  return <SettingsGroup title={t("memes.settings.title")} groupId="memes">{children}</SettingsGroup>;
}
