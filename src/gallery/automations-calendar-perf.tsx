/** Performance fixture of the Automations calendar (2026-11-02): a GOX-size
 * dataset (9 bots, 60 routines of every schedule kind, about 2,000 runs over
 * six weeks, six calendar calls) on the real store reducer, so a live run
 * frame goes through the same `routineRunPatched` path the app takes. The
 * benchmark (scripts/perf/automations-calendar-bench.mjs) drives it headless:
 * `window.__calperf.tick()` sends one live run update, `unrelated()` one store
 * frame that does not touch routines (the sidebar's hidden rows), and the React DevTools
 * hook it installs counts which components rendered in each commit.
 * A mocked fetch answers the page's reads so nothing connects. Not shipped.
 * ?width=<px>&height=<px>&lang=<code>&skin=<id> */
import { Profiler, StrictMode, useEffect, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";

import { RoutinesPage } from "../components/RoutineCalendarPage";
import { PanelSlotProvider } from "../components/panel-slot";
import { loadLocale } from "../lib/i18n";
import { applySkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type AppState, type Bot } from "../state/store";
import { reducer } from "../state/store/reducer";
import type { Action } from "../state/store/model";
import type { Routine, RoutineRun } from "../lib/routines";
import "../styles.css";

type Perf = {
  /** The page's Profiler commits (render time of the page subtree). */
  commits: Array<{ at: number; duration: number; phase: string }>;
  /** Every React commit: when, and the components that rendered in it. */
  fiberCommits: Array<{ at: number; rendered: Record<string, number>; selfMs: Record<string, number> }>;
  dispatch?: (action: Action) => void;
  tick: () => void;
  unrelated: () => void;
  state: () => AppState;
};
declare global {
  interface Window { __calperf: Perf }
}

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : "pulsatrix");
await loadLocale(params.get("lang") ?? "en");
const width = Number(params.get("width") ?? 1440);
const height = Number(params.get("height") ?? 900);
const strict = params.get("strict") === "1";

// Seeded so every run of the benchmark draws the same calendar.
let seed = 20261102;
const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

const NOW = Date.now();
const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const startOfToday = new Date(new Date(NOW).setHours(0, 0, 0, 0)).getTime();
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const COLORS = ["blue", "green", "purple", "red", "orange", "pink", "teal", "yellow", "graphite"];
const NAMES = ["Atlas", "Boreas", "Cirrus", "Delta", "Echo", "Fable", "Gale", "Halo", "Iris"];
const bots: Bot[] = NAMES.map((name, index) => ({
  id: `bot${index}`, threadId: `bot${index}-thread`, mainThreadId: `bot${index}-thread`, name, title: "", description: "", color: COLORS[index]!, notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
  tasks: [{ threadId: `bot${index}-thread`, title: "Main" }],
} as unknown as Bot));

const TASKS = ["Ticket triage", "Backup check", "Invoice review", "Morning briefing", "Patch report", "Alert sweep", "Time entry check", "Client digest", "Agreement audit", "Device inventory", "Mailbox cleanup", "Security review"];
const base = { target: "bot", runOn: "maus", durationMinutes: 30, timeoutMinutes: 45, createdAt: NOW - 90 * DAY, updatedAt: NOW - DAY, canRun: true, canEdit: true, failureStreak: 0 };
const time = (hour: number, minute: number) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
const nextDailyAt = (hour: number, minute: number) => {
  const today = startOfToday + hour * H + minute * MIN;
  return today > NOW ? today : today + DAY;
};

const routines: Routine[] = [];
let routineIndex = 0;
const addRoutine = (fields: Record<string, unknown>) => {
  const botId = `bot${routineIndex % bots.length}`;
  routines.push({ ...base, id: `r${routineIndex}`, botId, name: `${TASKS[routineIndex % TASKS.length]} ${Math.floor(routineIndex / TASKS.length) + 1}`, prompt: "Read the board, then report what needs a person today.", enabled: true, ...fields } as unknown as Routine);
  routineIndex += 1;
};
// 24 daily routines at business hours (weekdays or every day).
for (let index = 0; index < 24; index += 1) {
  const hour = 6 + Math.floor(random() * 12);
  const minute = pick([0, 0, 15, 30, 45]);
  addRoutine({ schedule: { type: "daily", time: time(hour, minute), weekdays: index % 3 === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5] }, nextRunAt: nextDailyAt(hour, minute), weekRuns: { ok: 5, total: 5 } });
}
// 8 hourly crons in business hours, 3 every half hour, 4 weekly.
for (let index = 0; index < 8; index += 1) addRoutine({ schedule: { type: "cron", expression: `${index * 7 % 60} 8-17 * * 1-5`, timeZone: TZ }, nextRunAt: NOW + 0.5 * H });
for (let index = 0; index < 3; index += 1) addRoutine({ schedule: { type: "cron", expression: `${index * 10},${index * 10 + 30} 7-18 * * 1-5`, timeZone: TZ }, nextRunAt: NOW + 0.25 * H });
for (let index = 0; index < 4; index += 1) addRoutine({ schedule: { type: "cron", expression: `0 ${9 + index} * * ${index + 1}`, timeZone: TZ }, nextRunAt: NOW + (index + 1) * DAY });
// 10 intervals, 5 one-shots, 3 webhooks or events.
for (let index = 0; index < 10; index += 1) addRoutine({ schedule: { type: "interval", everyMinutes: pick([15, 30, 60, 120]), anchorAt: NOW - 5 * H }, nextRunAt: NOW + (index + 1) * 7 * MIN, precheck: index % 4 === 0 ? { kind: "watch", source: "folder" } : undefined });
for (let index = 0; index < 5; index += 1) addRoutine({ schedule: { type: "once", at: startOfToday + (index + 1) * DAY + (10 + index) * H }, nextRunAt: startOfToday + (index + 1) * DAY + (10 + index) * H });
for (let index = 0; index < 3; index += 1) addRoutine({ schedule: { type: "webhook" }, nextRunAt: null });
// 3 paused (one by itself after failures).
for (let index = 0; index < 3; index += 1) addRoutine({ enabled: false, schedule: { type: "daily", time: time(9 + index, 0), weekdays: [1, 2, 3, 4, 5] }, nextRunAt: null, ...(index === 0 ? { autoPaused: { failures: 5, at: NOW - 6 * H }, failureStreak: 5 } : {}) });

// Six weeks of runs: each daily or cron routine ran on its days; trimmed by
// the store to its own cap like the app.
const STATUSES = ["completed", "completed", "completed", "completed", "completed", "completed", "failed", "missed", "cancelled"] as const;
const runs: RoutineRun[] = [];
let runIndex = 0;
const addRun = (routine: Routine, at: number, status: RoutineRun["status"]) => {
  const finished = ["completed", "failed", "cancelled", "missed"].includes(status);
  runs.push({
    id: `x${runIndex++}`, routineId: routine.id, routineName: routine.name, prompt: routine.prompt, timeoutMinutes: 45, target: routine.target, botId: routine.botId, runOn: "maus",
    scheduledFor: at, createdAt: at, startedAt: at + 20_000, status, manual: false,
    ...(finished ? { finishedAt: at + 4 * MIN, seenAt: at + H } : {}),
    ...(status === "completed" ? { output: "Nothing urgent. Two tickets need a person before noon.", cost: 0.02 } : {}),
    ...(status === "failed" ? { error: "The connector timed out after three tries." } : {}),
  } as RoutineRun);
};
for (let day = 42; day >= 0; day -= 1) {
  const dayStart = startOfToday - day * DAY;
  const weekday = new Date(dayStart).getDay();
  for (const routine of routines) {
    if (routine.schedule.type === "daily" && routine.schedule.weekdays.includes(weekday)) {
      const at = dayStart + Number(routine.schedule.time.slice(0, 2)) * H + Number(routine.schedule.time.slice(3)) * MIN;
      if (at < NOW) addRun(routine, at, pick(STATUSES));
    }
    if (routine.schedule.type === "cron" && weekday >= 1 && weekday <= 5 && routine.schedule.expression.includes("8-17")) {
      for (const hour of [8, 11, 14, 17]) { const at = dayStart + hour * H; if (at < NOW) addRun(routine, at, pick(STATUSES)); }
    }
  }
}
// What is in flight now.
const live = routines.filter((routine) => routine.enabled && routine.schedule.type !== "webhook").slice(0, 6);
live.forEach((routine, index) => addRun(routine, NOW - (index + 1) * 3 * MIN, index % 3 === 0 ? "waiting" : index % 3 === 1 ? "queued" : "running"));

const calls = Array.from({ length: 6 }, (_, index) => ({
  id: `c${index}`, name: `Weekly sync ${index + 1}`, description: "Review the open items of the week.", botIds: [`bot${index}`, `bot${index + 1}`],
  schedule: index % 2 === 0 ? { type: "daily", time: time(13 + index, 0), weekdays: [index % 5 + 1] } : { type: "once", at: startOfToday + index * DAY + 15 * H },
  durationMinutes: 45, attachments: [], nextRunAt: startOfToday + index * DAY + 15 * H, createdAt: 1, updatedAt: 1,
}));

const fixtureState: AppState = {
  ...initialState,
  bots,
  routinesFocus: { section: "schedule", view: "calendar", nonce: 1 },
  config: {
    ...initialState.config,
    viewer: { principalId: "pr_viewer", profileManagedBy: "perspicax", role: "admin" },
  } as unknown as AppState["config"],
};
const hydrated = reducer(fixtureState, { type: "routinesHydrated", routines, runs });

let current = hydrated;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/calendar-calls")) return json({ calls });
  // The org listing the scope reads again after each live frame: the same
  // records, fresh objects, as the server answers them.
  if (url.includes("/api/routines")) {
    return json({
      routines: current.routines, runs: current.routineRuns, scope: "mine", allowed: { mine: true, team: true, all: true },
      facets: { teams: [{ id: "t1", name: "Support" }], owners: [{ id: "pr_viewer", name: "Alex Doe" }], botChoices: bots.map((entry) => ({ id: entry.id, name: entry.name })) },
    });
  }
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

const perf: Perf = {
  commits: [],
  fiberCommits: [],
  tick: () => {},
  unrelated: () => {},
  state: () => current,
};
window.__calperf = perf;

// One live update: the oldest running run moves on (its step count), and every
// fifth tick one finishes while another starts, as the scheduler sends them.
let liveTick = 0;
perf.tick = () => {
  liveTick += 1;
  const running = current.routineRuns.filter((run) => run.status === "running");
  const target = running[liveTick % Math.max(1, running.length)];
  if (!target) return;
  if (liveTick % 5 === 0) {
    perf.dispatch?.({ type: "routineRunPatched", run: { ...target, status: "completed", finishedAt: Date.now(), output: "Done." } as RoutineRun });
    const routine = pick(live);
    perf.dispatch?.({ type: "routineRunPatched", run: { ...target, id: `live${liveTick}`, routineId: routine.id, routineName: routine.name, botId: routine.botId, status: "running", scheduledFor: Date.now(), createdAt: Date.now(), startedAt: Date.now(), finishedAt: undefined, output: undefined } as RoutineRun });
    return;
  }
  perf.dispatch?.({ type: "routineRunPatched", run: { ...target, attention: `Step ${liveTick}` } as RoutineRun });
};
perf.unrelated = () => { liveTick += 1; perf.dispatch?.({ type: "sidebarHidden", keys: new Set([`unrelated-${liveTick}`]) }); };

function Host() {
  const [state, dispatch] = useReducer(reducer, hydrated);
  current = state;
  useEffect(() => { perf.dispatch = dispatch; }, []);
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <BotEditorStore value={value}>
      <PanelSlotProvider slot={slot}>
        <div data-gallery-sample="calendar-perf" className="app-shell-row relative flex overflow-hidden bg-app text-ink" style={{ width, height }}>
          <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col"><Page /></div>
          <div ref={setSlot} data-split-panel-slot="" className="contents" />
        </div>
      </PanelSlotProvider>
    </BotEditorStore>
  );
}
// App passes stable callbacks (App.tsx: useCallback), so the fixture does too.
const onBack = () => {};
const onOpenRoom = () => {};
function Page() {
  return (
    <Profiler id="automations" onRender={(_id, phase, duration, _base, _start, commitTime) => perf.commits.push({ at: commitTime, duration, phase })}>
      <RoutinesPage fill onBack={onBack} onOpenRoom={onOpenRoom} />
    </Profiler>
  );
}

// Which components rendered in a commit: a fiber whose render started after
// the previous commit (profiling builds stamp actualStartTime on each one).
let previousCommitEnd = 0;
type Fiber = { child: Fiber | null; sibling: Fiber | null; type: unknown; actualStartTime?: number; selfBaseDuration?: number };
const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { onCommitFiberRoot?: (id: number, root: { current: Fiber }) => void } }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
if (hook) {
  hook.onCommitFiberRoot = (_id, root) => {
    const counts: Record<string, number> = {};
    const selfMs: Record<string, number> = {};
    const stack: Fiber[] = [root.current];
    while (stack.length) {
      const fiber = stack.pop()!;
      if (typeof fiber.type === "function" || (typeof fiber.type === "object" && fiber.type)) {
        if ((fiber.actualStartTime ?? -1) >= previousCommitEnd) {
          const type = fiber.type as { displayName?: string; name?: string; type?: { name?: string }; render?: { name?: string } };
          const name = type.displayName || type.name || type.type?.name || type.render?.name || "anonymous";
          counts[name] = (counts[name] ?? 0) + 1;
          selfMs[name] = (selfMs[name] ?? 0) + (fiber.selfBaseDuration ?? 0);
        }
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
    }
    previousCommitEnd = performance.now();
    perf.fiberCommits.push({ at: previousCommitEnd, rendered: counts, selfMs });
  };
}

performance.mark("calperf:render");
createRoot(document.getElementById("root")!).render(strict ? <StrictMode><Host /></StrictMode> : <Host />);
