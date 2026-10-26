import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { BotSharer } from "@/lib/bot-sharer";
import { PersonAvatar } from "./MessageAuthor";

/** The face of the person who shared a bot, on its avatar's bottom-right
 * corner (Browse Bots' creator badge). Absolute, so it never takes room from
 * the name; the id is never shown, only the name in the tooltip. */
export function SidebarSharerBadge({ sharer, avatarSize, className }: { sharer: BotSharer; avatarSize: number; className?: string }) {
  const size = Math.max(14, Math.round(avatarSize * 0.4));
  return (
    <span
      data-sidebar-sharer=""
      role="img"
      aria-label={t("sidebar.bot.sharedBy", { name: sharer.name })}
      title={t("sidebar.bot.sharedBy", { name: sharer.name })}
      className={cn("absolute -bottom-0.5 -right-0.5 flex rounded-full ring-2 ring-sidebar", className)}
    >
      <PersonAvatar avatarUrl={sharer.avatarUrl} initials={sharer.initials} size={size} />
    </span>
  );
}
