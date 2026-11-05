// Settings > Experimental, organization admins only (moved there 2026-10-27,
// from Organization): the phone call pilot (parité R13,
// ÉFVP 2026-10-22, server/outbound/outbound-calls.ts). Off until an admin turns it
// on; every call says the callback number set here, so none is placed
// without it; numbers on the do-not-call list are never called. Members do
// not get this section, and the server answers them 403. The callback number
// and the do-not-call list show only while the switch is on; what was typed
// or saved is kept (the rows are hidden, nothing is cleared).
import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { DescribedRow, FIELD, PILL, Switch } from "../SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

export interface PhoneCallSettings {
  enabled: boolean;
  callbackNumber?: string;
  doNotCall: string[];
}

/** "+15145550142" as "+1 514 555 0142". */
function shown(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `+1 ${match[1]} ${match[2]} ${match[3]}` : e164;
}

export function OrgPhoneCalls({ initial = null }: { initial?: PhoneCallSettings | null }) {
  const [settings, setSettings] = useState<PhoneCallSettings | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [callback, setCallback] = useState(initial?.callbackNumber ? shown(initial.callbackNumber) : "");
  const [blocked, setBlocked] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await api<{ settings: PhoneCallSettings }>("/api/org/phone-calls");
      setSettings(body.settings);
      setCallback(body.settings.callbackNumber ? shown(body.settings.callbackNumber) : "");
      setError(null);
    } catch (failure) {
      setError(readableError(failure));
    }
  }, []);
  useEffect(() => { if (!initial) void load(); }, [load, initial]);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const body = await api<{ settings: PhoneCallSettings }>("/api/org/phone-calls", { method: "PUT", body: JSON.stringify(patch) });
      setSettings(body.settings);
      return true;
    } catch (failure) {
      setError(readableError(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Rows of the Organization's bots card (2026-10-26): the pilot and
  // its switch, the callback number with a compact field, the do-not-call
  // list. A missing callback number is a warning line in its row.
  const field = cn(FIELD, "w-[170px] tabular-nums sm:w-[190px]");
  return (
    <div data-settings-card="organization.phoneCalls">
      <DescribedRow
        label={t("orgCalls.title")}
        rowId="phoneCalls"
        keywords={`${t("orgCalls.callback")} ${t("orgCalls.doNotCall")}`}
        description={(
          <>
            {t("orgCalls.intro")}
            {error && <span role="alert" className="mt-1 block text-danger">{error}</span>}
          </>
        )}
      >
        {settings && (
          <Switch data-org-calls-enabled="" checked={settings.enabled} disabled={busy} aria-label={t("orgCalls.enabled")} title={t("orgCalls.enabled")} onClick={() => void save({ enabled: !settings.enabled })} />
        )}
      </DescribedRow>
      {settings?.enabled && (
        <>
          <DescribedRow
            label={t("orgCalls.callback")}
            rowId="phoneCallsCallback"
            description={(
              <>
                {t("orgCalls.callbackHelp")}
                {!settings.callbackNumber && <span role="status" className="mt-0.5 block text-warning" data-org-calls-no-callback="">{t("orgCalls.noCallback")}</span>}
              </>
            )}
          >
            <input className={field} dir="ltr" value={callback} onChange={(event) => setCallback(event.target.value)} placeholder="+1 514 555 0100" aria-label={t("orgCalls.callback")} autoComplete="off" />
            <button type="button" className={PILL} disabled={busy || !callback.trim()} onClick={() => void save({ callbackNumber: callback })}>{t("orgCalls.save")}</button>
          </DescribedRow>
          <DescribedRow
            label={t("orgCalls.doNotCall")}
            rowId="phoneCallsDoNotCall"
            description={t("orgCalls.doNotCallHelp")}
            below={(
              <ul className="mt-2 flex flex-col" aria-label={t("orgCalls.doNotCall")}>
                {settings.doNotCall.map((number) => (
                  <li key={number} className="flex items-center justify-between gap-3 py-1.5 text-[13px] text-ink" data-do-not-call>
                    <span dir="ltr" className="tabular-nums">{shown(number)}</span>
                    <button type="button" className={PILL} disabled={busy} onClick={() => void save({ removeDoNotCall: number })}>{t("orgCalls.remove")}</button>
                  </li>
                ))}
                {!settings.doNotCall.length && <li className="py-1 text-[12px] leading-4 text-ink-secondary">{t("orgCalls.empty")}</li>}
              </ul>
            )}
          >
            <input className={field} dir="ltr" value={blocked} onChange={(event) => setBlocked(event.target.value)} placeholder="+1 514 555 0142" aria-label={t("orgCalls.addNumber")} autoComplete="off" />
            <button type="button" className={PILL} disabled={busy || !blocked.trim()} onClick={() => void save({ addDoNotCall: blocked }).then((ok) => { if (ok) setBlocked(""); })}>{t("orgCalls.add")}</button>
          </DescribedRow>
        </>
      )}
    </div>
  );
}
