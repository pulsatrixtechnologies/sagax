import { useEffect, useState } from "react";
import { AudioLines, Check, Loader2 } from "lucide-react";

import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { DescribedRow, FoldRow, PILL, PillSelect, SettingsGroup } from "../SettingsPrimitives";
import { ExternalLinkPill } from "./SettingsPatterns";

const FISH_MODELS = [
  { value: "s2.1-pro", label: "voice.fish.modelPro" },
  { value: "s2.1-pro-free", label: "voice.fish.modelFree" },
] as const;
type FishModel = (typeof FISH_MODELS)[number]["value"];

const INPUT_CLASS = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none";
const SAVE_CLASS = cn(PILL, "shrink-0 disabled:cursor-not-allowed");

/** Non-secret options of voice providers, independent of the person's choice. */
export function VoiceProviderOptions({ installation = false, children }: { installation?: boolean; children?: React.ReactNode }) {
  const { state, dispatch } = useStore();
  const tts = state.config?.tts;
  const [serverUrl, setServerUrl] = useState("");
  const [model, setModel] = useState("");
  const [savingServer, setSavingServer] = useState(false);
  const [savingFishModel, setSavingFishModel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = Boolean(tts?.baseUrl);

  useEffect(() => {
    setServerUrl(tts?.baseUrl ?? "");
    setModel(tts?.model ?? "");
  }, [tts?.baseUrl, tts?.model]);

  const saveServer = () => {
    const next = serverUrl.trim();
    if (!next || savingServer) return Promise.resolve();
    if (!/^https?:\/\//i.test(next)) {
      setError(t("voice.engine.addressError"));
      return Promise.resolve();
    }
    setSavingServer(true);
    setError(null);
    return api("/api/config", { method: "PUT", body: JSON.stringify({ tts: { baseUrl: next, model: model.trim() } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSavingServer(false));
  };

  const saveFishModel = (next: FishModel) => {
    if (next === tts?.fishModel || savingFishModel) return;
    setSavingFishModel(true);
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ tts: { fishModel: next } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSavingFishModel(false));
  };

  // #2080 (L1): "No long dashes" moved to Models > Advanced; what is left
  // writes the installation.
  if (!installation) return null;

  return (
    // #2080 (L1): one Advanced card after Audio, every row folded: the
    // voice engines (Fish, Chatterbox) and, as children, Live calls.
    <div data-settings-card="connections.voice" data-voice-section="">
      <SettingsGroup title={t("voiceMode.call.advanced")} groupId="voice-options">
        {tts && (
        <FoldRow cardId="voice.options" label={t("voice.options.title")} description={t("voice.options.help")} icon={<AudioLines size={14} />}>
        <div className="-mx-3.5 flex flex-col" data-voice-options="">
        <DescribedRow label={t("voice.fish.model")} help={t("voice.fish.modelHint")} rowId="fishModel">
          <PillSelect
            value={(tts.fishModel ?? "s2.1-pro") as FishModel}
            ariaLabel={t("voice.fish.model")}
            disabled={savingFishModel}
            onChange={(next) => saveFishModel(next)}
            options={FISH_MODELS.map((option) => ({ value: option.value, label: t(option.label) }))}
          />
        </DescribedRow>

        <DescribedRow
          label={t("voice.engine.server")}
          rowId="chatterbox"
          description={(
            <span className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", configured ? "bg-accent" : "bg-raised-hover")} aria-hidden="true" />
              {configured ? t("voice.engine.saved") : t("voice.engine.serverHint")}
            </span>
          )}
          below={(
            <div className="mt-2 flex flex-col gap-2">
              <ExternalLinkPill href="https://github.com/resemble-ai/chatterbox" className="w-fit">{t("voice.engine.serverDocs")}</ExternalLinkPill>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveServer()}
                  placeholder={t("voice.engine.addressPlaceholder")}
                  aria-label={t("voice.engine.address")}
                  autoComplete="off"
                  spellCheck={false}
                  className={INPUT_CLASS}
                />
                <button
                  type="button"
                  onClick={() => void saveServer()}
                  disabled={savingServer || !serverUrl.trim()}
                  className={SAVE_CLASS}
                >
                  {savingServer ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />{t("common.save")}</>}
                </button>
              </div>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void saveServer()}
                placeholder={t("voice.engine.modelPlaceholder")}
                aria-label={t("voice.engine.model")}
                autoComplete="off"
                spellCheck={false}
                className={INPUT_CLASS}
              />
            </div>
          )}
        />

      {error && <div role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</div>}
        </div>
        </FoldRow>
        )}
        {children}
      </SettingsGroup>
    </div>
  );
}
