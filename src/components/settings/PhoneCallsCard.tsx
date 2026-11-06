// Settings > Voice > Phone calls (#2080): same page for every organization
// member. The callback number and do-not-call list are set in Perspicax; Sagax
// shows the state only. Solo has no org phone-calls route, so the card stays
// hidden there (same gate as before on Experimental).
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { DescribedRow, SettingsGroup } from "../SettingsPrimitives";
import { RowValue, StatusText } from "./SettingsPatterns";
import type { PhoneCallSettings } from "./OrgPhoneCalls";

/** "+15145550142" as "+1 514 555 0142". */
function shown(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `+1 ${match[1]} ${match[2]} ${match[3]}` : e164;
}

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
  const callback = settings?.callbackNumber ? shown(settings.callbackNumber) : "";

  // #2080: one title (the group's); the state word on the row's grey line
  // as the neighbouring rows show theirs, the callback number as a plain
  // value at the right of its own row.
  return (
    <div data-settings-card="voice.phoneCalls">
      <SettingsGroup groupId="voicePhoneCalls" title={t("orgCalls.title")}>
        <DescribedRow
          label={t("orgCalls.enabled")}
          rowId="phoneCalls"
          help={t("orgCalls.intro")}
          keywords={`${t("orgCalls.callback")} ${t("orgCalls.doNotCall")}`}
          description={<>{t("voice.phoneCalls.orgReadonly")}{settings && <> · <StatusText tone={on ? "success" : "neutral"}>{t(on ? "settings.card.on" : "settings.card.off")}</StatusText></>}</>}
        />
        {settings && (
          <DescribedRow label={t("orgCalls.callback")} rowId="phoneCalls.callback" description={callback ? undefined : t("orgCalls.noCallback")}>
            {callback && <RowValue>{callback}</RowValue>}
          </DescribedRow>
        )}
      </SettingsGroup>
    </div>
  );
}
