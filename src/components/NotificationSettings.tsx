// Settings > Notifications: how a new message or a nudge gets this person's
// attention on THIS computer (src/lib/attention.ts decides, the desktop
// shell does it: electron/desktop-attention.mjs). Every switch is on by
// default and kept on this computer only. Which bots may notify at all is
// each bot's own setting, on the server.
// 0.5.6 (JC): laid out as Grok Bot's Notifications group (grey heading,
// compact rows, a switch each), with Privacy as the last group.
import { t } from "@/lib/i18n";
import {
  dockBadge,
  nudgeShake,
  approvalChime,
  persistentNotifications,
  setNotificationSounds,
  setNudgeSound,
  useLocalSwitch,
  useNotificationSounds,
  useNudgeSound,
} from "@/lib/notification-preferences";
import { NOTIFICATION_SOUND_CHOICES, notificationSoundChoice, playNotificationSound } from "@/lib/notification-sound";
import { CompactRow, DescribedRow, PillSelect, SettingsGroup, Switch } from "./SettingsPrimitives";
import { PrivacySettings } from "./PrivacySettings";
import { NotificationInvite } from "./NotificationInvite";

function ThisComputer() {
  return <span className="min-w-0 truncate text-[13px] leading-[18px] text-ink-secondary">· {t("settings.notifications.thisComputer")}</span>;
}

export function NotificationSettings({ privacy = false }: { privacy?: boolean }) {
  const sounds = useNotificationSounds();
  const persistent = useLocalSwitch(persistentNotifications);
  const badge = useLocalSwitch(dockBadge);
  const nudgeSound = useNudgeSound();
  const shake = useLocalSwitch(nudgeShake);
  const chime = useLocalSwitch(approvalChime);
  const soundChoice = notificationSoundChoice.use();
  return (
    <>
      <SettingsGroup title={t("settings.group.alerts")} groupId="alerts" accessory={<ThisComputer />}>
        {/* asks for the browser permission, only while it was never asked */}
        <NotificationInvite />
        <CompactRow label={t("settings.notificationSounds.title")} rowId="notificationSounds">
          <Switch checked={sounds} aria-label={t("settings.notificationSounds.play")} onClick={() => setNotificationSounds(!sounds)} />
        </CompactRow>
        {/* which sound, previewed when picked (drawn here: src/lib/notification-sound.ts) */}
        <CompactRow label={t("settings.notificationSound.title")} rowId="notificationSound">
          <PillSelect
            value={soundChoice}
            ariaLabel={t("settings.notificationSound.title")}
            disabled={!sounds}
            onChange={(next) => {
              notificationSoundChoice.set(next);
              playNotificationSound(next);
            }}
            options={NOTIFICATION_SOUND_CHOICES.map((id) => ({ value: id, label: t(`settings.notificationSound.${id}`) }))}
          />
        </CompactRow>
        {/* The one grey line kept: on macOS a Banner slides away whatever this says. */}
        <DescribedRow label={t("settings.notifications.persistent.title")} description={t("settings.notifications.persistent.mac")} rowId="persistentNotifications">
          <Switch checked={persistent} aria-label={t("settings.notifications.persistent.title")} onClick={() => persistentNotifications.set(!persistent)} />
        </DescribedRow>
        <CompactRow label={t("settings.notifications.badge.title")} rowId="dockBadge">
          <Switch checked={badge} aria-label={t("settings.notifications.badge.title")} onClick={() => dockBadge.set(!badge)} />
        </CompactRow>
        {/* the Approvals screen's arrival chime: its only switch */}
        <CompactRow label={t("settings.approvalChime.title")} rowId="approvalChime">
          <Switch checked={chime} aria-label={t("settings.approvalChime.title")} onClick={() => approvalChime.set(!chime)} />
        </CompactRow>
      </SettingsGroup>
      <SettingsGroup title={t("settings.group.nudges")} groupId="nudges" accessory={<ThisComputer />}>
        <CompactRow label={t("settings.nudgeSound.title")} rowId="nudgeSound">
          <Switch checked={nudgeSound} aria-label={t("settings.nudgeSound.title")} onClick={() => setNudgeSound(!nudgeSound)} />
        </CompactRow>
        <CompactRow label={t("settings.nudgeShake.title")} rowId="nudgeShake">
          <Switch checked={shake} aria-label={t("settings.nudgeShake.title")} onClick={() => nudgeShake.set(!shake)} />
        </CompactRow>
      </SettingsGroup>
      {/* Privacy (2026-10-14): what other people of the organization see. */}
      {privacy && (
        <div data-settings-card="notifications.privacy">
          <SettingsGroup title={t("settings.section.privacy")} groupId="privacy">
            <PrivacySettings />
          </SettingsGroup>
        </div>
      )}
    </>
  );
}
