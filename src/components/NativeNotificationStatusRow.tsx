// Settings > Notifications, desktop app only: whether the system really shows
// Sagax notifications (macOS Notification Center, Windows), a test button,
// and a shortcut to the system notification settings (#2385).
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { DescribedRow, PILL } from "./SettingsPrimitives";

type Bridge = NonNullable<Window["ogb"]>;

function bridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const ogb = window.ogb;
  return ogb?.notificationStatus && ogb.testNotification ? ogb : null;
}

export function nativeNotificationDescription(status: NativeNotificationStatus | null): string {
  if (status?.state === "delivered") return t("settings.notifications.native.delivered");
  if (status?.state === "not-delivered") return t("settings.notifications.native.notDelivered");
  return t("settings.notifications.native.unknown");
}

export function NativeNotificationStatusRow() {
  const ogb = bridge();
  const [status, setStatus] = useState<NativeNotificationStatus | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    if (!ogb) return;
    let live = true;
    ogb.notificationStatus!().then((next) => { if (live) setStatus(next); }, () => undefined);
    return () => { live = false; };
  }, [ogb]);
  if (!ogb) return null;
  const test = () => {
    setTesting(true);
    ogb.testNotification!({ title: t("settings.notifications.native.testTitle"), body: t("settings.notifications.native.testBody") })
      .then((next) => { if (next) setStatus(next); }, () => undefined)
      .finally(() => setTesting(false));
  };
  return (
    <div data-native-notification-status={status?.state ?? "unknown"}>
      <DescribedRow
        label={t("settings.notifications.native.title")}
        description={nativeNotificationDescription(status)}
        rowId="nativeNotifications"
      >
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={PILL} disabled={testing} onClick={test}>
            {t("settings.notifications.native.test")}
          </button>
          {status?.settings && ogb.openNotificationSettings ? (
            <button type="button" className={PILL} onClick={() => { void ogb.openNotificationSettings!(); }}>
              {t("settings.notifications.native.open")}
            </button>
          ) : null}
        </div>
      </DescribedRow>
    </div>
  );
}
