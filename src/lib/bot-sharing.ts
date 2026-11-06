import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";

/** "Sharing" in the summary: the grants when there are any, else who may
 * see it, else not shared. */
export function personaSharingSummary(bot: Bot): string {
  const grants = bot.grants?.length ?? bot.directGrants?.length ?? 0;
  if (grants > 0) return t("persona.overview.sharedCount", { count: String(grants) });
  if (bot.visibility === "everyone") return t("botSettings.visibility.everyone");
  if (bot.visibility === "admins") return t("botSettings.visibility.admins");
  if (bot.visibility && typeof bot.visibility === "object") return t("botSettings.visibility.people");
  return t("botSettings.sharing.empty");
}
