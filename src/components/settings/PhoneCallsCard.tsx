// Settings > Voice > Phone calls (#2080): same page for every organization
// member. The do-not-call list is set in Perspicax; Sagax shows the state
// only. Every call is a live conversation that opens with the AI disclosure
// (#4193): no callback number is said nor needed, so none is shown. Solo
// has no org phone-calls route, so the card stays hidden there (same gate
// as before on Experimental).
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { DescribedRow, SettingsGroup } from "../SettingsPrimitives";
import { StatusText } from "./SettingsPatterns";
import type { PhoneCallSettings } from "./OrgPhoneCalls";

export function PhoneCallsCard() {
  const org = usePerspicaxOrg();
  const [settings, setSettings] = useState<PhoneCallSettings | null>(null);

  useEffect(() => {
    if (!org) return;
    let alive = true;
    void api<{ settings: PhoneCallSettings }>("/api/org/phone-calls")
      .then((body) => { if (alive) setSettings(body.settings); })
      .catch(() => { if (alive) setSettings(null); });
    return () => { alive = false; };
  }, [org]);

  if (!org) return null;

  const on = Boolean(settings?.enabled);

  // #2080: one title (the group's); the state word on the row's grey line
  // as the neighbouring rows show theirs.
  return (
    <div data-settings-card="voice.phoneCalls">
      <SettingsGroup groupId="voicePhoneCalls" title={t("orgCalls.title")}>
        <DescribedRow
          label={t("orgCalls.enabled")}
          rowId="phoneCalls"
          help={t("orgCalls.intro")}
          keywords={t("orgCalls.doNotCall")}
          description={<>{t("voice.phoneCalls.orgReadonly")}{settings && <> · <StatusText tone={on ? "success" : "neutral"}>{t(on ? "settings.card.on" : "settings.card.off")}</StatusText></>}</>}
        />
      </SettingsGroup>
    </div>
  );
}
