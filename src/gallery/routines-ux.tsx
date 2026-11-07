/** Isolated gallery for headless screenshots of the routine views (2026-10-29):
 * the Automations page as a list, a calendar and the run logs, a routine's
 * page, a run's detail (completed with a table, waiting for an approval,
 * failed) and the bot panel's routine page. Ten neutral fictional routines
 * over three bots (active, paused, paused by itself, one deleted since), with
 * runs of every outcome. A mocked fetch answers the page's reads so nothing
 * connects. Not shipped in the app.
 * ?view=list|calendar|logs|run|routine|panel&case=completed|waiting|failed|running|failing (panel: the first routine failing)
 * &width=<px>&height=<px>&lang=<code>&skin=<id> (pulsatrix: dark, pulsatrix-light: light) */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { EventDetails, RoutinesPage } from "../components/RoutineCalendarPage";
import { RoutinesSection } from "../components/bot-settings/RoutinesSection";
import { PanelSlotProvider } from "../components/panel-slot";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, StoreProvider, useStore, type AppState, type Bot } from "../state/store";
import type { Routine, RoutineRun } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const view = (params.get("view") ?? "list") as "list" | "calendar" | "logs" | "run" | "routine" | "panel";
const runCase = (params.get("case") ?? "completed") as "completed" | "waiting" | "failed" | "running";
const width = Number(params.get("width") ?? 1200);
const height = Number(params.get("height") ?? 760);

const NOW = Date.now();
const H = 3_600_000;
const startOfToday = new Date(new Date(NOW).setHours(0, 0, 0, 0)).getTime();
const bot = (id: string, name: string, color: string): Bot => ({
  id, threadId: `${id}-thread`, mainThreadId: `${id}-thread`, name, title: "", description: "", color, notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
  tasks: [{ threadId: `${id}-thread`, title: "Main" }, { threadId: `${id}-run-thread`, title: "Run" }],
} as unknown as Bot);
const bots = [bot("atlas", "Atlas", "blue"), bot("boreas", "Boreas", "green"), bot("cirrus", "Cirrus", "purple")];
const TZ = "America/Toronto";
const base = { target: "bot", runOn: "maus", durationMinutes: 30, timeoutMinutes: 45, createdAt: 1, updatedAt: 1, canRun: true, canEdit: true };
const briefingPrompt = "Every weekday morning, read the shared inbox and the calendar of the day. Write a short briefing with three sections: what needs an answer today, what is waiting on someone else, and what can wait. Put the open items in a table with the area, the count and whether it needs me. Keep it under 200 words.";
export const routines = [
  { ...base, id: "r1", botId: "atlas", name: "Morning briefing", prompt: briefingPrompt, enabled: true, schedule: { type: "cron", expression: "11 8 * * 1-5", timeZone: TZ }, nextRunAt: NOW + 16 * H, weekRuns: { ok: 4, total: 5 }, failureStreak: params.get("case") === "failing" ? 2 : 0 },
  { ...base, id: "r2", botId: "boreas", name: "Weekly planning digest", prompt: "Every Monday, gather last week's closed items and this week's deadlines into a digest.", enabled: true, schedule: { type: "cron", expression: "0 10 * * 1", timeZone: TZ }, nextRunAt: NOW + 30 * H, weekRuns: { ok: 1, total: 1 } },
  { ...base, id: "r3", botId: "cirrus", name: "Release checklist", prompt: "Walk the release checklist and report what is missing.", enabled: false, schedule: { type: "cron", expression: "0 17 * * 5", timeZone: TZ }, nextRunAt: null },
  { ...base, id: "r4", botId: "atlas", name: "Hourly status sweep", prompt: "Check the status page and report any incident.", enabled: true, schedule: { type: "interval", everyMinutes: 60, anchorAt: NOW - 5 * H }, nextRunAt: NOW + 0.5 * H, weekRuns: { ok: 40, total: 42 } },
  { ...base, id: "r5", botId: "boreas", name: "Invoice reminders", prompt: "List the invoices due this week and draft a reminder for each.", enabled: false, autoPaused: { failures: 5, at: NOW - 6 * H }, failureStreak: 5, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, nextRunAt: null },
  { ...base, id: "r6", botId: "cirrus", name: "Backup check", prompt: "Confirm last night's backup finished and the restore test passed.", enabled: true, schedule: { type: "daily", time: "07:00", weekdays: [0, 1, 2, 3, 4, 5, 6] }, nextRunAt: NOW + 9 * H, weekRuns: { ok: 7, total: 7 } },
  { ...base, id: "r7", botId: "atlas", name: "Watch the shared folder", prompt: "When a new file lands in the shared folder, summarize it.", enabled: true, precheck: { kind: "watch", source: "folder" }, schedule: { type: "interval", everyMinutes: 15, anchorAt: NOW - H }, nextRunAt: NOW + 0.2 * H },
  { ...base, id: "r8", botId: "boreas", name: "Quarter-end summary", prompt: "Summarize the quarter.", enabled: true, schedule: { type: "once", at: NOW + 72 * H }, nextRunAt: NOW + 72 * H },
  { ...base, id: "r9", botId: "cirrus", name: "On-call handover", prompt: "Prepare the handover notes for the next on-call person.", enabled: false, schedule: { type: "daily", time: "18:00", weekdays: [1, 2, 3, 4, 5] }, nextRunAt: null },
  { ...base, id: "g1", target: "room-goal", groupId: "room1", botId: "atlas", name: "Team retro notes", prompt: "Everyone adds one thing that went well and one to improve.", enabled: true, schedule: { type: "cron", expression: "0 16 * * 5", timeZone: TZ }, nextRunAt: NOW + 50 * H, weekRuns: { ok: 1, total: 1 } },
] as unknown as Routine[];

const tableOutput = [
  "Good morning. Three items need an answer today; two are waiting on someone else.",
  "",
  "| Area | Open items | Needs you |",
  "| --- | ---: | :---: |",
  "| Support inbox | 4 | yes |",
  "| Vendor quotes | 2 | yes |",
  "| Onboarding | 1 | no |",
  "| Facilities | 3 | no |",
  "",
  "**Needs an answer today**",
  "",
  "1. The vendor quote for the printers expires at noon.",
  "2. A new hire asks which laptop to order.",
  "3. The support inbox has one escalation from yesterday.",
  "",
  "Everything else can wait until Thursday.",
].join("\n");

const named = (routineId: string) => routines.find((routine) => routine.id === routineId)!;
const run = (id: string, routineId: string, status: RoutineRun["status"], at: number, extra: Partial<RoutineRun> = {}): RoutineRun => ({
  id, routineId, routineName: named(routineId).name, prompt: named(routineId).prompt, timeoutMinutes: 45, target: named(routineId).target, botId: named(routineId).botId, runOn: "maus",
  scheduledFor: at, createdAt: at, startedAt: at + 20_000, status, manual: false,
  ...(["completed", "failed", "cancelled", "missed"].includes(status) ? { finishedAt: at + 20_000 + 4 * 60_000 } : {}),
  ...(status === "failed" ? { error: "The engine stopped before it answered: the connector timed out after three tries." } : {}),
  ...extra,
} as RoutineRun);
export const runs: RoutineRun[] = [
  run("x1", "r1", "completed", NOW - 8 * H, { output: tableOutput, cost: 0.042, threadId: "atlas-run-thread", resultsThreadId: "atlas-thread", seenAt: NOW - 7 * H }),
  run("x2", "r4", "running", NOW - 0.1 * H, { threadId: "atlas-run-thread" }),
  run("x3", "r2", "waiting", NOW - 0.5 * H, { attention: "Send the digest to the whole planning channel? It names two deadlines that moved.", threadId: "boreas-run-thread" }),
  run("x4", "r5", "failed", NOW - 6 * H, { autoPaused: { failures: 5 }, cost: 0.003 }),
  run("x5", "r5", "failed", NOW - 30 * H, { cost: 0.003, seenAt: NOW - 29 * H }),
  run("x6", "r6", "completed", NOW - 9 * H, { output: "Last night's backup finished at 02:14 and the restore test passed.", cost: 0.011, seenAt: NOW - 8 * H }),
  run("x7", "r6", "completed", NOW - 33 * H, { output: "Backup finished at 02:09; restore test passed.", cost: 0.012, seenAt: NOW - 30 * H }),
  run("x8", "r7", "completed", NOW - 2 * H, { quiet: true, cost: 0 }),
  run("x9", "r3", "missed", NOW - 60 * H, { error: "The computer was asleep." }),
  run("x10", "r4", "cancelled", NOW - 3 * H),
  run("x11", "r1", "completed", NOW - 32 * H, { output: "Good morning. Nothing urgent: two vendor quotes to review before Friday.", cost: 0.038, seenAt: NOW - 31 * H, manual: true, triggerSource: "manual" }),
  run("x12", "r1", "failed", NOW - 56 * H, { error: "rpc_error", seenAt: NOW - 50 * H, retried: "stalled" }),
  run("x13", "g1", "completed", NOW - 70 * H, { goalStatus: "completed", output: "Six notes collected; two improvements picked for next sprint.", executionThreadId: "room1-goal", cost: 0.09 }),
  run("x14", "r4", "queued", NOW + 0.5 * H, { retryAt: NOW + 0.3 * H, attention: "Waiting for the bot to finish its current conversation." }),
  { id: "x15", routineId: "gone", routineName: "Quarterly cleanup", prompt: "Archive the closed items of the quarter.", target: "bot", botId: "cirrus", runOn: "maus", scheduledFor: NOW - 5 * H, createdAt: NOW - 5 * H, startedAt: NOW - 5 * H, finishedAt: NOW - 5 * H + 3 * 60_000, status: "completed", manual: false, output: "Archived 27 closed items.", cost: 0.02, seenAt: NOW - 4 * H } as RoutineRun,
];
const CASE_RUN: Record<typeof runCase, string> = { completed: "x1", waiting: "x3", failed: "x4", running: "x2" };

const state: AppState = {
  ...initialState,
  bots,
  routines,
  routineRuns: runs,
  routinesLoadState: "ready",
  routinesFocus: view === "run"
    ? { section: "logs", runId: CASE_RUN[runCase], nonce: 1 }
    : { section: view === "logs" ? "logs" : "schedule", view: view === "calendar" ? "calendar" : "list", nonce: 1 },
  config: {
    ...initialState.config,
    viewer: { principalId: "pr_viewer", profileManagedBy: "perspicax", role: "admin" },
  } as unknown as AppState["config"],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  // One neutral calendar call so the call details have something to show.
  if (url.includes("/api/calendar-calls")) return json({ calls: [{
    id: "c1", name: "Weekly sync with the team", description: "Review the open items of the week, then pick the three priorities for next week. Each bot brings its own list.",
    botIds: ["atlas", "boreas"], schedule: { type: "once", at: startOfToday + 14 * H }, durationMinutes: 45, attachments: [], nextRunAt: startOfToday + 14 * H, createdAt: 1, updatedAt: 1,
  }] });
  if (url.includes("/activity/item")) {
    const runId = new URL(url, location.href).searchParams.get("runId");
    const found = runs.find((entry) => entry.id === runId);
    const status = found?.status === "running" ? "running" : found?.status === "waiting" ? "waiting" : found?.status === "failed" ? "failed" : "finished";
    return json({ item: {
      id: `run:${runId}`, kind: "routine", botId: found?.botId ?? "atlas", title: found?.routineName ?? "", status, startedAt: found?.startedAt ?? NOW, ...(found?.finishedAt ? { endedAt: found.finishedAt } : {}),
      threadId: found?.threadId, startedBy: { kind: "routine", name: found?.routineName ?? "" }, engine: { instanceId: "test", model: "fable" },
      steps: found?.status === "missed" ? [] : [
        { id: "s1", name: "read_mail", summary: "12 messages since yesterday", ok: true, at: (found?.startedAt ?? NOW) + 5_000, where: "server" },
        { id: "s2", name: "calendar_list", summary: "4 events today", ok: true, at: (found?.startedAt ?? NOW) + 12_000, where: "server" },
        { id: "s3", name: "read_file", summary: "vendor-quotes.md", ok: found?.status === "failed" ? false : true, at: (found?.startedAt ?? NOW) + 30_000, where: "computer" },
        ...(found?.status === "running" ? [{ id: "s4", name: "write_file", summary: "briefing.md", at: (found?.startedAt ?? NOW) + 45_000, where: "computer" }] : []),
      ],
      stepsTruncated: false, files: ["briefing.md"], children: [], canStop: status === "running" || status === "waiting",
      ...(found?.attention ? { note: found.attention } : {}), ...(found?.error ? { note: found.error } : {}),
    } });
  }
  // The panel's store loads the engines (an empty list, not {}) and the bots itself.
  if (url.includes("/api/instances")) return json({ instances: [] });
  // The panel's store loads the bots itself.
  if (url.includes("/api/bots?")) return json({ bots, groups: [], sections: [], computerControl: {} });
  // The waiting run's thread holds one open approval, answered in place.
  if (url.includes("/api/threads/boreas-run-thread/messages")) {
    return json({ messages: [{ id: "m-approve", role: "bot", kind: "options", at: NOW - 0.4 * H, card: { requestId: "req-digest", tool: "mcp__chat__post_message", title: "", subtitle: "To: the planning channel", options: ["Allow", "Deny"] } }] });
  }
  if (url.includes("/api/routines")) {
    return json({
      routines, runs, scope: "mine", allowed: { mine: true, team: true, all: true },
      facets: { teams: [{ id: "t1", name: "Support" }], owners: [{ id: "pr_viewer", name: "Alex Doe" }], botChoices: bots.map((entry) => ({ id: entry.id, name: entry.name })) },
    });
  }
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

function PanelReady({ children }: { children: React.ReactNode }) {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots, groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines, runs });
    dispatch({ type: "openRoutine", botId: "atlas", routineId: "r1" });
  }, [dispatch]);
  return <>{children}</>;
}

const atlasRoutines = routines.filter((routine) => routine.botId === "atlas");
/** App's row: the content frame, then the right-edge panel slot that a
 * page's detail panel portals into (DetailPanel.tsx, panel-slot.tsx). */
function Frame({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <PanelSlotProvider slot={slot}>
      <div data-gallery-sample={view} className="app-shell-row relative flex overflow-hidden bg-app text-ink" style={{ width, height }}>
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">{children}</div>
        <div ref={setSlot} data-split-panel-slot="" className="contents" />
      </div>
    </PanelSlotProvider>
  );
}
const frame = (children: React.ReactNode) => <Frame>{children}</Frame>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {view === "panel" ? (
      <StoreProvider><PanelReady>
        <aside data-gallery-panel="" style={{ width: Math.min(width, 420), height }} className="relative border border-hairline/40 bg-panel text-ink">
          <RoutinesSection bot={bots[0]!} routines={atlasRoutines} runs={runs} grouped />
        </aside>
      </PanelReady></StoreProvider>
    ) : (
      <BotEditorStore value={value}>
        {frame(<>
          <RoutinesPage fill onBack={() => {}} onOpenRoom={() => {}} />
          {view === "routine" && <EventDetails item={{ kind: "routine", id: "r1", at: routines[0]!.nextRunAt!, durationMinutes: 30, routine: routines[0]!, run: null }} bots={bots} onClose={() => {}} onEdit={() => {}} onCallChanged={() => {}} onOpenRoom={() => {}} />}
        </>)}
      </BotEditorStore>
    )}
  </StrictMode>,
);
