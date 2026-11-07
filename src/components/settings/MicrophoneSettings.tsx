// Settings > Models and voice > Microphone: which input this computer
// records with, for dictation, voice notes and calls (lib/audio-input). The
// list comes from the window's own enumerateDevices; the choice stays on this
// computer. The macOS dictation helper keeps the system's input.
import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { useAudioInputs } from "@/lib/audio-input";
import { t } from "@/lib/i18n";
import { CompactRow, DescribedRow, PILL, PillSelect } from "../SettingsPrimitives";

const DEFAULT = "default";

export function MicrophoneSettings() {
  const mic = useAudioInputs();
  const listed = mic.selected ? mic.inputs.some((input) => input.id === mic.selected) : true;
  const options = [
    { value: DEFAULT, label: t("settings.microphone.default") },
    ...mic.inputs.map((input, index) => ({
      value: input.id,
      label: input.label || t("settings.microphone.unnamed", { number: index + 1 }),
    })),
    // a saved microphone that is not plugged in stays visible, so the choice is not lost
    ...(mic.selected && !listed && mic.loaded ? [{ value: mic.selected, label: t("settings.microphone.missing") }] : []),
  ];
  return (
    <div data-settings-card="voice.microphone">
      <DescribedRow
        label={t("settings.microphone.title")}
        rowId="microphone"
        description={mic.selected && !listed && mic.loaded ? t("settings.microphone.missingHint") : t("settings.microphone.hint")}
      >
        {mic.namesHidden && (
          <button type="button" className={PILL} onClick={() => void mic.revealNames()} data-microphone-reveal="">
            {t("settings.microphone.showNames")}
          </button>
        )}
        <PillSelect
          value={mic.selected ?? DEFAULT}
          ariaLabel={t("settings.microphone.title")}
          onChange={(next) => mic.select(next === DEFAULT ? null : next)}
          options={options}
        />
      </DescribedRow>
    </div>
  );
}

type MicStatus = "granted" | "denied" | "restricted" | "not-determined" | string;

/** Models and voice > Audio > Microphone (was General > System): the desktop app's own permission, as the
 * welcome flow asks it (PermissionsBeat). Desktop only. */
export function MicrophonePermissionRow() {
  const status = typeof window === "undefined" ? undefined : window.ogb?.permStatus;
  const [mic, setMic] = useState<MicStatus | null>(null);
  useEffect(() => {
    if (!status) return;
    let live = true;
    const read = () => status().then((perms) => { if (live) setMic(perms?.mic ?? null); }).catch(() => {});
    read();
    // Back from System Settings: read it again.
    window.addEventListener("focus", read);
    return () => { live = false; window.removeEventListener("focus", read); };
  }, [status]);
  if (!status) return null;
  const granted = mic === "granted";
  const denied = mic === "denied" || mic === "restricted";
  return (
    <CompactRow label={t("settings.microphone.title")} rowId="microphoneAccess">
      {mic === null ? null : granted ? (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-secondary" data-mic-status="granted">
          <Check size={14} aria-hidden="true" className="text-success" />
          {t("settings.microphone.allowed")}
        </span>
      ) : denied ? (
        <button type="button" onClick={() => void window.ogb?.permOpenSettings?.("mic")} className="ui-button" data-mic-status="denied">
          {t("onboarding.perms.openSettings")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void window.ogb?.permRequestMic?.().then(() => status().then((perms) => setMic(perms?.mic ?? null))).catch(() => {})}
          className="ui-button"
          data-mic-status="ask"
        >
          {t("onboarding.perms.enable")}
        </button>
      )}
    </CompactRow>
  );
}
