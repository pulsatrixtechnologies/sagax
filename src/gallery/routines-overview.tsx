/** Isolated gallery for the Routines page (2026-11-17): the Overview tab with
 * its Runs figures and its table, on neutral fictional bots and routines; a
 * mocked fetch answers the page's reads so nothing connects. Not shipped.
 * ?tab=overview|logs|calendar &groupBy=none|bot|folder &period=day|week|month
 * &filters=1 (the Filters popover open) &empty=1 &quiet=1 (no failed run)
 * &width=<px> &height=<px> &lang=<code> &skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RoutinesPage } from "../components/RoutineCalendarPage";
import { loadLocale } from "../lib/i18n";
import { ROUTINE_GROUP_BY_KEY, ROUTINE_GROUPS_COLLAPSED_KEY } from "../lib/routine-grouping";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type AppState, type Bot } from "../state/store";
import type { Routine, RoutineRun } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const width = Number(params.get("width") ?? 1440);
const height = Number(params.get("height") ?? 900);
try {
  localStorage.setItem(ROUTINE_GROUP_BY_KEY, JSON.stringify({ pr_viewer: params.get("groupBy") ?? "none" }));
  const collapsed = params.get("collapsed");
  localStorage.setItem(ROUTINE_GROUPS_COLLAPSED_KEY, JSON.stringify(collapsed ? { pr_viewer: collapsed.split(",").map((id) => `bot:${id}`) } : {}));
} catch { /* a blocked storage: the defaults */ }

const NOW = Date.now();
const H = 3_600_000;
const quiet = params.get("quiet") === "1";
const empty = params.get("empty") === "1";
const bot = (id: string, name: string, color: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color, notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "grok", model: "grok-4" }, ...extra,
} as unknown as Bot);
const bots = [bot("atlas", "Atlas", "blue", { pinned: true }), bot("boreas", "Boreas", "green"), bot("cirrus", "Cirrus", "purple")];
const base = { prompt: "Summarize.", target: "bot", runOn: "maus", durationMinutes: 30, createdAt: 1, updatedAt: 1, canRun: true, canEdit: true };
const daily = (time: string, weekdays = [1, 2, 3, 4, 5]) => ({ type: "daily", time, weekdays });
const routines = (empty ? [] : [
  { ...base, id: "r1", botId: "atlas", name: "Morning inbox digest", enabled: true, schedule: daily("08:00"), nextRunAt: NOW + 2 * H },
  { ...base, id: "r2", botId: "atlas", name: "Reply watch", folder: "Clients", enabled: true, schedule: { type: "interval", everyMinutes: 30, anchorAt: NOW - H }, nextRunAt: NOW + 0.4 * H },
  { ...base, id: "r3", botId: "atlas", name: "End of day catch-up", folder: "Clients", enabled: true, schedule: daily("16:30"), nextRunAt: NOW + 5 * H },
  { ...base, id: "r4", botId: "atlas", name: "Weekly board review", folder: "Reports", enabled: true, schedule: daily("09:00", [1]), nextRunAt: NOW + 40 * H, failureStreak: quiet ? 0 : 2 },
  { ...base, id: "r5", botId: "boreas", name: "Backup check", enabled: true, schedule: daily("07:00", [0, 1, 2, 3, 4, 5, 6]), nextRunAt: NOW + 20 * H },
  { ...base, id: "r6", botId: "boreas", name: "Patch report", folder: "Reports", enabled: false, schedule: daily("17:00", [5]) },
  { ...base, id: "r7", botId: "cirrus", name: "Invoice review", enabled: true, schedule: daily("10:00", [1, 3]), nextRunAt: NOW + 26 * H },
  { ...base, id: "r8", botId: "cirrus", name: "Triage new issues", folder: "Dev", enabled: true, schedule: { type: "event", source: "github", events: ["issue.opened", "pr.opened"], filters: { repo: ["acme/api"] } }, nextRunAt: null },
  { ...base, id: "r9", botId: "cirrus", name: "Support inbox", folder: "Dev", enabled: false, autoPaused: { failures: 5, at: NOW - 30 * H }, schedule: { type: "event", source: "email" }, nextRunAt: null },
]) as unknown as Routine[];
const names = Object.fromEntries(routines.map((routine) => [routine.id, routine]));
const run = (id: string, routineId: string, status: RoutineRun["status"], ago: number, extra: Partial<RoutineRun> = {}): RoutineRun => ({
  id, routineId, routineName: names[routineId]!.name, target: "bot", botId: names[routineId]!.botId!, runOn: "maus",
  scheduledFor: NOW - ago * H, createdAt: NOW - ago * H, startedAt: NOW - ago * H, finishedAt: NOW - ago * H + (3 + (id.length % 5)) * 60_000, status, manual: false,
  ...(status === "failed" ? { error: "The engine stopped" } : { output: "Done." }), ...extra,
} as RoutineRun);
const runs: RoutineRun[] = empty ? [] : [
  ...Array.from({ length: 6 }, (_, index) => run(`a${index}`, "r1", "completed", 22 + index * 24)),
  ...Array.from({ length: 5 }, (_, index) => run(`b${index}`, "r2", index === 3 ? "nothing_to_report" : "completed", 0.5 + index * 7, (index === 3 ? { quiet: true } : {}))),
  run("c0", "r3", "completed", 19), run("c1", "r3", "completed", 43),
  run("d0", "r4", quiet ? "completed" : "failed", 150), run("d1", "r4", quiet ? "completed" : "completed", 30, quiet ? {} : { problems: "One report was missing." }),
  run("e0", "r5", "completed", 4), run("e1", "r5", "completed", 28), run("e2", "r5", "completed", 52),
  run("f0", "r7", "completed", 70),
  run("g0", "r8", "completed", 9), run("g1", "r8", "completed", 12),
  run("h0", "r9", quiet ? "completed" : "failed", 60),
  run("x2", "r2", "running", 0.05, { finishedAt: undefined }),
];

const state: AppState = {
  ...initialState,
  bots,
  routines,
  routineRuns: runs,
  routineFolders: { atlas: ["Clients", "Reports"], boreas: ["Reports"] },
  routinesLoadState: "ready",
  routinesFocus: { section: params.get("tab") === "logs" ? "logs" : "schedule", view: params.get("tab") === "calendar" ? "calendar" : "list", nonce: 1 },
  config: {
    ...initialState.config,
    viewer: { principalId: "pr_viewer", profileManagedBy: "perspicax", role: "admin" },
  } as unknown as AppState["config"],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/calendar-calls")) return json({ calls: [] });
  if (url.includes("/api/limit-resets")) {
    return json({ checkedAt: NOW, engines: [{ engine: "grok", name: "Grok", driver: "grok", window: "5-hour", usedPercent: 94, resetsAt: NOW + 3 * H, blocked: false }] });
  }
  if (url.includes("/api/routines")) {
    return json({
      routines, runs, scope: "mine", allowed: { mine: true, team: true, all: true },
      facets: { teams: [], owners: [], botChoices: bots.map((entry) => ({ id: entry.id, name: entry.name })) },
    });
  }
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={value}>
      <div data-gallery-sample="routines" className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
          <RoutinesPage fill onBack={() => {}} onOpenRoom={() => {}} />
        </div>
      </div>
    </BotEditorStore>
  </StrictMode>,
);
