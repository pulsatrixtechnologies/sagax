// #2636 (JC 2026-11-07): the one discreet line an origin page keeps after its
// technical options moved to Settings > Developer. One grey sentence with
// the page's name as a link, under the page's cards, the way SettingsText
// renders a settings link everywhere else.
//
// #2658: with a bot, the link opens Developer > Per bot on that bot (the bot
// page's Advanced sub-page and Folder and memory keep this line).
import { requestDeveloperBot } from "@/lib/developer-bot-request";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { SettingsText } from "../SettingsLink";

export function DeveloperLink({ bot }: { bot?: Bot }) {
  if (!bot) {
    return (
      <p data-developer-link="" className="px-1 text-[12px] text-ink-secondary">
        <SettingsText text={t("settings.developer.link")} links={{ developer: { section: "developer" } }} />
      </p>
    );
  }
  return (
    <p data-developer-link="" data-developer-bot={bot.id} className="px-1 text-[12px] text-ink-secondary">
      <SettingsText text={t("settings.developer.link")} links={{ developer: { section: "developer", cardId: "developer.bot", prepare: () => requestDeveloperBot(bot.id) } }} />
    </p>
  );
}
