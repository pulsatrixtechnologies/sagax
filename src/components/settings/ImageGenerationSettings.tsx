// Installation image generation: provider and a custom Images API. Bot
// avatars only ask for a picture. They do not edit this connection. Since
// 2026-10-15 no key is typed here: the OpenAI image key, the custom API's
// optional key and the xAI key (Grok images) are rows of the Keys list on the
// same page, and this card says whether the chosen provider's key is saved,
// with "Add in Keys" when it is not (one place for every key).
import { cn } from "@/lib/cn";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { normalizeImageGenerationUrl, type AvatarImageProvider } from "../../../shared/image-generation";
import { KeyInKeys, type KeyRowId } from "./ProviderKeys";
import { DescribedRow, PILL, PillSelect } from "../SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

const PROVIDER_LABEL: Record<AvatarImageProvider, LocaleKey> = {
  openai: "imageGen.provider.openai",
  xai: "imageGen.provider.xai",
  custom: "imageGen.provider.custom",
};
const PROVIDER_HINT: Record<AvatarImageProvider, LocaleKey> = {
  openai: "imageGen.hint.openai",
  xai: "imageGen.hint.xai",
  custom: "imageGen.hint.custom",
};
/** The row of the Keys list each provider's key lives in. */
const PROVIDER_KEY_ROW: Record<AvatarImageProvider, KeyRowId> = {
  openai: "openaiImage",
  xai: "xai",
  custom: "customImage",
};

/** The chosen provider's name, for a read-only row (an organization server:
 * image generation is set in Perspicax, 2026-11-05). */
export function imageProviderLabel(provider: AvatarImageProvider | undefined): string {
  return t(PROVIDER_LABEL[provider ?? "openai"]);
}

const INPUT_CLASS = "w-full min-w-0 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none disabled:opacity-50";
const BUTTON_CLASS = cn(PILL, "shrink-0");

/** `keysLink`: the Keys list is on this page, so a missing key links to its
 * row (false in a remote window, where the list is not shown). */
export function ImageGenerationSettings({ keysLink = true }: { keysLink?: boolean }) {
  const { state, dispatch } = useStore();
  const imageGen = state.config?.imageGen;
  const savedProvider = imageGen?.provider ?? "openai";
  const [providerDraft, setProviderDraft] = useState<AvatarImageProvider | null>(null);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = providerDraft ?? savedProvider;
  const customUrl = urlDraft ?? imageGen?.customUrl ?? "";
  const customModel = modelDraft ?? imageGen?.customModel ?? "";
  const busy = saving;
  const keyConfigured = provider === "custom"
    ? imageGen?.customKeyConfigured === true
    : provider === "xai"
      ? (imageGen?.xaiConfigured ?? state.config?.xai?.configured) === true
      : (imageGen?.openaiConfigured ?? (savedProvider === "openai" && imageGen?.configured)) === true;
  const settingsDirty = provider !== savedProvider || (provider === "custom" && (
    customUrl.trim() !== (imageGen?.customUrl ?? "") ||
    customModel.trim() !== (imageGen?.customModel ?? "")
  ));
  const configured = provider === savedProvider && imageGen?.configured === true;

  const saveConfig = async (patch: object) => {
    const status: ConfigStatus = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    dispatch({ type: "configStatus", config: status });
  };

  const chooseProvider = async (next: AvatarImageProvider) => {
    if (busy) return;
    setProviderDraft(next);
    setUrlDraft(null);
    setModelDraft(null);
    setError(null);
    if (next === "custom") return;
    setSaving(true);
    try {
      await saveConfig({ imageGen: { provider: next } });
    } catch (saveError) {
      setError(readableError(saveError));
    } finally {
      setProviderDraft(null);
      setSaving(false);
    }
  };

  const saveConnection = async () => {
    if (busy || provider !== "custom" || !customUrl.trim() || !customModel.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const url = normalizeImageGenerationUrl(customUrl.trim());
      const model = customModel.trim();
      if (model.length > 200 || ["\r", "\n", "\0"].some((character) => model.includes(character))) {
        throw new Error(t("imageGen.modelError"));
      }
      await saveConfig({ imageGen: {
        provider,
        customUrl: url,
        customModel: model,
      } });
      setProviderDraft(null);
      setUrlDraft(null);
      setModelDraft(null);
    } catch (saveError) {
      setError(readableError(saveError));
    } finally {
      setSaving(false);
    }
  };

  // 0.5.6: rows of the Image generation group (the reference design's settings rows).
  // The provider in a pill menu, its key in the grey line under it, what it
  // is billed to behind the info button.
  return (
    <>
      <DescribedRow
        label={t("imageGen.provider")}
        help={t(PROVIDER_HINT[provider])}
        rowId="imageProvider"
        description={(
          <KeyInKeys
            row={PROVIDER_KEY_ROW[provider]}
            saved={keyConfigured}
            optional={provider === "custom"}
            missing={provider === "custom" ? t("imageGen.key.none") : undefined}
            link={keysLink}
          />
        )}
        below={provider === "custom" && (
          <div className="mt-2.5 flex flex-col gap-2">
            <label className="block text-[12px] text-ink-secondary">
              {t("imageGen.baseUrl")}
              <input
                type="url"
                value={customUrl}
                disabled={busy}
                onChange={(event) => setUrlDraft(event.target.value)}
                placeholder={t("imageGen.baseUrlPlaceholder")}
                autoComplete="off"
                className={`${INPUT_CLASS} mt-1`}
              />
            </label>
            <label className="block text-[12px] text-ink-secondary">
              {t("imageGen.model")}
              <input
                value={customModel}
                disabled={busy}
                onChange={(event) => setModelDraft(event.target.value)}
                placeholder={t("imageGen.modelPlaceholder")}
                aria-label={t("imageGen.model")}
                autoComplete="off"
                className={`${INPUT_CLASS} mt-1`}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-[12px] leading-4 text-ink-secondary">{t("imageGen.customNote")}</p>
              <button
                type="button"
                onClick={() => void saveConnection()}
                disabled={busy || !customUrl.trim() || !customModel.trim() || (!settingsDirty && configured)}
                className={BUTTON_CLASS}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {t("imageGen.saveConnection")}
              </button>
            </div>
          </div>
        )}
      >
        <PillSelect
          value={provider}
          ariaLabel={t("imageGen.provider")}
          disabled={busy || !state.config}
          onChange={(next) => void chooseProvider(next)}
          options={(Object.keys(PROVIDER_LABEL) as AvatarImageProvider[]).map((value) => ({ value, label: t(PROVIDER_LABEL[value]) }))}
        />
      </DescribedRow>
      {error && <div role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</div>}
    </>
  );
}
