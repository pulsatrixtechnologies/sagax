/** Isolated gallery for Playwright screenshots of the starred subscription
 * (2026-11-03): the account menu's Usage › with its stars and the
 * favorite's name on the Usage row, and Settings > Usage's plan card with
 * the same stars. Mocked plan rows only; the capture opens the menu. Not
 * shipped in the app.
 * ?skin=<id>&lang=<code>&favorite=<plan id, empty for none> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Gauge } from "lucide-react";
import { SidebarPopoverMenu, type SidebarMenuItem } from "../components/SidebarPopoverMenu";
import { AccountLimits, PlanUsageView } from "../components/PlanUsage";
import { usageSummary } from "../lib/account-menu";
import { accountRowName, connectedPlanRows, type PlanUsageReport } from "../lib/plan-usage";
import { toggleUsageFavorite, useUsageFavorite, writeUsageFavorite } from "../lib/usage-favorite";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
writeUsageFavorite(params.has("favorite") ? params.get("favorite") : "grok");

const NOW = Date.parse("2026-11-03T12:00:00Z");
const CLOSED = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
const open = (used: number, hours: number) => ({ available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt: new Date(NOW + hours * 3_600_000).toISOString() });
const report: PlanUsageReport = {
  providers: [
    { id: "grok", name: "Grok", driver: "grok", plan: "Ultra", ok: true, error: null, state: "windows", access: "subscription", instanceId: "grok", fiveHour: CLOSED, weekly: open(87, 56) },
    { id: "codex", name: "Codex", driver: "codex", plan: "self_serve_business_prolite", ok: true, error: null, state: "windows", access: "subscription", instanceId: "codex", fiveHour: CLOSED, weekly: open(100, 71) },
  ],
};

function Gallery() {
  const favorite = useUsageFavorite();
  const rows = connectedPlanRows(report);
  const summary = usageSummary(rows, favorite);
  const items: SidebarMenuItem[] = [{
    key: "usage",
    label: t("sidebar.account.usage"),
    icon: <Gauge size={18} />,
    value: summary.percent === null ? undefined : t("usage.limits.figure", { percent: summary.percent }),
    tooltip: summary.percent === null ? undefined : summary.account
      ? t("sidebar.account.usageTooltip", { account: summary.account, percent: summary.percent })
      : t("sidebar.account.usageTooltipBare", { percent: summary.percent }),
    submenu: [
      ...rows.filter((row) => row.state === "windows").map((row) => ({
        key: row.id, label: accountRowName(row),
        node: <AccountLimits provider={row} name={accountRowName(row)} favorite={{ id: favorite, onToggle: toggleUsageFavorite }} />,
      })),
      { key: "month-cost", label: t("sidebar.account.monthCost"), value: "5,26 $", info: true, foot: true },
      { key: "view-usage", label: t("sidebar.account.viewUsage"), separatorBefore: true, foot: true, onSelect: () => {} },
    ],
    submenuWidth: 320,
    onSelect: () => {},
  }];
  return (
    <div className="flex min-h-screen gap-10 bg-app p-8 text-ink">
      <div data-gallery-sample="menu" className="relative w-[260px] pt-[260px]" style={{ height: 420 }}>
        <SidebarPopoverMenu items={items} ariaLabel="Account" renderTrigger={() => <span className="block rounded-lg px-2 py-1.5 text-left">Alex Morgan</span>} />
      </div>
      <div data-gallery-sample="page" className="ml-[340px] w-[420px] pt-[120px]">
        <PlanUsageView report={report} loading={false} now={NOW} onRefresh={() => {}} favorite={{ id: favorite, onToggle: toggleUsageFavorite }} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
