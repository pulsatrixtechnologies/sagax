/** Isolated gallery for headless screenshots of routine run cards in the chat
 * (2026-11-04): each status a run can show (Done with a report, Nothing to
 * report with a hand-off to a teammate, Completed with problems, Failed and
 * paused, Running live), under a team goal card for comparison, through the
 * chat's own row and the real store. Neutral fictional bots and routines.
 * Not shipped in the app.
 * ?width=<px>&height=<px>&skin=<id> (pulsatrix: dark, pulsatrix-light: light) */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { RoutineRunRow } from "../components/ChatView";
import { GoalRunCard } from "../components/GoalRunCard";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import type { RoutineRunCardData } from "../../shared/routine-run";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale("en");
const width = Number(params.get("width") ?? 900);
const height = Number(params.get("height") ?? 1500);

const NOW = Date.now();
const M = 60_000;
const makeBot = (id: string, name: string, color: string) => ({
  id, threadId: `${id}-thread`, mainThreadId: `${id}-thread`, name, title: "", description: "", color, notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" }, tasks: [{ threadId: `${id}-thread`, title: "Main", createdAt: NOW - 48 * 60 * M }],
}) as unknown as Bot;
const atlas = makeBot("atlas", "Atlas", "blue");
const nova = makeBot("nova", "Nova", "pink");

const card = (id: string, run: Partial<RoutineRunCardData> & Pick<RoutineRunCardData, "routineName" | "status">, at: number): Message => ({
  id, role: "bot", kind: "routine.run", at, from: { botId: "atlas" },
  routineRun: { runId: `run-${id}`, routineId: `r-${id}`, scheduledFor: at, ...run },
}) as unknown as Message;

const messages: Message[] = [
  card("done", { routineName: "Morning brief", status: "completed", summary: "Three things today:\n\n- The build is green.\n- Two dependency updates are waiting.\n- One meeting moved to 2 PM." }, NOW - 50 * M),
  card("quiet", { routineName: "Close past meetings", status: "nothing_to_report", handedTo: [{ botId: "nova", threadId: "nova-work", name: "Nova", status: "completed" }] }, NOW - 31 * M),
  card("problems", { routineName: "Weekly inventory", status: "completed", summary: "Counted 42 items; the shelf list is updated.", problems: "One supplier page did not load." }, NOW - 20 * M),
  card("failed", { routineName: "Backup check", status: "failed", error: "The storage service did not answer after three tries.", autoPausedAfter: 3 }, NOW - 12 * M),
  card("running", { routineName: "Project health watch", status: "running", startedAt: NOW - 2 * M - 14_000, handedTo: [{ botId: "nova", threadId: "nova-run", name: "Nova", status: "running" }] } as Partial<RoutineRunCardData> & Pick<RoutineRunCardData, "routineName" | "status">, NOW - 3 * M),
];
const goal: Message = {
  id: "goal", role: "bot", kind: "goal.run", at: NOW - 60 * M, from: { botId: "atlas" },
  goalRun: { runId: "g1", goal: "Prepare the launch checklist", status: "working", coordinatorBotId: "atlas", coordinatorName: "Atlas", turnCount: 2, maxTurns: 6, startedAt: NOW - 60 * M },
} as unknown as Message;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/bots?")) return json({ bots: [atlas, nova], groups: [], sections: [], computerControl: {} });
  if (url.includes("/api/routines")) return json({ routines: [], runs: [], scope: "mine", allowed: { mine: true, team: false, all: false }, facets: { teams: [], owners: [], botChoices: [] } });
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

function Shell() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [atlas, nova], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines: [], runs: [] });
    dispatch({ type: "select", id: "atlas" });
  }, [dispatch]);
  return (
    <div data-gallery-sample="routine-run-cards" className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
      <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
        <div className="flex min-h-[52px] items-center px-4 text-[14px] font-semibold">Atlas</div>
        <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
          <GoalRunCard message={goal} />
          <div className="ml-auto w-fit rounded-2xl bg-accent/15 px-4 py-2.5 text-[14px]">Run my routines and tell me how they went.</div>
          <div className="w-fit max-w-[min(42rem,88%)] rounded-2xl bg-card px-4 py-2.5 text-[14px] leading-relaxed text-ink">Sure. Each run shows below as it goes.</div>
          {messages.map((message) => <RoutineRunRow key={message.id} message={message} botId="atlas" onResume={message.id === "failed" ? () => {} : undefined} />)}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><StoreProvider><Shell /></StoreProvider></StrictMode>,
);
