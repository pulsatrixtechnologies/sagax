// Voice & alerts: this bot's spoken-reply voice and its desktop/phone
// notifications. Moved verbatim from SettingsPanel.tsx (VoiceSettings
// mount ~1026, Notifications ~1028-1046).
import { t } from "@/lib/i18n";
import { requestNotificationPermission } from "@/lib/notify";
import { useStore, type Bot } from "@/state/store";
import { saveViewerBotOverride, useViewerBotOverride, viewerLocalBotSettings } from "@/lib/viewer-bot-overrides";
import { DescribedRow, SettingsGroup, Switch } from "../SettingsPrimitives";
import { VoiceProviderSettings } from "../settings/VoiceProviderSettings";
import { VoiceSettings } from "../VoiceSettings";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";
import { useBotEditor } from "./BotEditorContext";

export function VoiceSection({
  bot,
  derived,
}: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
}) {
  const { patch } = derived;
  const { draft, bulk, mixedFields } = useBotEditor();
  const { state, dispatch } = useStore();
  // Bot-wide read-aloud and voice-note switches follow edit rights. The
  // provider, voice, ears and notifications remain this person's own.
  const showVoice = !derived.canEdit || derived.canEdit("voice");
  const viewerLocal = viewerLocalBotSettings(state.config, bot);
  const override = useViewerBotOverride(bot.id, viewerLocal);
  const notifications = viewerLocal && override?.notifications !== undefined ? override.notifications : bot.notifications !== false;
  const notificationsMixed = Boolean(bulk && mixedFields?.has("notifications"));

  return (
    <div className="flex flex-col gap-5">
      {/* Each card carries its own grey label: on the bot's profile page
          the voice card takes the rail's label, "Voice" (#2313). */}
      {/* 2026-10-29: this bot's voice provider, voice and ears, for this person */}
      {showVoice && <VoiceSettings bot={bot} onPatch={patch} providers={!draft} />}
      {!showVoice && !draft && <VoiceProviderSettings bot={bot} />}

      <SettingsGroup title={t("botPanel.remote.notifications")} groupId="botNotifications">
        <DescribedRow
          label={t("botPanel.voice.notifyHelp")}
          description={viewerLocal ? t("botPanel.voice.notifyForYou") : undefined}
        >
          <Switch
          checked={notifications}
          mixed={notificationsMixed}
          aria-label={t("botPanel.voice.notifyHelp")}
          onClick={() => {
            const enabled = notificationsMixed ? true : !notifications;
            if (enabled && !draft) void requestNotificationPermission();
            if (viewerLocal) {
              void saveViewerBotOverride(bot.id, { notifications: enabled }).then((ok) => {
                if (!ok) dispatch({ type: "error", message: t("botPanel.viewerLocal.saveError") });
              });
              return;
            }
            patch({ notifications: enabled });
          }}
          />
        </DescribedRow>
      </SettingsGroup>
    </div>
  );
}
