// Plugins > Installed > This Mac: native apps that run only on this
// person's Mac. One section with the one row (Messages); the separate Mac
// page and its "See all" went with #2104 (same row twice).
import { ChevronRight, MessageSquare } from "lucide-react";

import { t } from "@/lib/i18n";

/** Compact Mac section for the Installed tab: the one row (Messages) opens
 * its setup directly; no "See all" to a page with the same row (#2104). */
export function MacAppsInstalledSection({
  onOpenMessages,
  messagesEnabled,
}: {
  onOpenMessages: () => void;
  messagesEnabled?: boolean;
}) {
  return (
    <section className="mt-6 first:mt-0" data-plugins-mac>
      <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.mac.section")}</h3>
      <ul className="divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
        <li>
          <button
            type="button"
            data-mac-app="messages"
            onClick={onOpenMessages}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <MessageSquare size={16} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{t("connectApps.mac.messages.rowTitle")}</span>
              <span className="block truncate text-[11.5px] text-ink-secondary">
                {messagesEnabled ? t("connectApps.mac.messages.rowOn") : t("connectApps.mac.messages.rowOff")}
              </span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </section>
  );
}
