// Activity > Voice chat (reference design, #2125): three rows with a pill
// select on the right. Voice is the person's own pick for this bot (the same
// one Settings > Voice & alerts writes, useVoicePicker); Speed and Language
// are the bot's own fields (voiceSpeed, voiceLanguage), synced by the server
// and applied to the bot's speech. Notifications stay in Settings > Voice & alerts.
import type { Bot } from "@/state/store";
import { PANEL_CARD, PANEL_LABEL } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { speedLabel, writeVoiceForBot } from "@/lib/voice-mode/settings";
import { VOICE_MODE_LANGUAGES, VOICE_MODE_SPEEDS } from "../../../shared/voice-mode";
import { PillSelect, type PillOption } from "../SettingsPrimitives";
import { useVoicePicker } from "../settings/VoiceProviderSettings";

type VoiceChatPatch = Partial<Pick<Bot, "voiceSpeed" | "voiceLanguage">>;

export function voiceSpeedOptions(current: number): Array<PillOption<string>> {
  const speeds = VOICE_MODE_SPEEDS.includes(current as (typeof VOICE_MODE_SPEEDS)[number]) ? [...VOICE_MODE_SPEEDS] : [...VOICE_MODE_SPEEDS, current].sort((a, b) => a - b);
  return speeds.map((speed) => ({ value: String(speed), label: speedLabel(speed) }));
}

export function voiceLanguageOptions(): Array<PillOption<string>> {
  return VOICE_MODE_LANGUAGES.map((language) => ({
    value: language.code,
    label: language.code === "auto" ? t("voiceMode.autoDetect") : language.label,
  }));
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className={cn("flex items-center justify-between gap-3 px-3 py-1.5")}>
      <span className="min-w-0 truncate text-[14px] leading-5 text-ink">{label}</span>
      <span className="flex min-w-0 shrink-0 items-center justify-end">{children}</span>
    </div>
  );
}

export function VoiceChatCard({ bot, onPatch, readOnly = false }: { bot: Bot; onPatch: (patch: VoiceChatPatch) => void; readOnly?: boolean }) {
  const { speaking, selectedVoice, voiceOptions } = useVoicePicker(bot.id);
  const speed = bot.voiceSpeed ?? 1;
  const language = bot.voiceLanguage ?? "auto";
  return (
    <section data-bot-settings-section="voice-chat" aria-labelledby={`bot-voice-chat-${bot.id}`} className="flex flex-col gap-2">
      <h3 id={`bot-voice-chat-${bot.id}`} className={PANEL_LABEL}>{t("botPanel.voiceChat.title")}</h3>
      <div className={cn(PANEL_CARD, "py-1")}>
        <Row label={t("voiceMode.voice")}>
          <span data-voice-chat="voice" className="inline-flex min-w-0">
            <PillSelect
              value={selectedVoice}
              ariaLabel={t("voiceMode.voice")}
              disabled={!speaking}
              bordered
              options={voiceOptions}
              onChange={(voice) => { writeVoiceForBot(bot.id, voice, undefined, speaking); }}
            />
          </span>
        </Row>
        <Row label={t("voiceMode.speed")}>
          <span data-voice-chat="speed" className="inline-flex min-w-0">
            <PillSelect
              value={String(speed)}
              ariaLabel={t("voiceMode.speed")}
              disabled={readOnly}
              bordered
              options={voiceSpeedOptions(speed)}
              onChange={(value) => onPatch({ voiceSpeed: Number(value) })}
            />
          </span>
        </Row>
        <Row label={t("voiceMode.language")}>
          <span data-voice-chat="language" className="inline-flex min-w-0">
            <PillSelect
              value={language}
              ariaLabel={t("voiceMode.language")}
              disabled={readOnly}
              bordered
              options={voiceLanguageOptions()}
              onChange={(value) => onPatch({ voiceLanguage: value })}
            />
          </span>
        </Row>
      </div>
    </section>
  );
}
