// Org phone-call pilot form (parité R13, EFVP 2026-10-22,
// server/outbound/outbound-calls.ts). Settings > Voice shows a read-only
// status card for every org member (#2080); this editable form stays for the
// gallery and layout tests until Perspicax owns the admin editor. Off until
// turned on; numbers on the do-not-call list are never called; the
// do-not-call row shows only while on. Every call is a live conversation
// that opens with the AI disclosure (#4193): no callback number is said nor
// needed, so none is shown or asked (a saved one stays on disk).
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
  const [blocked, setBlocked] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await api<{ settings: PhoneCallSettings }>("/api/org/phone-calls");
      setSettings(body.settings);
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
  // its switch, then the do-not-call list.
  const field = cn(FIELD, "w-[170px] tabular-nums sm:w-[190px]");
  return (
    <div data-settings-card="organization.phoneCalls">
      <DescribedRow
        label={t("orgCalls.title")}
        rowId="phoneCalls"
        keywords={t("orgCalls.doNotCall")}
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
