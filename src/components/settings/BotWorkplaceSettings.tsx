// Settings > Computer > Your computer, on an organization server (0.5.6:
// The reference design's Computer page). Each bot's Works on decides (Auto and
// Cloud: the person's server environment; Local VM and This computer: their
// own computer through this desktop app); here, rows of the "Your computer"
// group: whether routines may use it, which destinations bots may reach
// through it (with whether it is connected), a pointer to the person's
// devices (Remote sessions, the one place for them),
// and, behind a discreet link, what bots recently did there (#555)
// (src/lib/desktop-bridge.ts, server/desktop/desktop-bridge.ts).
import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import { myDevices, readWorkplace, useDesktopBridgeStatus, writeWorkplace, type DesktopBridgeActivity, type DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { useStoreOptional } from "@/state/store";
import { DEFAULT_BOT_WORKPLACE, type BotWorkplace } from "../../../shared/bot-workplace";
import { DescribedRow, PILL, PillSelect, Switch } from "../SettingsPrimitives";

function when(ms: number): string {
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
}

export function activityLine(entry: DesktopBridgeActivity): string {
  const where = entry.target === "user-desktop" ? t("botWorkplace.activity.computer") : entry.target === "user-sandbox" ? t("botWorkplace.activity.server") : t("botWorkplace.activity.direct");
  // a connection's detail is the platform and host name: never shown
  const what = entry.kind === "connect" ? t("botWorkplace.activity.connected") : entry.detail;
  return `${what} · ${where}${entry.ok ? "" : ` · ${t("botWorkplace.activity.failed")}`}`;
}

export function BotWorkplaceSettings({ status: given }: { status?: DesktopBridgeStatus } = {}) {
  const polled = useDesktopBridgeStatus(15_000);
  const status = given ?? polled;
  const [showActivity, setShowActivity] = useState(false);
  const [workplace, setWorkplace] = useState<BotWorkplace>(() => {
    if (given?.workplace) return given.workplace;
    try { return readWorkplace(); } catch { return { ...DEFAULT_BOT_WORKPLACE }; }
  });
  useEffect(() => { if (status?.workplace) setWorkplace(status.workplace); }, [status?.workplace?.routines, status?.workplace?.network]);
  const store = useStoreOptional();
  if (!status) return null;
  const change = (next: Partial<BotWorkplace>) => {
    const value = { ...workplace, ...next };
    setWorkplace(value);
    writeWorkplace(value);
  };
  const devices = myDevices(status);
  return (
    <div data-settings-card="organization.botWorkplace" data-desktop-connected={status.connected ? "yes" : "no"}>
      <DescribedRow label={t("botWorkplace.routinesShort")} description={t("botWorkplace.routinesHint")} rowId="routines">
        <Switch checked={workplace.routines} aria-label={t("botWorkplace.routines")} onClick={() => change({ routines: !workplace.routines })} />
      </DescribedRow>
      <DescribedRow
        label={t("botWorkplace.network")}
        icon={<Link2 size={14} />}
        description={<span role="status">{t(status.connected ? "botWorkplace.status.connected" : "botWorkplace.status.notConnected")}</span>}
        rowId="network"
      >
        <PillSelect
          value={workplace.network}
          ariaLabel={t("botWorkplace.network")}
          onChange={(network) => change({ network })}
          options={[
            { value: "all", label: t("botWorkplace.network.all") },
            { value: "lan", label: t("botWorkplace.network.lan") },
          ]}
        />
      </DescribedRow>
      {/* One option, one place: the devices and what bots may do with each
          live in Remote sessions > Enrolled hosts (2026-11-07). */}
      <DescribedRow label={t("myDevices.title")} description={t("myDevices.settings.hint")} rowId="myDevices">
        <span className="flex items-center gap-2">
          {devices.length > 0 && <span className="text-[12px] text-ink-secondary" data-my-devices-count="">{devices.length}</span>}
          {store && (
            <button type="button" data-my-devices-manage="" className={PILL} onClick={() => store.dispatch({ type: "showRemoteSessions" })}>
              {t("myDevices.settings.manage")}
            </button>
          )}
        </span>
      </DescribedRow>
      {status.activity.length > 0 && (
        <div className="flex flex-col gap-1 px-3.5 pb-2 pt-1" data-bot-activity={showActivity ? "open" : "closed"}>
          <button type="button" aria-expanded={showActivity} onClick={() => setShowActivity((open) => !open)}
            className="min-h-[44px] self-start rounded-md text-[12px] text-ink-secondary hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 md:min-h-0">
            {showActivity ? t("botWorkplace.activity.hide") : t("botWorkplace.activity.show")}
          </button>
          {showActivity && (
            <ul className="flex flex-col gap-0.5 text-[12px]" aria-label={t("botWorkplace.activity")}>
              {status.activity.slice(0, 10).map((entry, index) => (
                <li key={`${entry.at}-${index}`} className={entry.ok ? "text-ink" : "text-danger"}>
                  <span className="text-ink-secondary">{when(entry.at)}</span> {activityLine(entry)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
