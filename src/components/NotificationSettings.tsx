// Settings > Notifications: how a new message or a nudge gets this person's
// attention on THIS computer (src/lib/attention.ts decides, the desktop
// shell does it: electron/desktop-attention.mjs). Every switch is on by
// default and kept on this computer only. Which bots may notify at all is
// each bot's own setting, on the server.
// #2080 L2: one Alerts card (sound selector with None, nudges folded) and one
// Privacy card (org rows when hosted, blocked people always, reports for an
// admin). The page intro carries "on this computer"; no accessory repeat.
import { useState } from "react";
import { t } from "@/lib/i18n";
import {
  dockBadge,
  nudgeShake,
  approvalChime,
  connectionNotices,
  persistentNotifications,
  setNotificationSounds,
  setNudgeSound,
  useLocalSwitch,
  useNotificationSounds,
  useNudgeSound,
} from "@/lib/notification-preferences";
import { NOTIFICATION_SOUND_CHOICES, notificationSoundChoice, playNotificationSound, type NotificationSound } from "@/lib/notification-sound";
import { CompactRow, DescribedRow, PillSelect, SettingsGroup, Switch } from "./SettingsPrimitives";
import { PrivacySettings } from "./PrivacySettings";
import { NotificationInvite } from "./NotificationInvite";
import { BlockedPeopleRow, ReportsRow } from "./settings/ModerationSettings";
import { DisclosurePill } from "./settings/AppearanceSettings";

const SOUND_NONE = "none";
type SoundSelect = typeof SOUND_NONE | NotificationSound;

function SoundRow() {
  const sounds = useNotificationSounds();
  const soundChoice = notificationSoundChoice.use();
  const value: SoundSelect = sounds ? soundChoice : SOUND_NONE;
  return (
    <CompactRow label={t("settings.notificationSound.title")} rowId="notificationSound">
      <PillSelect
        value={value}
        ariaLabel={t("settings.notificationSound.title")}
        onChange={(next) => {
          if (next === SOUND_NONE) {
            setNotificationSounds(false);
            return;
          }
          setNotificationSounds(true);
          notificationSoundChoice.set(next);
          playNotificationSound(next);
        }}
        options={[
          { value: SOUND_NONE, label: t("settings.notificationSound.none") },
          ...NOTIFICATION_SOUND_CHOICES.map((id) => ({ value: id, label: t(`settings.notificationSound.${id}`) })),
        ]}
      />
    </CompactRow>
  );
}

/** Nudges fold under one row: sound and window shake stay available. */
function NudgesRow() {
  const [open, setOpen] = useState(false);
  const nudgeSound = useNudgeSound();
  const shake = useLocalSwitch(nudgeShake);
  return (
    <DescribedRow
      label={t("settings.group.nudges")}
      description={t("settings.notifications.nudges.summary")}
      rowId="nudges"
      below={open ? (
        <div className="mt-2 flex flex-col" data-nudges-rows="">
          <CompactRow label={t("settings.nudgeSound.title")} rowId="nudgeSound">
            <Switch checked={nudgeSound} aria-label={t("settings.nudgeSound.title")} onClick={() => setNudgeSound(!nudgeSound)} />
          </CompactRow>
          <CompactRow label={t("settings.nudgeShake.title")} rowId="nudgeShake">
            <Switch checked={shake} aria-label={t("settings.nudgeShake.title")} onClick={() => nudgeShake.set(!shake)} />
          </CompactRow>
        </div>
      ) : undefined}
    >
      <DisclosurePill open={open} onToggle={() => setOpen((value) => !value)} label={t("settings.group.nudges")}>
        {t(open ? "settings.appearance.hide" : "settings.appearance.show")}
      </DisclosurePill>
    </DescribedRow>
  );
}

export function NotificationSettings({ privacy = false }: { privacy?: boolean }) {
  const persistent = useLocalSwitch(persistentNotifications);
  const badge = useLocalSwitch(dockBadge);
  const chime = useLocalSwitch(approvalChime);
  const connection = useLocalSwitch(connectionNotices);
  return (
    <>
      <SettingsGroup title={t("settings.group.alerts")} groupId="alerts">
        <NotificationInvite />
        <SoundRow />
        <DescribedRow label={t("settings.notifications.persistent.title")} description={t("settings.notifications.persistent.mac")} rowId="persistentNotifications">
          <Switch checked={persistent} aria-label={t("settings.notifications.persistent.title")} onClick={() => persistentNotifications.set(!persistent)} />
        </DescribedRow>
        <CompactRow label={t("settings.notifications.badge.title")} rowId="dockBadge">
          <Switch checked={badge} aria-label={t("settings.notifications.badge.title")} onClick={() => dockBadge.set(!badge)} />
        </CompactRow>
        <CompactRow label={t("settings.approvalChime.title")} rowId="approvalChime">
          <Switch checked={chime} aria-label={t("settings.approvalChime.title")} onClick={() => approvalChime.set(!chime)} />
        </CompactRow>
        <DescribedRow label={t("settings.connectionNotices.title")} description={t("settings.connectionNotices.description")} rowId="connectionNotices">
          <Switch checked={connection} aria-label={t("settings.connectionNotices.title")} onClick={() => connectionNotices.set(!connection)} />
        </DescribedRow>
        <NudgesRow />
      </SettingsGroup>
      {/* Privacy always hosts blocked people; org read-receipts/presence only when
          the privacy section is allowed (organization server). ReportsRow hides
          itself when the viewer is not an admin (#2080). */}
      <div data-settings-card="notifications.privacy">
        <SettingsGroup title={t("settings.section.privacy")} groupId="privacy">
          {privacy && <PrivacySettings />}
          <BlockedPeopleRow />
          <ReportsRow />
        </SettingsGroup>
      </div>
    </>
  );
}
