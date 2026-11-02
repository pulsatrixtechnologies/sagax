import { ArrowDown, ArrowUp } from "lucide-react";
import { t } from "@/lib/i18n";
import type { SidebarDensity } from "@/lib/sidebar-preferences";

export function SidebarUnreadPillAbove({
  density,
  count,
  onJump,
}: {
  density: SidebarDensity;
  count: number;
  onJump: () => void;
}) {
  if (density === "icons" || count <= 0) return null;
  return (
    <div className="relative z-10 h-0">
      <button type="button" data-sidebar-more-unread="above" onClick={onJump}
        aria-label={t("sidebar.unreadAbove", { count })}
        className="absolute left-1/2 top-1 flex whitespace-nowrap -translate-x-1/2 items-center gap-1 rounded-full bg-unread px-2.5 py-1 text-[12px] font-medium leading-4 text-accent-ink shadow-md hover:brightness-110">
        <ArrowUp size={12} aria-hidden="true" />{t("sidebar.unreadAbove", { count })}
      </button>
    </div>
  );
}

export function SidebarUnreadPillBelow({
  density,
  count,
  onJump,
}: {
  density: SidebarDensity;
  count: number;
  onJump: () => void;
}) {
  if (density === "icons" || count <= 0) return null;
  return (
    <div className="relative z-10 h-0">
      <button type="button" data-sidebar-more-unread="below" onClick={onJump}
        aria-label={t("sidebar.unreadBelow", { count })}
        className="absolute bottom-2 left-1/2 flex whitespace-nowrap -translate-x-1/2 items-center gap-1 rounded-full bg-unread px-2.5 py-1 text-[12px] font-medium leading-4 text-accent-ink shadow-md hover:brightness-110">
        <ArrowDown size={12} aria-hidden="true" />{t("sidebar.unreadBelow", { count })}
      </button>
    </div>
  );
}
