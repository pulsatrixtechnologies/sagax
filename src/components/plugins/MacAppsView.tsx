// Plugins > Installed > This Mac: the Apple apps of this person's Mac, one row
// each (Messages, Mail, Calendar, Contacts, Reminders, Notes). Each row opens
// its setup page. Shown only in the desktop app on macOS (macAppsSectionVisible).
import { BookUser, CalendarDays, ChevronRight, ListChecks, Mail, MessageSquare, StickyNote, type LucideIcon } from "lucide-react";

import { t } from "@/lib/i18n";
import { MAC_APP_SETUP_IDS, type MacAppSetupId, type MacAppsSetupStatus } from "../../../shared/mac-apps-setup.ts";
import { PLUGINS } from "./plugins-style";

/** Icon and tile color of each app (close to the macOS app icons). */
export const MAC_APP_LOOK: Record<MacAppSetupId, { icon: LucideIcon; tile: string }> = {
  messages: { icon: MessageSquare, tile: "#34C759" },
  mail: { icon: Mail, tile: "#1F8BFF" },
  calendar: { icon: CalendarDays, tile: "#FF3B30" },
  contacts: { icon: BookUser, tile: "#8E8E93" },
  reminders: { icon: ListChecks, tile: "#FF9500" },
  notes: { icon: StickyNote, tile: "#E8B500" },
};

const MAC_APP_NAME_KEYS = {
  messages: "connectApps.mac.messages.rowTitle",
  mail: "connectApps.mac.mail.rowTitle",
  calendar: "connectApps.mac.calendar.rowTitle",
  contacts: "connectApps.mac.contacts.rowTitle",
  reminders: "connectApps.mac.reminders.rowTitle",
  notes: "connectApps.mac.notes.rowTitle",
} as const;

export function macAppName(app: MacAppSetupId): string {
  return t(MAC_APP_NAME_KEYS[app]);
}

/** Compact This Mac section for the Installed tab: one row per Apple app. */
export function MacAppsInstalledSection({
  status,
  onOpen,
}: {
  status: MacAppsSetupStatus | null;
  onOpen: (app: MacAppSetupId) => void;
}) {
  return (
    <section className="mt-8 first:mt-0" data-plugins-mac>
      <h3 className={PLUGINS.label}>{t("connectApps.mac.section")}</h3>
      <ul className={`${PLUGINS.grid} mt-1`}>
        {MAC_APP_SETUP_IDS.map((app) => {
          const look = MAC_APP_LOOK[app];
          const Icon = look.icon;
          const enabled = status?.apps.find((row) => row.id === app)?.enabled === true;
          return (
            <li key={app}>
              <button
                type="button"
                data-mac-app={app}
                data-mac-app-enabled={enabled ? "true" : "false"}
                onClick={() => onOpen(app)}
                className="-mx-3 flex w-[calc(100%+24px)] items-center gap-3 rounded-[14px] px-3 py-[11px] text-left hover:bg-hover"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-white" style={{ background: look.tile }}>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={PLUGINS.rowName}>{macAppName(app)}</span>
                  <span className={PLUGINS.rowSub}>
                    {enabled ? t("connectApps.mac.messages.rowOn") : t("connectApps.mac.messages.rowOff")}
                  </span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-ink-secondary" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
