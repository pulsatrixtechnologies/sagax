// The usage icon of the macOS menu bar and of the Windows notification area
// (#5407, electron/usage-tray.mjs draws it; M-20261126-104: the same sum as
// the chat pill). This page hands the shell one small value: the week and
// the short session window as percents, and the figure written beside the
// icon. It does so when it loads, at the app's background cadence
// (PLAN_USAGE_REFRESH_MS, ten minutes), and at once each time the shell asks:
// the icon came on or was clicked, the window came back to the front, the
// account on screen changed.
//
// No limit is computed here: the rows are the ones GET /api/plan-usage
// already gives the account menu's Usage and Settings > Usage, the limit
// report is GET /api/limit-resets, and the figures come from `accountsUsage`
// (src/lib/usage-pill.ts), the same sum the chat pill uses. `menuBarUsage`
// is the one place the icon's figures come from. The icon itself stays two
// small bars (week and 5 h, D-20261127-014).
import type { EngineLimit } from "../../shared/limit-reset";
import { usageMenuBarChoice } from "./desktop-shell-preferences";
import { t } from "./i18n";
import { connectedPlanRows, PLAN_USAGE_REFRESH_MS, type PlanRow, type PlanUsageReport } from "./plan-usage";
import { accountsUsage } from "./usage-pill";

/** What the icon shows. `week` and `session` are used percents (0 to 100),
 * null when no account reports that window; `text` is the figure beside the
 * icon ("44%"), empty when there is none. */
export interface MenuBarUsage {
  week: number | null;
  session: number | null;
  text: string;
}

/** The icon's figures from the plan rows: every signed-in account together,
 * the same sum as the chat pill (M-20261126-104, #5421). */
export function menuBarUsage(rows: readonly PlanRow[], limits: readonly EngineLimit[] = []): MenuBarUsage {
  const values = accountsUsage(rows, limits);
  return {
    week: values.week,
    session: values.fiveHour,
    text: values.named === null ? "" : t("usage.limits.figure", { percent: values.named.percent }),
  };
}

/** The tooltip's short detail: "week 44%, 5 h 20%". Empty with no figure. */
export function menuBarUsageDetail(usage: MenuBarUsage, hours = 5): string {
  const parts: string[] = [];
  if (usage.week !== null) parts.push(t("menuBarUsage.week", { figure: t("usage.limits.figure", { percent: usage.week }) }));
  if (usage.session !== null) parts.push(t("menuBarUsage.session", { hours, figure: t("usage.limits.figure", { percent: usage.session }) }));
  return parts.join(", ");
}

/** The short window's length as the vendor sets it (five hours unless a row says otherwise). */
function sessionHours(rows: readonly PlanRow[]): number {
  const row = rows.find((candidate) => candidate.state === "windows" && candidate.fiveHour.available && candidate.fiveHour.usedPercent != null);
  return row?.fiveHour.hours ?? 5;
}

export interface MenuBarUsageDeps {
  bridge?: NonNullable<NonNullable<Window["ogb"]>["usageTray"]>;
  read?: () => Promise<PlanUsageReport>;
  /** The limit report's engines (blocked accounts count as full in the sum). */
  readLimits?: () => Promise<readonly EngineLimit[]>;
  enabled?: () => boolean;
  setIntervalImpl?: (fn: () => void, ms: number) => unknown;
  clearIntervalImpl?: (timer: never) => void;
}

/** Hand the figures to the shell: now, every ten minutes, and each time the
 * shell asks. Nothing is read while the switch is off. */
export function installMenuBarUsage(deps: MenuBarUsageDeps = {}): () => void {
  const bridge = deps.bridge ?? (typeof window === "undefined" ? undefined : window.ogb?.usageTray);
  if (!bridge) return () => {};
  const enabled = deps.enabled ?? (() => usageMenuBarChoice.get() === "true");
  const read = deps.read ?? (async () => (await import("@/state/store")).api<PlanUsageReport>("/api/plan-usage"));
  const readLimits = deps.readLimits ?? (async () => {
    try {
      const { api } = await import("@/state/store");
      const report = await api<{ engines?: EngineLimit[] }>("/api/limit-resets");
      return Array.isArray(report.engines) ? report.engines : [];
    } catch {
      return [];
    }
  });
  let asked = 0;
  const answer = async () => {
    if (!enabled()) return;
    const turn = ++asked;
    try {
      const [report, limits] = await Promise.all([read(), readLimits()]);
      // a slower, older answer never replaces a newer one
      if (turn !== asked || !enabled()) return;
      const rows = connectedPlanRows(report);
      const usage = menuBarUsage(rows, limits);
      bridge.update({ ...usage, tooltip: menuBarUsageDetail(usage, sessionHours(rows)) });
    } catch {
      // not signed in yet, or the server is away: the icon keeps what it shows
    }
  };
  // this page just loaded: the icon may already be waiting for its figures
  void answer();
  const timer = (deps.setIntervalImpl ?? setInterval)(() => void answer(), PLAN_USAGE_REFRESH_MS);
  const unlisten = bridge.onRefresh(() => void answer());
  return () => {
    (deps.clearIntervalImpl ?? clearInterval)(timer as never);
    unlisten();
  };
}
