// Settings > Organization, admins only: the phone call pilot (parité R13,
// ÉFVP 2026-10-22, server/outbound-calls.ts). Off until an admin turns it
// on; every call says the callback number set here, so none is placed
// without it; numbers on the do-not-call list are never called. Members do
// not get this section, and the server answers them 403.
import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { FIELD, PILL, PRIMARY_PILL, SettingsGroup, SettingsNotice, SettingsTextRow } from "../SettingsPrimitives";

interface PhoneCallSettings {
  enabled: boolean;
  callbackNumber?: string;
  doNotCall: string[];
}

/** "+15145550142" as "+1 514 555 0142". */
function shown(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `+1 ${match[1]} ${match[2]} ${match[3]}` : e164;
}

export function OrgPhoneCalls() {
  const [settings, setSettings] = useState<PhoneCallSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callback, setCallback] = useState("");
  const [blocked, setBlocked] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await api<{ settings: PhoneCallSettings }>("/api/org/phone-calls");
      setSettings(body.settings);
      setCallback(body.settings.callbackNumber ? shown(body.settings.callbackNumber) : "");
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const body = await api<{ settings: PhoneCallSettings }>("/api/org/phone-calls", { method: "PUT", body: JSON.stringify(patch) });
      setSettings(body.settings);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-settings-card="organization.phoneCalls">
      <SettingsGroup title={t("orgCalls.title")} groupId="organization.phoneCalls">
        <SettingsTextRow>{t("orgCalls.intro")}</SettingsTextRow>
        {error && <SettingsNotice tone="danger">{error}</SettingsNotice>}
        {settings && (
          <>
            <label className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-[13px] text-ink">
              {t("orgCalls.enabled")}
              <input type="checkbox" data-org-calls-enabled checked={settings.enabled} disabled={busy} onChange={(event) => void save({ enabled: event.target.checked })} />
            </label>
            <div className="flex flex-col gap-2 px-3.5 py-2.5">
              <span className="text-[12px] text-ink-secondary">{t("orgCalls.callbackHelp")}</span>
              <div className="flex gap-2">
                <input className={FIELD} dir="ltr" value={callback} onChange={(event) => setCallback(event.target.value)} placeholder="+1 514 555 0100" aria-label={t("orgCalls.callback")} autoComplete="off" />
                <button type="button" className={PRIMARY_PILL} disabled={busy || !callback.trim()} onClick={() => void save({ callbackNumber: callback })}>{t("orgCalls.save")}</button>
              </div>
              {!settings.callbackNumber && <SettingsNotice tone="warning">{t("orgCalls.noCallback")}</SettingsNotice>}
            </div>
            <div className="flex flex-col gap-2 px-3.5 py-2.5">
              <span className="text-[13px] text-ink">{t("orgCalls.doNotCall")}</span>
              <span className="text-[12px] text-ink-secondary">{t("orgCalls.doNotCallHelp")}</span>
              {settings.doNotCall.map((number) => (
                <div key={number} className="flex items-center justify-between gap-2 text-[13px]" data-do-not-call>
                  <span dir="ltr">{shown(number)}</span>
                  <button type="button" className={PILL} disabled={busy} onClick={() => void save({ removeDoNotCall: number })}>{t("orgCalls.remove")}</button>
                </div>
              ))}
              {!settings.doNotCall.length && <span className="text-[12px] text-ink-secondary">{t("orgCalls.empty")}</span>}
              <div className="flex gap-2">
                <input className={FIELD} dir="ltr" value={blocked} onChange={(event) => setBlocked(event.target.value)} placeholder="+1 514 555 0142" aria-label={t("orgCalls.addNumber")} autoComplete="off" />
                <button type="button" className={PILL} disabled={busy || !blocked.trim()} onClick={() => void save({ addDoNotCall: blocked }).then((ok) => { if (ok) setBlocked(""); })}>{t("orgCalls.add")}</button>
              </div>
            </div>
          </>
        )}
      </SettingsGroup>
    </div>
  );
}
