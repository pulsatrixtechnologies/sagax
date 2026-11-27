// The usage detail opened by a click on the macOS menu-bar icon or the
// Windows notification-area icon (M-20261126-104): the same accounts table
// as the chat pill (UsageAccountsDetail), never Settings > Usage. Mounted
// once in the shell; the desktop bridge asks it to open.
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useEngineLimits } from "@/lib/limit-resets";
import { toggleUsageFavorite, useUsageFavorite } from "@/lib/usage-favorite";
import { allAccounts } from "@/lib/usage-pill";
import { usePlanRows } from "./ChatUsageNotices";
import { MENU_FIT_ROW, MENU_SURFACE } from "./menu-look";
import { UsageAccountsDetail } from "./UsageAccountsDetail";

/** Floating accounts table for the tray icon's click. */
export function UsageTrayDetailHost() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const rows = usePlanRows(open);
  const limits = useEngineLimits(open);
  const favorite = useUsageFavorite();

  useEffect(() => window.ogb?.onOpenUsageDetail?.(() => setOpen(true)), []);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!open) return null;
  const accounts = allAccounts(rows, limits);
  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" data-usage-tray-detail-host="">
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t("usageDetail.aria")}
        data-usage-tray-detail=""
        className={cn(
          MENU_SURFACE,
          MENU_FIT_ROW,
          "pointer-events-auto absolute right-4 top-4 w-[min(520px,calc(100vw-32px))] max-w-none shadow-lg",
        )}
      >
        {accounts.length > 0
          ? <UsageAccountsDetail accounts={accounts} favorite={{ id: favorite, onToggle: toggleUsageFavorite }} />
          : <p className="px-2 py-2 text-[13px] text-ink-secondary">{t("usageTrayDetail.empty")}</p>}
      </div>
    </div>
  );
}
