/** Isolated gallery for headless screenshots of the Automations List view
 * grouped (2026-11-03): by bot with each bot's folders inside, by folder, or
 * none, under an engine near its limit. Neutral fictional bots and routines;
 * a mocked fetch answers the page's reads so nothing connects. Not shipped.
 * ?groupBy=bot|folder|none&collapsed=<botId>&width=<px>&height=<px>&lang=<code>&skin=<id> */
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
  localStorage.setItem(ROUTINE_GROUP_BY_KEY, JSON.stringify({ pr_viewer: params.get("groupBy") ?? "bot" }));
  const collapsed = params.get("collapsed");
  localStorage.setItem(ROUTINE_GROUPS_COLLAPSED_KEY, JSON.stringify(collapsed ? { pr_viewer: collapsed.split(",").map((id) => `bot:${id}`) } : {}));
} catch { /* a blocked storage: the defaults */ }

const NOW = Date.now();
const H = 3_600_000;
const bot = (id: string, name: string, color: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color, notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "grok", model: "grok-4" }, ...extra,
} as unknown as Bot);
const bots = [bot("atlas", "Atlas", "blue", { pinned: true }), bot("boreas", "Boreas", "green"), bot("cirrus", "Cirrus", "purple")];
const base = { prompt: "Summarize.", target: "bot", runOn: "maus", durationMinutes: 30, createdAt: 1, updatedAt: 1, canRun: true, canEdit: true };
const daily = (time: string, weekdays = [1, 2, 3, 4, 5]) => ({ type: "daily", time, weekdays });
const routines = [
  { ...base, id: "r1", botId: "atlas", name: "Outlook digest to Melonie", enabled: true, schedule: daily("08:00"), nextRunAt: NOW + 2 * H },
  { ...base, id: "r2", botId: "atlas", name: "Client reply watch", folder: "Clients", enabled: true, schedule: { type: "interval", everyMinutes: 30, anchorAt: NOW - H }, nextRunAt: NOW + 0.4 * H },
  { ...base, id: "r3", botId: "atlas", name: "Catch-up and manager copy", folder: "Clients", enabled: true, schedule: daily("16:30"), nextRunAt: NOW + 5 * H },
  { ...base, id: "r4", botId: "atlas", name: "Weekly board review", folder: "Reports", enabled: true, schedule: daily("09:00", [1]), nextRunAt: NOW + 40 * H, failureStreak: 2 },
  { ...base, id: "r5", botId: "boreas", name: "Backup check", enabled: true, schedule: daily("07:00", [0, 1, 2, 3, 4, 5, 6]), nextRunAt: NOW + 20 * H },
  { ...base, id: "r6", botId: "boreas", name: "Patch report", folder: "Reports", enabled: false, schedule: daily("17:00", [5]) },
  { ...base, id: "r7", botId: "cirrus", name: "Invoice review", enabled: true, schedule: daily("10:00", [1, 3]), nextRunAt: NOW + 26 * H },
] as unknown as Routine[];
const run = (id: string, routineId: string, status: RoutineRun["status"], at: number): RoutineRun => ({
  id, routineId, routineName: routines.find((routine) => routine.id === routineId)!.name, target: "bot",
  botId: routines.find((routine) => routine.id === routineId)!.botId!, runOn: "maus", scheduledFor: at, createdAt: at, startedAt: at, status, manual: false,
  ...(status === "failed" ? { error: "The engine stopped" } : { output: "Done." }),
} as RoutineRun);
const runs = [
  run("x1", "r1", "completed", NOW - 22 * H),
  run("x2", "r2", "running", NOW - 0.05 * H),
  run("x3", "r3", "completed", NOW - 19 * H),
  run("x4", "r4", "failed", NOW - 150 * H),
  run("x5", "r5", "completed", NOW - 4 * H),
];

const state: AppState = {
  ...initialState,
  bots,
  routines,
  routineRuns: runs,
  routineFolders: { atlas: ["Clients", "Reports"], boreas: ["Reports"] },
  routinesLoadState: "ready",
  routinesFocus: { section: "schedule", view: "list", nonce: 1 },
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
      <div data-gallery-sample="group-by" className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
          <RoutinesPage fill onBack={() => {}} onOpenRoom={() => {}} />
        </div>
      </div>
    </BotEditorStore>
  </StrictMode>,
);
