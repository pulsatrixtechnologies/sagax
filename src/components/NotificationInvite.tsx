// Settings > Notifications: "Let your bots notify you", one line with an
// Enable button, shown only while this browser was never asked. JC
// (2026-10-21, #876): never in the chat, only here.
import { useState } from "react";
import { requestNotificationPermission } from "@/lib/notify";
import { t } from "@/lib/i18n";
import { CompactRow, PILL } from "./SettingsPrimitives";

/** True while the browser has never been asked for notifications. */
export function shouldInviteNotifications(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "default";
}

export function NotificationInvite() {
  const [shown, setShown] = useState(shouldInviteNotifications);
  const [asking, setAsking] = useState(false);
  if (!shown) return null;
  // Whatever happens (granted, denied, closed, no prompt at all, or a
  // rejection), the row follows the permission the browser now reports.
  const settle = () => { setAsking(false); setShown(shouldInviteNotifications()); };
  const enable = () => {
    let request: Promise<NotificationPermission> | null;
    try {
      request = requestNotificationPermission();
    } catch {
      request = null;
    }
    if (!request) { settle(); return; }
    setAsking(true);
    request.then(settle, settle);
  };
  return (
    <div data-notification-invite="">
      <CompactRow label={t("notifications.invite.title")} rowId="notificationInvite">
        <button type="button" className={PILL} disabled={asking} onClick={enable}>
          {t("notifications.invite.enable")}
        </button>
      </CompactRow>
    </div>
  );
}
