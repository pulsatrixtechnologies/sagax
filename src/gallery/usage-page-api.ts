/** The stand-in answers of Settings > Usage for the Settings gallery
 * (src/gallery/settings-pages.tsx, #4095): the person's cost this month and
 * last month, by bot, by model and by source, a spending limit, and the plan
 * windows of one engine (`usage=one`), three engines (`usage=three`) or three
 * engines with one that could not be read (`usage=error`). Fictional data
 * only, neutral names; the dates follow the clock so the month is current.
 * Returns undefined for a path it does not answer. */
export function usagePageAnswer(url: URL, params: URLSearchParams): unknown {
  const mode = params.get("usage");
  if (!mode) return undefined;
  const now = Date.now();
  const H = 3_600_000;
  const iso = (at: number) => new Date(at).toISOString();
  if (url.pathname === "/api/me/usage") return usageSummary(url);
  if (url.pathname === "/api/me/spend-cap") {
    return { supported: true, minUsd: 1, cap: { month: iso(now).slice(0, 7), monthlyUsd: 150, spentUsd: 61.2, percent: 41, warn: false, exceeded: false } };
  }
  if (url.pathname === "/api/plan-usage/history") return { updatedAt: iso(now), accounts: [], periods: [] };
  if (url.pathname === "/api/plan-usage") {
    const open = (used: number, at: number) => ({ available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt: iso(at) });
    const closed = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
    const first = { id: "claude", name: "Claude", driver: "claude", plan: "max_20x", ok: true, error: null, state: "windows", access: "subscription", instanceId: "claude", fiveHour: open(34, now + 2 * H + 12 * 60_000), weekly: open(46, now + 4 * 24 * H + 5 * H) };
    const second = { id: "codex", name: "Codex", driver: "codex", plan: "plus", ok: true, error: null, state: "windows", access: "subscription", instanceId: "codex", fiveHour: open(12, now + 3 * H + 40 * 60_000), weekly: open(9, now + 6 * 24 * H) };
    const third = mode === "error"
      ? { id: "grok", name: "Grok", driver: "grok", plan: "supergrok", ok: false, error: null, state: "error", access: "subscription", instanceId: "grok", failure: { kind: "timeout", seconds: 8 }, fiveHour: closed, weekly: closed }
      : { id: "grok", name: "Grok", driver: "grok", plan: "supergrok", ok: true, error: null, state: "windows", access: "subscription", instanceId: "grok", fiveHour: closed, weekly: open(71, now + 2 * 24 * H + 7 * H) };
    return { fetchedAt: iso(now), providers: mode === "one" ? [first] : [first, second, third] };
  }
  return undefined;
}

const BOTS: [string, string, number, number][] = [
  ["bot-0", "Scout", 28.4, 412],
  ["bot-1", "Atlas", 17.9, 236],
  ["bot-2", "Juniper", 9.35, 141],
  ["bot-3", "Harbor", 3.1, 58],
  ["bot-4", "Beacon", 1.6, 31],
  ["bot-5", "Quill", 0.85, 12],
];
const MODELS: [string, string, number, number][] = [
  ["claude/opus", "Claude Opus 4.1", 31.2, 288],
  ["claude/sonnet", "Claude Sonnet 4.5", 18.6, 402],
  ["codex/gpt-5", "GPT-5", 7.4, 119],
  ["grok/grok-4", "Grok 4", 4.0, 81],
];
const ENGINES: [string, string, number, number][] = [
  ["claude", "Claude", 49.8, 690],
  ["codex", "Codex", 7.4, 119],
  ["grok", "Grok", 4.0, 81],
];

function usageSummary(url: URL) {
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const groupBy = url.searchParams.get("groupBy") ?? "day";
  // last month reads about 85% of this month, so the trend shows
  const thisMonth = from.slice(0, 7) === new Date().toISOString().slice(0, 7);
  const scale = thisMonth ? 1 : 0.85;
  const rows = (list: [string, string, number, number][]) => list.map(([key, label, cost, turns]) => ({ key, label, turns: Math.round(turns * scale), costUsd: Math.round(cost * scale * 100) / 100 }));
  let groups: { key: string; label: string; turns: number; costUsd: number }[];
  if (groupBy === "bot") groups = rows(BOTS);
  else if (groupBy === "model") groups = rows(MODELS);
  else if (groupBy === "engine") groups = rows(ENGINES);
  else {
    groups = [];
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    let index = 0;
    for (let at = start; Number.isFinite(at) && at <= end; at += 86_400_000, index += 1) {
      const day = new Date(at).toISOString().slice(0, 10);
      const weekday = new Date(at).getUTCDay();
      const cost = weekday === 0 || weekday === 6 ? 0.6 + (index % 3) * 0.4 : 1.4 + ((index * 7) % 5) * 0.9;
      groups.push({ key: `day:${day}`, label: day, turns: Math.round(cost * 14), costUsd: Math.round(cost * scale * 100) / 100 });
    }
  }
  const costUsd = Math.round(groups.reduce((sum, group) => sum + group.costUsd, 0) * 100) / 100;
  const turns = groups.reduce((sum, group) => sum + group.turns, 0);
  return { groups, total: { key: "total", label: "Total", turns, costUsd } };
}
