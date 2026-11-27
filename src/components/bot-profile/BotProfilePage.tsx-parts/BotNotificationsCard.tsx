// #5445 [M-20261127-070]: General > Notifications on the bot page.
// Reuses the existing "Notify me when this bot finishes or needs me" row,
// the daily brief card, and the reviews this bot holds. Stable group id
// `bot-profile-notifications` so the UI-customize botPage zone (PR2) can
// register it like Channels and Accounts.
import { Bell } from "lucide-react";
import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { SETTINGS_SWITCH_SEARCH_WORDS } from "@/lib/persona-search";
import { NotifyMeRow } from "../../bot-settings/VoiceSection";
import { BackgroundBriefCard } from "../../bot-settings/BackgroundBriefCard";
import { BotReviewRows } from "../../bot-settings/BotBriefReviewsRows";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { ProfileCard } from "./cards";

export function BotNotificationsCard({ bot, derived, notifyShown }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  /** False when voice is locked or hidden: the notify row stays off. */
  notifyShown: boolean;
}) {
  return (
    <ProfileCard title={t("botProfile.group.notifications")} groupId="bot-profile-notifications">
      {notifyShown && (
        <NotifyMeRow
          bot={bot}
          derived={derived}
          icon={<Bell strokeWidth={1.5} />}
          keywords={SETTINGS_SWITCH_SEARCH_WORDS.notifyMe.join(" · ")}
        />
      )}
      <BackgroundBriefCard botId={bot.id} embedded />
      <BotReviewRows botId={bot.id} botName={bot.name} />
    </ProfileCard>
  );
}
