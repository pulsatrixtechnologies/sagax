// Settings > Computer > Your computer, on an organization server (0.5.6:
// The reference design's Computer page). Each bot's Works on decides (Auto and
// Cloud: the person's server environment; Local VM and This computer: their
// own computer through this desktop app); here, rows of the "Your computer"
// group: its execution access, which destinations bots may reach
// through it (with whether it is connected), the person's registered devices,
// and, behind a discreet link, what bots recently did there (#555)
// (src/lib/desktop-bridge.ts, server/desktop/desktop-bridge.ts).
import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import { myDevices, setComputerAccess, readWorkplace, useDesktopBridgeStatus, writeWorkplace, type DesktopBridgeActivity, type DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { MyDevicesList } from "../remote-session/MyDevicesList";
import { DEFAULT_BOT_WORKPLACE, type BotWorkplace } from "../../../shared/bot-workplace";
import { DescribedRow, PillSelect, SettingsGroup, Switch } from "../SettingsPrimitives";

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
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessError, setAccessError] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [workplace, setWorkplace] = useState<BotWorkplace>(() => {
    if (given?.workplace) return given.workplace;
    try { return readWorkplace(); } catch { return { ...DEFAULT_BOT_WORKPLACE }; }
  });
  useEffect(() => { if (status?.workplace) setWorkplace(status.workplace); }, [status?.workplace?.network, status?.workplace?.networkDevice]);
  if (!status) return null;
  const change = (next: Partial<BotWorkplace>) => {
    const value = { ...workplace, ...next };
    setWorkplace(value);
    writeWorkplace(value);
  };
  const devices = myDevices(status);
  const current = devices.find((device) => device.kind === "computer" && device.current);
  const routingHere = workplace.network !== "off" && (workplace.networkDevice
    ? workplace.networkDevice === current?.key
    : status.networkDesktopId === undefined || status.networkDesktopId === current?.desktopId);
  return (
    <div data-settings-card="organization.botWorkplace" data-desktop-connected={status.connected ? "yes" : "no"}>
      {current?.access && (
        <DescribedRow label={t("botWorkplace.execution")} description={t("botWorkplace.executionHint")} rowId="execution"
          below={accessError && <span role="alert" className="text-danger">{t("computer.change.failed")}</span>}>
          <PillSelect value={current.access} disabled={savingAccess} ariaLabel={t("botWorkplace.execution")}
            options={[
              { value: "always", label: t("myDevices.access.always") },
              { value: "ask", label: t("myDevices.access.ask") },
              { value: "never", label: t("myDevices.access.never") },
            ]}
            onChange={async (access) => {
              setSavingAccess(true);
              setAccessError(false);
              try { await setComputerAccess(current.desktopId ?? current.name, access); }
              catch { setAccessError(true); }
              finally { setSavingAccess(false); }
            }} />
        </DescribedRow>
      )}
      <DescribedRow
        label={t("botWorkplace.routeTraffic")}
        icon={<Link2 size={14} />}
        description={<>{t(workplace.network === "lan" ? "botWorkplace.network.lan" : "botWorkplace.routeTrafficHint")} {status.routedThisSession !== undefined && t("botWorkplace.routed", { count: status.routedThisSession })}</>}
        rowId="network"
      >
        <Switch checked={routingHere} disabled={!current} aria-label={t("botWorkplace.routeTraffic")}
          onClick={() => change({ network: routingHere ? "off" : "all", networkDevice: current?.key })} />
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

export function ManageComputerDevices({ status }: { status: DesktopBridgeStatus }) {
  const devices = myDevices(status);
  if (!devices.length) return null;
  return (
    <SettingsGroup groupId="manageDevices" title={t("myDevices.settings.manage")}>
      <div role="table" aria-label={t("myDevices.settings.manage")} className="@container/remote px-3.5">
        <MyDevicesList devices={devices} />
      </div>
    </SettingsGroup>
  );
}
