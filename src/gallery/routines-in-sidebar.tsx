/** Isolated gallery for headless screenshots of routines in the side panel
 * (JC, 2026-11-01): routine detail, panel edit, and run-as-exchange. Mocked
 * API; no server. Not shipped in the app.
 * ?view=detail|edit|run&width=<px>&height=<px>&lang=<code>&skin=<id> */
import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RoutineEditor } from "../components/RoutineCalendarPage";
import { RoutinesSection } from "../components/bot-settings/RoutinesSection";
import { ExchangeColumnProvider, useExchangeColumn } from "../components/BotExchangeChip";
import { RoutineRunExchange } from "../components/routines/RoutineRunExchange";
import { loadLocale } from "../lib/i18n";
import type { Routine, RoutineRun } from "../lib/routines";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const view = (params.get("view") ?? "detail") as "detail" | "edit" | "run";
const width = Number(params.get("width") ?? 1338);
const height = Number(params.get("height") ?? 809);

const NOW = Date.UTC(2026, 10, 1, 14, 0);
const bot = {
  id: "atlas", threadId: "atlas-thread", mainThreadId: "atlas-thread", name: "Atlas", color: "blue",
  tasks: [{ threadId: "atlas-thread", title: "Main" }], modelSelection: { instanceId: "test", model: "test" },
} as unknown as Bot;
const prompt = [
  "Every weekday morning, read the shared inbox and the calendar of the day.",
  "Write a short briefing with three sections: what needs an answer today,",
  "what is waiting on someone else, and what can wait.",
].join(" ");
const routine = {
  id: "r1", botId: bot.id, name: "Morning briefing", prompt, target: "bot", runOn: "maus",
  enabled: true, durationMinutes: 30, timeoutMinutes: 45, createdAt: 1, updatedAt: 1,
  canRun: true, canEdit: true, postResults: true,
  schedule: { type: "cron", expression: "11 8 * * 1-5", timeZone: "America/Toronto" },
  nextRunAt: NOW + 16 * 3_600_000, weekRuns: { ok: 4, total: 5 },
} as unknown as Routine;
const tableOutput = [
  "Good morning. Three items need an answer today.",
  "",
  "| Area | Open items | Needs you |",
  "| --- | ---: | :---: |",
  "| Support inbox | 4 | yes |",
  "| Vendor quotes | 2 | yes |",
  "",
  "Everything else can wait until Thursday.",
].join("\n");
const run = {
  id: "run-1", routineId: routine.id, routineName: routine.name, prompt, botId: bot.id, target: "bot",
  runOn: "maus", scheduledFor: NOW - 8 * 3_600_000, createdAt: NOW - 8 * 3_600_000,
  startedAt: NOW - 8 * 3_600_000 + 20_000, finishedAt: NOW - 8 * 3_600_000 + 4 * 60_000,
  status: "completed", manual: false, output: tableOutput, cost: 0.042, threadId: "atlas-thread",
} as RoutineRun;
const older = {
  ...run, id: "run-0", scheduledFor: NOW - 32 * 3_600_000, createdAt: NOW - 32 * 3_600_000,
  startedAt: NOW - 32 * 3_600_000, finishedAt: NOW - 32 * 3_600_000 + 3 * 60_000,
  output: "Quiet morning. Two vendor quotes to review before Friday.", cost: 0.038,
} as RoutineRun;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/activity/item")) {
    return json({
      item: {
        id: "run:run-1", kind: "routine", botId: bot.id, title: routine.name, status: "finished",
        startedAt: run.startedAt, endedAt: run.finishedAt, updatedAt: run.finishedAt,
        steps: [
          { id: "s1", name: "read_mail", summary: "12 messages since yesterday", ok: true, at: (run.startedAt ?? NOW) + 5_000 },
          { id: "s2", name: "calendar_list", summary: "4 events today", ok: true, at: (run.startedAt ?? NOW) + 12_000 },
          { id: "s3", name: "write_file", summary: "briefing.md", ok: true, at: (run.startedAt ?? NOW) + 45_000 },
        ],
        stepsTruncated: false, files: ["briefing.md"], children: [], canStop: false,
      },
    });
  }
  if (url.includes("/api/bots?")) return json({ bots: [bot], groups: [], sections: [], computerControl: {} });
  if (url.includes("/api/routines")) return json({ routines: [routine], runs: [run, older], scope: "mine", allowed: { mine: true } });
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

function Seed({ children, openDetail = false }: { children: ReactNode; openDetail?: boolean }) {
  const { state, dispatch } = useStore();
  useEffect(() => {
    dispatch({
      type: "hydrate",
      bots: [bot],
      groups: [],
      sections: [],
      computerControl: {},
      config: { viewer: { principalId: "person-1" }, box: { configured: false }, features: {} },
    } as never);
    dispatch({ type: "routinesHydrated", routines: [routine], runs: [run, older] } as never);
    if (openDetail) dispatch({ type: "openRoutine", botId: bot.id, routineId: routine.id } as never);
  }, [dispatch, openDetail]);
  return state.routines.length ? <>{children}</> : null;
}

function PanelShell({ children }: { children: ReactNode }) {
  const panelWidth = Math.min(420, Math.max(320, Math.round(width * 0.32)));
  return (
    <div data-gallery-sample={view} className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
      <div className="relative min-h-0 min-w-0 flex-1 border-r border-hairline/40 bg-inset/40 p-6">
        <div className="text-[13px] text-ink-secondary">Chat column (quiet neighbour)</div>
        <div className="mt-3 rounded-2xl bg-raised/50 p-4 text-[12.5px] text-ink-secondary">Atlas is idle. Open a routine from the panel on the right.</div>
      </div>
      <aside data-gallery-panel="" style={{ width: panelWidth }} className="relative isolate flex h-full min-h-0 flex-col overflow-hidden border-l border-hairline/40 bg-panel">
        {children}
      </aside>
    </div>
  );
}

function RunShell() {
  const column = useExchangeColumn();
  const chatWidth = width >= 1100 ? Math.min(560, Math.round(width * 0.42)) : Math.min(width, 700);
  return (
    <div data-gallery-sample={view} className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
      <div className="relative min-h-0 min-w-0 flex-1 bg-inset/30 p-5">
        <div className="text-[13px] font-medium text-ink">Automations</div>
        <div className="mt-2 text-[12px] text-ink-secondary">Routine list stays usable while the run opens in the chat column.</div>
      </div>
      <div ref={column.ref} style={{ width: chatWidth }} className="relative h-full border-l border-border bg-app">
        <ExchangeColumnProvider node={column.node}>
          {column.node && (
            <RoutineRunExchange
              run={run}
              routine={routine}
              bots={[bot]}
              onClose={() => {}}
              onRunAgain={() => {}}
              onLogs={() => {}}
            />
          )}
        </ExchangeColumnProvider>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      {view === "run" ? (
        <Seed>
          <RunShell />
        </Seed>
      ) : view === "edit" ? (
        <Seed openDetail>
          <PanelShell>
            <RoutineEditor routine={routine} bots={[bot]} lockedBotId={bot.id} presentation="panel" onClose={() => {}} />
          </PanelShell>
        </Seed>
      ) : (
        <Seed openDetail>
          <PanelShell>
            <RoutinesSection bot={bot} routines={[routine]} runs={[run, older]} grouped />
          </PanelShell>
        </Seed>
      )}
    </StoreProvider>
  </StrictMode>,
);
