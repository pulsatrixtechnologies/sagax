// Settings > Notifications > Privacy (organization server): what other
// people learn about this person from Sagax: read receipts
// (server/messages/read-receipts.ts) and presence, online / away / offline
// (src/lib/presence.ts). Rows of the Privacy group; each keeps one grey line
// saying what turning it off costs.
import { t } from "@/lib/i18n";
import { setSendReadReceipts, useSendReadReceipts } from "@/lib/read-receipt-preference";
import { setPresenceVisible, usePresenceVisible } from "@/lib/presence";
import { DescribedRow, Switch } from "./SettingsPrimitives";

export function PrivacySettings() {
  const on = useSendReadReceipts();
  // on by default; off: offline with no last-seen time for everyone else
  const visible = usePresenceVisible();
  return (
    <>
      <DescribedRow label={t("settings.privacy.readReceipts.title")} description={t("settings.privacy.readReceipts.short")} rowId="readReceipts">
        <Switch checked={on} aria-label={t("settings.privacy.readReceipts.title")} onClick={() => setSendReadReceipts(!on)} />
      </DescribedRow>
      <DescribedRow label={t("settings.privacy.presence.title")} description={t("settings.privacy.presence.short")} rowId="presence">
        <Switch checked={visible} aria-label={t("settings.privacy.presence.title")} onClick={() => setPresenceVisible(!visible)} />
      </DescribedRow>
    </>
  );
}
