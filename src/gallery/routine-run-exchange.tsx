/** Isolated gallery for the routine run exchange sheet footer (2026-11-01):
 * long last message, live Stop / Continue / more actions, synthetic data only.
 * ?skin=<id>&lang=<code>&status=completed|running */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ExchangeColumnProvider, useExchangeColumn } from "../components/BotExchangeChip";
import { RoutineRunExchange } from "../components/routines/RoutineRunExchange";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import type { Routine, RoutineRun } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const live = params.get("status") === "running";

const LONG = "Here is the full morning brief for the shared inbox and the open alerts. "
  + "Overnight, two paging events cleared themselves after the retry window, and one "
  + "dependency bump is still waiting on review. The build stayed green. Next steps: "
  + "confirm the bump with Platform, remind Support about the weekly report, and post "
  + "the short summary in the main conversation so everyone can continue from there "
  + "without opening the run logs. Extra lines so the last bubble sits under the action "
  + "band on both a narrow and a wide chat column: keep reading past the fold and make "
  + "sure no words show through the footer buttons when the sheet is open.";

const bot = {
  id: "atlas", threadId: "main", name: "Atlas", color: "blue",
  tasks: [], modelSelection: { instanceId: "t", model: "t" },
} as unknown as Bot;
const routine = {
  id: "r1", botId: "atlas", name: "Morning brief", prompt: "Summarise overnight alerts.",
  target: "bot", runOn: "maus", durationMinutes: 30, enabled: true, canEdit: true, canRun: true,
  createdAt: 1, updatedAt: 1, schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
  postResults: true,
} as Routine;
const base = Date.UTC(2026, 10, 1, 14, 0);
const run = {
  id: "run-1", routineId: "r1", routineName: "Morning brief", botId: "atlas", target: "bot",
  runOn: "maus", scheduledFor: base, createdAt: base, startedAt: base,
  finishedAt: live ? undefined : base + 120_000,
  status: live ? "running" : "completed", manual: false, output: LONG, cost: 0.02,
} as RoutineRun;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/activity/item") || url.includes("/api/bot-activity")) {
    return json({
      item: {
        id: "run:run-1", kind: "routine", botId: "atlas", title: "Morning brief",
        status: live ? "running" : "finished", startedAt: base, endedAt: live ? undefined : base + 120_000,
        steps: [
          { id: "s1", name: "read_mail", ok: true, at: base, summary: "Inbox checked" },
          { id: "s2", name: "write_report", ok: true, at: base + 60_000, summary: "Brief drafted" },
        ],
        stepsTruncated: false, files: [], children: [], canStop: live,
      },
    });
  }
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

function Ready() {
  const { dispatch } = useStore();
  const column = useExchangeColumn();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines: [routine], runs: [run] });
  }, [dispatch]);
  return (
    <div className="h-screen bg-app text-ink" data-gallery="">
      <div ref={column.ref} className="relative h-full max-w-[960px] border-x border-hairline/30 mx-auto">
        <ExchangeColumnProvider node={column.node}>
          {column.node && (
            <RoutineRunExchange
              run={run}
              routine={routine}
              bots={[bot]}
              onClose={() => {}}
              onStop={live ? () => {} : undefined}
              onRunAgain={live ? undefined : () => {}}
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
    <StoreProvider><Ready /></StoreProvider>
  </StrictMode>,
);
