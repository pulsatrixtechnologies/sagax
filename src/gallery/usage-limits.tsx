/** Isolated gallery for headless screenshots of Settings > Usage (#4418,
 * #4445): Usage limits (the spending limit, then one slim row per signed-in
 * account with its short window and its week) and the bots' usage below it.
 * Mocked accounts only: a signed-out provider and an API key are in the
 * report and must draw nothing. No server. Not shipped in the app.
 * ?skin=<id>&lang=<code>&accounts=<1|3|6>&failed=1 (one account whose read
 * failed)&width=<px> (375: phone width) */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SpendCapRow, UsageBreakdown, type PersonalUsage } from "../components/UsageSection";
import { PlanUsageView } from "../components/PlanUsage";
import type { PlanProvider, PlanUsageReport, PlanWindow } from "../lib/plan-usage";
import type { PersonalUsageSummary } from "../lib/usage-personal";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const H = 3_600_000;
const NOW = Date.parse("2026-11-16T15:00:00Z");
const iso = (at: number) => new Date(at).toISOString();
const CLOSED: PlanWindow = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
const open = (used: number, inHours: number, hours?: number): PlanWindow => ({ available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt: iso(NOW + inHours * H), ...(hours ? { hours } : {}) });

const account = (id: string, name: string, driver: string, plan: string, fiveHour: PlanWindow, weekly: PlanWindow): PlanProvider => ({
  id, name, driver, plan, ok: true, error: null, state: "windows", access: "subscription", instanceId: id, failure: null, fiveHour, weekly, extra: [], models: [],
});

const ALL: PlanProvider[] = [
  account("claude", "Personal", "claude", "max_20x", open(34, 2, 5), open(46, 92)),
  account("work", "Work", "claude", "pro", open(81, 4, 5), open(22, 40)),
  account("codex", "Codex", "codex", "plus", open(12, 3, 5), open(93, 18)),
  account("grok", "Grok", "grok", "Ultra", CLOSED, open(57, 120)),
  account("research", "Research", "codex", "pro", open(4, 1, 5), open(9, 150)),
  account("lab", "Lab", "claude", "max_5x", open(63, 5, 5), open(71, 60)),
];
const count = Math.min(6, Math.max(1, Number(params.get("accounts") ?? 3) || 3));
const FAILED: PlanProvider = {
  id: "backup", name: "Backup", driver: "codex", plan: "plus", ok: false, error: "Could not reach Codex: rate limited (429), try again in a minute", state: "error",
  access: "subscription", instanceId: "backup", failure: { kind: "http", status: 429 }, fiveHour: CLOSED, weekly: CLOSED, extra: [], models: [],
};
const width = Number(params.get("width")) || 680;
// ?scenario=owner: two Claude accounts on one login (one rate limited, one
// with its week used up), a Grok team account, a Codex account whose refresh
// failed after a good read (figures kept, "as of"). Invented names only.
const OWNER_EMAIL = "alex.martin@example.test";
const owner: PlanProvider[] = [
  { id: "work-a", name: OWNER_EMAIL, driver: "claude", plan: "business", ok: false, error: "Could not reach Claude: rate limited (429), try again in a minute", state: "error", access: "subscription", instanceId: "work-a", failure: { kind: "http", status: 429 }, fiveHour: CLOSED, weekly: CLOSED, extra: [], models: [] },
  account("work-b", OWNER_EMAIL, "claude", "business", open(64, 3, 5), open(100, 52)),
  account("grok-team", "Studio Grok team", "grok", "Ultra", CLOSED, open(57, 120)),
  { ...account("codex-lab", "sam.lee@example.test", "codex", "plus", open(12, 3, 5), open(41, 18)), ok: true, error: "Could not reach Codex: network error", failure: { kind: "network" }, staleSince: iso(NOW - 20 * 60_000) },
];
const scenario = params.get("scenario") === "owner";
const report: PlanUsageReport = {
  fetchedAt: iso(NOW),
  providers: [
    ...(scenario ? owner : ALL.slice(0, count)),
    ...(params.get("failed") === "1" && !scenario ? [FAILED] : []),
    // must draw nothing on Usage (#4418): connecting and keys live in Providers
    { id: "grok-2", name: "Grok", driver: "grok", plan: null, ok: false, error: "Not signed in", state: "signed-out", access: "subscription", instanceId: "grok-2", failure: null, fiveHour: CLOSED, weekly: CLOSED, extra: [], models: [] },
    { id: "claudeApi", name: "Claude (API key)", driver: "claude", plan: null, ok: true, error: null, state: "no-windows", access: "api-key", instanceId: "claudeApi", failure: null, fiveHour: CLOSED, weekly: CLOSED, extra: [], models: [] },
  ],
};

const days = Array.from({ length: 30 }, (_, index) => iso(NOW - (29 - index) * 24 * H).slice(0, 10));
const summary = (groups: Array<[string, string, number, number]>): PersonalUsageSummary => {
  const list = groups.map(([key, label, turns, costUsd]) => ({ key, label, turns, costUsd }));
  return { groups: list, total: { key: "total", label: "Total", turns: list.reduce((sum, group) => sum + group.turns, 0), costUsd: list.reduce((sum, group) => sum + (group.costUsd ?? 0), 0) } };
};
const daily = summary(days.map((day, index) => [day, day, 3 + (index % 5), Math.round((1.2 + Math.sin(index / 3) + (index % 7) * 0.4) * 100) / 100]));
const usage: PersonalUsage = {
  month: summary(days.slice(-16).map((day, index) => [day, day, 4 + index, 1.1 + index * 0.2])),
  previous: summary([["x", "x", 80, 31.4]]),
  days30: daily,
  byBot: summary([["a", "Assistant", 120, 18.2], ["b", "Research bot", 64, 9.7], ["c", "Reviewer", 22, 3.1]]),
  byModel: summary([["m1", "Model one", 140, 21.5], ["m2", "Model two", 66, 9.5]]),
};
const engineGroups: Array<{ key: string; label: string; turns: number; costUsd: number | null }> = [
  { key: "engine:claudeAgent", label: "claudeAgent", turns: 1525, costUsd: 839.9 },
  { key: "engine:grokAgent", label: "grokAgent", turns: 212, costUsd: 41.3 },
  { key: "engine:codex", label: "codex", turns: 96, costUsd: 12.07 },
  { key: "engine:xai-voice", label: "xai-voice", turns: 38, costUsd: null },
  { key: "engine:grok", label: "grok", turns: 540, costUsd: null },
  { key: "engine:openai-compat", label: "openai-compat", turns: 20, costUsd: null },
  { key: "engine:piAgent", label: "piAgent", turns: 7, costUsd: null },
];
const byEngine: PersonalUsageSummary = { groups: engineGroups, total: { key: "total", label: "Total", turns: 2438, costUsd: 893.27 } };
const ENGINE_NAMES: Record<string, string> = { claudeAgent: "Claude Code", grokAgent: "Grok Build", codex: "Codex", grok: "Grok API" };
const cap = { supported: true, minUsd: 1, cap: { month: "2026-11", monthlyUsd: 60, spentUsd: 31, percent: 52, warn: false, exceeded: false } };

function Gallery() {
  return (
    <div className={width < 500 ? "min-h-screen bg-app px-4 py-8 text-ink" : "min-h-screen bg-app p-8 text-ink"}>
      <div data-gallery-sample="usage" style={{ width }}>
        <div className="flex min-w-0 flex-col gap-6">
          <PlanUsageView report={report} loading={false} now={NOW} onRefresh={() => {}} favorite={{ id: scenario ? "work-a" : "claude", onToggle: () => {} }} leading={<SpendCapRow data={cap} now={NOW} />} />
          <UsageBreakdown usage={usage} initialSegment="source" detail={{ total: usage.month, byBot: usage.byBot, byModel: usage.byModel, byEngine }} engineName={(driver) => ENGINE_NAMES[driver] ?? null} />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
