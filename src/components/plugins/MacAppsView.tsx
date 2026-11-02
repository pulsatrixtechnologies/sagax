// Connect apps > Mac: native apps that run only on this person's Mac.
import { ChevronRight, MessageSquare } from "lucide-react";

import { t } from "@/lib/i18n";
import { PluginPageHeader } from "./PluginParts";
import type { Crumb } from "../Breadcrumb";

type Props = {
  onBack: () => void;
  trail: Crumb[];
  onOpenMessages: () => void;
  messagesEnabled?: boolean;
  messagesAvailable?: boolean;
};

export function MacAppsView({ onBack, trail, onOpenMessages, messagesEnabled, messagesAvailable }: Props) {
  return (
    <>
      <PluginPageHeader title={t("connectApps.mac.title")} trail={trail} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-3 sm:px-8" data-mac-apps="">
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-secondary">{t("connectApps.mac.intro")}</p>
        <ul className="divide-y divide-hairline/60 rounded-2xl border border-border bg-card">
          <li>
            <button
              type="button"
              data-mac-app="messages"
              onClick={onOpenMessages}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <MessageSquare size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-ink">{t("connectApps.mac.messages.rowTitle")}</span>
                <span className="mt-0.5 block truncate text-[12px] text-ink-secondary">
                  {messagesAvailable === false
                    ? t("connectApps.mac.messages.rowUnavailable")
                    : messagesEnabled
                      ? t("connectApps.mac.messages.rowOn")
                      : t("connectApps.mac.messages.rowOff")}
                </span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-ink-secondary" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
    </>
  );
}

/** Compact Mac section for the Installed tab. */
export function MacAppsInstalledSection({
  onOpenMac,
  onOpenMessages,
  messagesEnabled,
}: {
  onOpenMac: () => void;
  onOpenMessages: () => void;
  messagesEnabled?: boolean;
}) {
  return (
    <section className="mt-6 first:mt-0" data-plugins-mac>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{t("connectApps.mac.section")}</h3>
        <button type="button" onClick={onOpenMac} className="text-[12px] font-medium text-accent-text hover:underline">
          {t("connectApps.mac.seeAll")}
        </button>
      </div>
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
