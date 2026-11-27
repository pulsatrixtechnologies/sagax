// The usage icon of the macOS menu bar and of the Windows notification area
// (#5407, electron/usage-tray.mjs draws it). This page hands the shell one
// small value: the week and the short session window as percents, and the
// figure written beside the icon. It does so when it loads, at the app's
// background cadence (PLAN_USAGE_REFRESH_MS, ten minutes), and at once each
// time the shell asks: the icon came on or was clicked, the window came back
// to the front, the account on screen changed.
//
// No limit is computed here: the rows are the ones GET /api/plan-usage
// already gives the account menu's Usage and Settings > Usage, and the
// figure is the account menu's own (usagePercent). `menuBarUsage` is the one
// place the figures come from: the sum over every account (#5406) replaces
// its body, nothing else changes.
import { usagePercent } from "./account-menu";
import { usageMenuBarChoice } from "./desktop-shell-preferences";
import { t } from "./i18n";
import { connectedPlanRows, PLAN_USAGE_REFRESH_MS, type PlanRow, type PlanUsageReport, type PlanWindow } from "./plan-usage";

/** What the icon shows. `week` and `session` are used percents (0 to 100),
 * null when no account reports that window; `text` is the figure beside the
 * icon ("44%"), empty when there is none. */
export interface MenuBarUsage {
  week: number | null;
  session: number | null;
  text: string;
}

function used(window: PlanWindow): number | null {
  if (!window.available || window.usedPercent == null || !Number.isFinite(window.usedPercent)) return null;
  return Math.round(Math.min(100, Math.max(0, window.usedPercent)));
}

function highest(rows: readonly PlanRow[], pick: (row: PlanRow) => PlanWindow): number | null {
  let top: number | null = null;
  for (const row of rows) {
    if (row.state !== "windows") continue;
    const value = used(pick(row));
    if (value !== null) top = top === null ? value : Math.max(top, value);
  }
  return top;
}

/** The icon's figures from the plan rows. Today: each window's highest
 * account, and the account menu's figure as the text. */
export function menuBarUsage(rows: readonly PlanRow[]): MenuBarUsage {
  const figure = usagePercent(rows);
  return {
    week: highest(rows, (row) => row.weekly),
    session: highest(rows, (row) => row.fiveHour),
    text: figure === null ? "" : t("usage.limits.figure", { percent: figure }),
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
  const row = rows.find((candidate) => candidate.state === "windows" && used(candidate.fiveHour) !== null);
  return row?.fiveHour.hours ?? 5;
}

export interface MenuBarUsageDeps {
  bridge?: NonNullable<NonNullable<Window["ogb"]>["usageTray"]>;
  read?: () => Promise<PlanUsageReport>;
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
  let asked = 0;
  const answer = async () => {
    if (!enabled()) return;
    const turn = ++asked;
    try {
      const rows = connectedPlanRows(await read());
      // a slower, older answer never replaces a newer one
      if (turn !== asked || !enabled()) return;
      const usage = menuBarUsage(rows);
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
