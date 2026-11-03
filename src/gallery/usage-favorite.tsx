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
import { PlanUsageView } from "../components/PlanUsage";
import { usageLines, usageSummary } from "../lib/account-menu";
import { connectedPlanRows, type PlanUsageReport } from "../lib/plan-usage";
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
    { id: "grok", name: "Grok", driver: "grok", plan: "SuperGrok Heavy", ok: true, error: null, state: "windows", access: "subscription", instanceId: "grok", fiveHour: CLOSED, weekly: open(87, 56) },
    { id: "codex", name: "Codex", driver: "codex", plan: "self_serve_business_prolite", ok: true, error: null, state: "windows", access: "subscription", instanceId: "codex", fiveHour: CLOSED, weekly: open(100, 71) },
  ],
};

function Gallery() {
  const favorite = useUsageFavorite();
  const rows = connectedPlanRows(report);
  const summary = usageSummary(rows, favorite);
  const lines = usageLines(rows, {
    weekly: t("planUsage.weekly"),
    fiveHour: t("planUsage.fiveHour"),
    used: (used) => t("planUsage.used", { used }),
    resetsIn: (when) => t("planUsage.resetsIn", { when }),
  }, NOW);
  const items: SidebarMenuItem[] = [{
    key: "usage",
    label: t("sidebar.account.usage"),
    icon: <Gauge size={18} />,
    value: summary.percent === null ? undefined : summary.name
      ? t("sidebar.account.usageFavorite", { name: summary.name, used: summary.percent })
      : t("planUsage.used", { used: summary.percent }),
    submenu: [
      ...lines.map((line, index) => ({
        key: line.key, label: line.label, subtitle: line.subtitle, value: line.value, info: true,
        ...(lines.findIndex((other) => other.planId === line.planId) === index ? {
          favorite: {
            on: favorite === line.planId,
            label: t(favorite === line.planId ? "usage.favorite.remove" : "usage.favorite.add", { name: line.planName ?? line.label }),
            onToggle: () => toggleUsageFavorite(line.planId!),
          },
        } : {}),
      })),
      { key: "month-cost", label: t("sidebar.account.monthCost"), value: "5,26 $", info: true },
      { key: "view-usage", label: t("sidebar.account.viewUsage"), separatorBefore: true, onSelect: () => {} },
    ],
    submenuWidth: 228,
    onSelect: () => {},
  }];
  return (
    <div className="flex min-h-screen gap-10 bg-app p-8 text-ink">
      <div data-gallery-sample="menu" className="relative w-[260px] pt-[260px]" style={{ height: 420 }}>
        <SidebarPopoverMenu items={items} ariaLabel="Account" renderTrigger={() => <span className="block rounded-lg px-2 py-1.5 text-left">Alex Morgan</span>} />
      </div>
      <div data-gallery-sample="page" className="ml-[340px] w-[420px] pt-[120px]">
        <PlanUsageView report={report} loading={false} now={NOW} onRefresh={() => {}} myEngines={null} issuer="" onOpenEngines={() => {}} favorite={{ id: favorite, onToggle: toggleUsageFavorite }} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
