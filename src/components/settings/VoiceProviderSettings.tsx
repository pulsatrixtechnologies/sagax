// Who speaks and who hears (2026-10-29, shared/voice-providers.ts): the
// bot's voice (xAI, OpenAI or ElevenLabs), the speech to text (xAI or
// OpenAI) and the voice itself, with "Test the voice". In Settings > Voice
// it is the person's own choice; in Edit bot > Voice it is this bot's, for
// this person ("Same as my settings" by default). Only the providers the
// person has a usable key for are offered (the server's status). A
// provider that fails or reaches its limit gives way to another one by
// itself, and the thread's Events tab says so. Kept in the person's synced
// voice preference (`omb.voiceMode.v1`): the desktop, the web and the
// iPhone follow the same choice.
import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { fetchProviderVoices, fetchVoiceProviders, testVoice, type VoiceOption } from "@/lib/voice-mode/api";
import {
  useVoiceModeSettings,
  voiceSettingsForBot,
  writeBotVoiceChoice,
  writeVoiceForBot,
  writeVoiceProviders,
} from "@/lib/voice-mode/settings";
import type { VoiceModeStatus } from "../../../shared/voice-mode";
import {
  VOICE_PROVIDER_LABELS,
  VOICE_STT_PROVIDERS,
  VOICE_TTS_PROVIDERS,
  type VoiceSttChoice,
  type VoiceSttProvider,
  type VoiceTtsChoice,
  type VoiceTtsProvider,
} from "../../../shared/voice-providers";
import { CompactRow, DescribedRow, GROUP_CARD, PILL, PillSelect, SettingsGroup, useSettingsSurface, type PillOption } from "../SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

type Pick<P extends string> = "inherit" | "auto" | P;

function label(provider: string): string {
  if (provider === "system") return t("voice.engine.system");
  if (provider === "chatterbox") return t("voice.engine.chatterbox");
  return VOICE_PROVIDER_LABELS[provider as VoiceTtsProvider] ?? provider;
}

/** The options of one role: the providers offered, the one picked kept
 * even when its key went away (named so). */
export function providerOptions<P extends string>(offered: readonly P[], all: readonly P[], picked: Pick<P>, inherit: string | null): Array<PillOption<Pick<P>>> {
  const options: Array<PillOption<Pick<P>>> = [];
  if (inherit !== null) options.push({ value: "inherit", label: inherit });
  else options.push({ value: "auto", label: t("voiceProviders.auto") });
  for (const provider of all) {
    if (offered.includes(provider)) options.push({ value: provider, label: label(provider) });
    else if (picked === provider) options.push({ value: provider, label: t("voiceProviders.noKey", { provider: label(provider) }) });
  }
  return options;
}

/** The providers this person may use and the voices of the one that speaks,
 * for one bot or for the person (shared by Edit bot > Voice and the bot
 * panel's Voice chat card, #2125). */
// Voices already read, per provider and bot: the picker shows the current
// voice by name at once on the next open instead of a loading label (#2125).
const voiceListCache = new Map<string, VoiceOption[]>();

export function useVoicePicker(botId?: string) {
  const settings = useVoiceModeSettings();
  const view = voiceSettingsForBot(settings, botId);
  const [resolution, setResolution] = useState<{ botId?: string; tts: VoiceTtsChoice; stt: VoiceSttChoice; status: VoiceModeStatus } | null>(null);
  const status = resolution?.botId === botId ? resolution?.status ?? null : null;
  const currentResolution = resolution?.botId === botId && resolution?.tts === view.tts && resolution?.stt === view.stt;
  const [failed, setFailed] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(null);
    fetchVoiceProviders(botId, controller.signal, { tts: view.tts, stt: view.stt }).then((next) => {
      if (!controller.signal.aborted) setResolution({ botId, tts: view.tts, stt: view.stt, status: next });
    }, (error: unknown) => {
      if (!controller.signal.aborted) setFailed(readableError(error));
    });
    return () => controller.abort();
  }, [botId, view.tts, view.stt]);

  const offeredTts = status?.providers?.tts ?? [];
  const offeredStt = status?.providers?.stt ?? [];
  // the provider whose voice is picked: the one chosen, else the one the server starts with
  const speaking: VoiceTtsProvider | undefined = view.tts !== "auto" ? view.tts : currentResolution ? status?.tts ?? offeredTts[0] : undefined;

  useEffect(() => {
    if (!speaking || !offeredTts.includes(speaking)) { setVoices(null); return; }
    const controller = new AbortController();
    const cacheKey = `${speaking}:${botId ?? ""}`;
    setVoices(voiceListCache.get(cacheKey) ?? null);
    fetchProviderVoices(speaking, botId, controller.signal).then((next) => {
      voiceListCache.set(cacheKey, next);
      setVoices(next);
    }, () => { if (!controller.signal.aborted) setVoices([]); });
    return () => controller.abort();
    // offeredTts is derived from status: its identity follows it
  }, [speaking, botId, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedVoice = speaking ? view.voices[speaking] ?? "" : "";
  const voiceOptions: Array<PillOption<string>> = [
    // the current voice reads by name right away, never "Loading voices" (#2125)
    { value: "", label: t("voiceProviders.default") },
    ...(selectedVoice && !(voices ?? []).some((voice) => voice.id === selectedVoice) ? [{ value: selectedVoice, label: selectedVoice }] : []),
    ...(voices ?? []).map((voice) => ({ value: voice.id, label: voice.own ? t("voiceProviders.ownVoice", { voice: voice.label }) : voice.description ? `${voice.label} (${voice.description})` : voice.label })),
  ];

  return { settings, view, status, currentResolution, failed, voices, offeredTts, offeredStt, speaking, selectedVoice, voiceOptions };
}

export function VoiceProviderSettings({ bot }: { bot?: { id: string; name: string } }) {
  const botId = bot?.id;
  const { settings, view, status, currentResolution, failed, offeredTts, offeredStt, speaking, selectedVoice, voiceOptions } = useVoicePicker(botId);
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const plain = useSettingsSurface() === "plain";

  useEffect(() => () => { audio.current?.pause(); }, []);

  const own = botId ? settings.bots?.[botId] : undefined;
  const personTts = settings.tts ?? "auto";
  const personStt = settings.stt ?? "auto";
  const inheritLabel = (picked: string) => t("voiceProviders.inherit", { provider: picked === "auto" ? t("voiceProviders.auto") : label(picked) });
  const ttsValue: Pick<VoiceTtsProvider> = botId ? (own?.tts ?? "inherit") : personTts;
  const sttValue: Pick<VoiceSttProvider> = botId ? (own?.stt ?? "inherit") : personStt;

  const chooseTts = (next: Pick<VoiceTtsProvider>) => {
    setNote(null);
    if (!botId) writeVoiceProviders({ tts: next === "inherit" ? "auto" : next });
    else writeBotVoiceChoice(botId, { ...own, tts: next === "inherit" ? undefined : next });
  };
  const chooseStt = (next: Pick<VoiceSttProvider>) => {
    if (!botId) writeVoiceProviders({ stt: next === "inherit" ? "auto" : next });
    else writeBotVoiceChoice(botId, { ...own, stt: next === "inherit" ? undefined : next });
  };

  const test = async () => {
    setTesting(true);
    setNote(null);
    try {
      const clip = await testVoice(t("voiceProviders.sample"), view, botId);
      audio.current?.pause();
      const player = new Audio(URL.createObjectURL(clip));
      audio.current = player;
      player.onended = () => URL.revokeObjectURL(player.src);
      await player.play().catch(() => {});
    } catch (error) {
      setNote(t("voiceProviders.testFailed", { error: readableError(error) }));
    } finally {
      setTesting(false);
    }
  };

  // #2080 (L1): Auto says what it picked, in grey ("Auto picks xAI").
  const autoTts = ttsValue === "auto" || (ttsValue === "inherit" && personTts === "auto");
  const autoStt = sttValue === "auto" || (sttValue === "inherit" && personStt === "auto");
  const effective = (on: boolean, provider: string | undefined) => on && currentResolution && provider
    ? <span data-voice-effective={provider}>{t("voice.auto.effective", { provider: label(provider) })}</span>
    : undefined;

  const none = status !== null && !offeredTts.length && !offeredStt.length;
  const body = (
    <>
      {failed && (!status || !currentResolution) && <DescribedRow label={t("voiceProviders.tts")} description={failed} />}
      {none && <DescribedRow label={t("voiceProviders.tts")} description={t("voiceProviders.none")} />}
      {status && !none && (
        <>
          <DescribedRow label={t("voiceProviders.tts")} help={t("voiceProviders.fallbackNote")} description={effective(autoTts, status.tts)} rowId="voiceProviders.tts">
            <PillSelect<Pick<VoiceTtsProvider>>
              value={ttsValue}
              ariaLabel={t("voiceProviders.tts")}
              options={providerOptions(offeredTts, VOICE_TTS_PROVIDERS, ttsValue, botId ? inheritLabel(personTts) : null)}
              onChange={chooseTts}
            />
          </DescribedRow>
          <CompactRow label={t("voiceProviders.voice")} rowId="voiceProviders.voice">
            <span data-voice-provider-voice={speaking ?? ""} className="inline-flex min-w-0">
              <PillSelect
                value={selectedVoice}
                ariaLabel={t("voiceProviders.voiceOf", { provider: speaking ? label(speaking) : "" })}
                disabled={!speaking}
                options={voiceOptions}
                onChange={(voice) => { setNote(null); writeVoiceForBot(botId, voice, undefined, speaking); }}
              />
            </span>
            <button
              type="button"
              data-voice-provider-test=""
              onClick={() => void test()}
              disabled={testing || !speaking || !offeredTts.length}
              aria-label={t("voiceProviders.test")}
              className={cn(PILL, "gap-1.5 disabled:cursor-not-allowed")}
            >
              <Volume2 size={13} aria-hidden="true" /> {t("voiceProviders.test")}
            </button>
          </CompactRow>
          <DescribedRow label={t("voiceProviders.stt")} help={t("voiceProviders.sttHelp")} description={effective(autoStt, status.stt)} rowId="voiceProviders.stt">
            <PillSelect<Pick<VoiceSttProvider>>
              value={sttValue}
              ariaLabel={t("voiceProviders.stt")}
              options={providerOptions(offeredStt, VOICE_STT_PROVIDERS, sttValue, botId ? inheritLabel(personStt) : null)}
              onChange={chooseStt}
            />
          </DescribedRow>
        </>
      )}
      {note && <p role="alert" className={cn(plain ? "px-4" : "px-3.5", "pb-2 text-[12px] text-danger")}>{note}</p>}
    </>
  );

  if (bot) {
    // The bot's profile page (#2313): a plain card with its grey label.
    if (plain) return <div data-voice-providers="bot"><SettingsGroup title={t("voiceProviders.title")} groupId="botVoiceProviders">{body}</SettingsGroup></div>;
    return <div className={GROUP_CARD} data-voice-providers="bot">{body}</div>;
  }
  return (
    <div data-settings-card="voice.providers" data-voice-providers="person">
      <SettingsGroup title={t("voiceProviders.title")} groupId="voiceProviders">{body}</SettingsGroup>
    </div>
  );
}
