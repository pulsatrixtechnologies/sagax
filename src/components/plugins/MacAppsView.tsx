// Plugins > Installed > This Mac: native apps that run only on this
// person's Mac. One section with the one row (Messages); the separate Mac
// page and its "See all" went with #2104 (same row twice).
import { ChevronRight, MessageSquare } from "lucide-react";

import { t } from "@/lib/i18n";
import { PLUGINS } from "./plugins-style";

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
    <section className="mt-8 first:mt-0" data-plugins-mac>
      <h3 className={PLUGINS.label}>{t("connectApps.mac.section")}</h3>
      <ul className="mt-1">
        <li>
          <button
            type="button"
            data-mac-app="messages"
            onClick={onOpenMessages}
            className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-xl px-2 py-[11px] text-left hover:bg-hover"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-success/90 text-white">
              <MessageSquare size={18} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={PLUGINS.rowName}>{t("connectApps.mac.messages.rowTitle")}</span>
              <span className={PLUGINS.rowSub}>
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
