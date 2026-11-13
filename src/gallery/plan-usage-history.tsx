/** Isolated gallery for headless screenshots of the plan usage history
 * (#2757): Settings > Usage, its Usage limits group above the "Plan usage
 * history" fold, one week open with its 5-hour sessions. Mocked periods
 * only (12 weeks, three accounts, two of them "Claude"); no server.
 * Not shipped in the app.
 * ?skin=<id>&lang=<code>&account=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { UsageDetail } from "../components/UsageSection";
import { PlanUsageView } from "../components/PlanUsage";
import { PlanUsageHistoryView } from "../components/PlanUsageHistory";
import type { PlanUsageReport } from "../lib/plan-usage";
import type { PlanHistory, PlanPeriod } from "../lib/plan-history";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse("2026-11-07T15:00:00Z");
// The current weekly window of each account resets on these dates.
const RESETS: Record<string, number> = {
  "claude-max": Date.parse("2026-11-12T18:00:00Z"),
  "claude-pro": Date.parse("2026-11-10T09:00:00Z"),
  codex: Date.parse("2026-11-09T22:00:00Z"),
};
// Deterministic: the same pictures on every capture.
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const iso = (at: number) => new Date(at).toISOString();

const ACCOUNTS = [
  { id: "claude-max", name: "Claude", driver: "claude", plan: "max_20x" },
  { id: "claude-pro", name: "Claude", driver: "claude", plan: "pro" },
  { id: "codex", name: "Codex", driver: "codex", plan: "plus" },
];
// The weekly share per week, newest first: one week at the limit, one almost idle.
const WEEKS: Record<string, number[]> = {
  "claude-max": [46.4, 100, 88.2, 63, 71.5, 54, 92.7, 38, 0.3, 57, 66.1, 49],
  "claude-pro": [22, 41, 36.5, 18, 27],
  codex: [12.8, 9, 31, 4.2],
};

function period(account: (typeof ACCOUNTS)[number], window: "5-hour" | "weekly", resetsAt: number, peak: number, samples: number): PlanPeriod {
  const length = window === "weekly" ? 7 * DAY : 5 * H;
  const seen = Math.min(NOW, resetsAt - H);
  return {
    account: account.id, name: account.name, driver: account.driver, window,
    startsAt: iso(resetsAt - length), resetsAt: iso(resetsAt),
    peakPercent: peak, lastPercent: peak, firstSeenAt: iso(resetsAt - length + H), lastSeenAt: iso(seen), samples,
  };
}

const periods: PlanPeriod[] = [];
for (const account of ACCOUNTS) {
  WEEKS[account.id]!.forEach((weekly, index) => {
    const reset = RESETS[account.id]! - index * 7 * DAY;
    const start = reset - 7 * DAY;
    periods.push(period(account, "weekly", reset, weekly, 40 + Math.round(rand() * 120)));
    if (account.id === "codex") return;
    // 5-hour sessions on most working days of the week, busier when the week was.
    const count = weekly < 1 ? 1 : 4 + Math.round((weekly / 100) * 8 * rand() + 2);
    let at = start + 13 * H;
    for (let session = 0; session < count; session += 1) {
      const resets = at + 5 * H;
      if (resets > reset || at > NOW) break;
      const peak = weekly < 1 ? 0.2 : Math.round(Math.min(100, 18 + rand() * (weekly >= 100 ? 90 : 70)) * 10) / 10;
      periods.push(period(account, "5-hour", resets, session === 2 && weekly >= 100 ? 100 : peak, 3 + Math.round(rand() * 20)));
      at += (rand() < 0.5 ? 1 : 0.5) * DAY + Math.round(rand() * 4) * H;
    }
  });
}
periods.sort((left, right) => Date.parse(right.resetsAt) - Date.parse(left.resetsAt));
const history: PlanHistory = { updatedAt: iso(NOW), accounts: ACCOUNTS, periods };

const CLOSED = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
const open = (used: number, at: number) => ({ available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt: iso(at) });
const report: PlanUsageReport = {
  fetchedAt: iso(NOW),
  providers: [
    { id: "claude-max", name: "Claude", driver: "claude", plan: "max_20x", ok: true, error: null, state: "windows", access: "subscription", instanceId: "claude-max", fiveHour: open(34, NOW + 2 * H), weekly: open(46, RESETS["claude-max"]!) },
    { id: "claude-pro", name: "Claude", driver: "claude", plan: "pro", ok: true, error: null, state: "windows", access: "subscription", instanceId: "claude-pro", fiveHour: CLOSED, weekly: open(22, RESETS["claude-pro"]!) },
    { id: "codex", name: "Codex", driver: "codex", plan: "plus", ok: true, error: null, state: "windows", access: "subscription", instanceId: "codex", fiveHour: CLOSED, weekly: open(13, RESETS.codex!) },
  ],
} as PlanUsageReport;

const openWeek = `claude-max:${iso(RESETS["claude-max"]! - 7 * DAY)}`;

function Gallery() {
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div data-gallery-sample="usage" className="w-[680px]">
        <div className="flex flex-col gap-6">
          <PlanUsageView report={report} loading={false} now={NOW} onRefresh={() => {}} myEngines={null} issuer="" onOpenEngines={() => {}} />
          <UsageDetail
            planHistory={<PlanUsageHistoryView history={history} now={NOW} initialAccount={params.get("account") ?? undefined} initialOpen={[openWeek]} />}
          />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
