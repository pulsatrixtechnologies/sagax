// One provider choice for calls, read aloud and voice notes. A paired Mac
// can still read with its own installed voice, independently of the host.
import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { speaker } from "@/lib/tts";
import {
  listLocalSystemVoices, localSystemVoicesAvailable, remoteSystemVoice,
  remoteVoiceProvider, setRemoteSystemVoice, setRemoteVoiceProvider, type RemoteVoiceProvider,
} from "@/lib/local-voice";
import { t } from "@/lib/i18n";
import { VoiceProviderSettings } from "./settings/VoiceProviderSettings";
import { CompactRow, DescribedRow, GROUP_CARD, PILL, PillSelect, SettingsGroup, Switch, useSettingsSurface } from "./SettingsPrimitives";

export function VoiceSettings({ bot, onPatch, workspaceConfigurationLocked = false, providers = true }: {
  bot: Bot;
  onPatch: (patch: Partial<Pick<Bot, "voice" | "speakReplies" | "voiceNotes">>) => void;
  workspaceConfigurationLocked?: boolean;
  providers?: boolean;
}) {
  const { state } = useStore();
  const localMacClient = workspaceConfigurationLocked && localSystemVoicesAvailable();
  const [deviceProvider, setDeviceProvider] = useState<RemoteVoiceProvider>(() => remoteVoiceProvider());
  const [deviceVoice, setDeviceVoice] = useState(() => remoteSystemVoice(bot.id));
  const [voices, setVoices] = useState<Array<{ id: string; label: string }>>([]);
  const usesLocalSystem = localMacClient && deviceProvider === "system";
  // The bot's profile page (#2313): the voice rows sit in one plain card
  // under the rail's own label ("Voice"), like every other card there.
  const plain = useSettingsSurface() === "plain";
  useEffect(() => { setDeviceVoice(remoteSystemVoice(bot.id)); }, [bot.id]);
  useEffect(() => {
    if (!usesLocalSystem) return;
    const load = () => setVoices(listLocalSystemVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [usesLocalSystem]);

  if (!state.config?.tts) return null;
  const rows = (
    <>
        {localMacClient && (
          <DescribedRow label={t("botPanel.voice.mac")} help={t("voice.bot.macIntro")}>
            <PillSelect<RemoteVoiceProvider> value={deviceProvider} ariaLabel={t("botPanel.voice.mac")}
              onChange={(next) => { setRemoteVoiceProvider(next); setDeviceProvider(next); }}
              options={[{ value: "system", label: t("botPanel.voice.macVoices") }, { value: "host", label: t("botPanel.voice.hostVoice") }]} />
          </DescribedRow>
        )}
        {usesLocalSystem && (
          <CompactRow label={t("botPanel.voice.voice")}>
            <span data-voice-picker="" className="inline-flex min-w-0">
              <PillSelect value={deviceVoice} ariaLabel={t("botPanel.voice.whose", { name: bot.name })}
                onChange={(voice) => { setRemoteSystemVoice(bot.id, voice); setDeviceVoice(voice); }}
                options={[
                  { value: "", label: t("botPanel.voice.macDefault") },
                  ...(deviceVoice && !voices.some((voice) => voice.id === deviceVoice) ? [{ value: deviceVoice, label: t("botPanel.voice.current") }] : []),
                  ...voices.map((voice) => ({ value: voice.id, label: voice.label })),
                ]} />
            </span>
            <button type="button" onClick={() => void speaker.speak(t("botPanel.voice.sample"), { botId: bot.id })}
              aria-label={t("botPanel.voice.hear")} className={`${PILL} gap-1.5`}>
              <Volume2 size={13} aria-hidden="true" /> {t("botPanel.voice.try")}
            </button>
          </CompactRow>
        )}
        <DescribedRow label={t("botPanel.voice.read")} help={t("botPanel.voice.readHelp")}>
          <Switch checked={Boolean(bot.speakReplies)} aria-label={t("botPanel.voice.readAria")}
            onClick={() => onPatch({ speakReplies: !bot.speakReplies })} />
        </DescribedRow>
        <DescribedRow label={t("botPanel.voice.notes")} help={t("botPanel.voice.notesHelp")}>
          <Switch checked={bot.voiceNotes !== false} aria-label={t("botPanel.voice.notesAria")}
            onClick={() => onPatch({ voiceNotes: bot.voiceNotes === false })} />
        </DescribedRow>
    </>
  );
  return (
    <div className={plain ? "flex flex-col gap-5" : "flex flex-col gap-3"} data-voice-settings="">
      {!usesLocalSystem && providers && <VoiceProviderSettings bot={bot} />}
      {plain
        ? <SettingsGroup title={t("botSettings.nav.voice")} groupId="botVoice">{rows}</SettingsGroup>
        : <div className={GROUP_CARD}>{rows}</div>}
    </div>
  );
}
