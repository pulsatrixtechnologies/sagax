/** Isolated gallery for headless screenshots of routine run cards in the chat
 * (2026-11-04): each status a run can show (Done with a report, Nothing to
 * report with a hand-off to a teammate, Completed with problems, Failed and
 * paused, Running live), under a team goal card for comparison, through the
 * chat's own row and the real store. Neutral fictional bots and routines.
 * Not shipped in the app.
 * ?width=<px>&height=<px>&skin=<id> (pulsatrix: dark, pulsatrix-light: light) */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { ChatMarkdown } from "../components/ChatMarkdown";
import { AttentionRow, RoutineRunRow } from "../components/ChatView";
import { GoalRunCard } from "../components/GoalRunCard";
import { chatBubbleWidth, useChatBubbleWidthClasses } from "../lib/chat-bubble-width";
import { loadLocale } from "../lib/i18n";
import { prefersWideBubble } from "../lib/rich-blocks";
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
/** ?scene=report: one finished run with a long report (headings, two tables, lists)
 * under a normal bot reply, to compare the two renderings side by side (#2081). */
const scene = params.get("scene") ?? "all";

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
const REPORT = `Here is this evening's dispatch pass.

## Board state

| Board | Open | Unassigned | Over SLA |
|---|---|---|---|
| Service desk | 41 | 3 | 2 |
| Projects | 18 | 0 | 0 |
| Alerts | 7 | 7 | 0 |

Three tickets were waiting on a client answer for more than five days; I sent the follow-up note on each one.

## Reassigned

| Ticket | From | To | Why |
|---|---|---|---|
| #4812 | Nova | Atlas | Nova is off tomorrow |
| #4830 | (queue) | Nova | Printer site visit, Nova is on site anyway |

## Left alone

- #4790: the client asked to wait until Monday.
- #4801: the parts order is in transit, nothing to do before Thursday.

Nothing else needs a decision tonight.`;
const NEIGHBOUR = `Two things changed since this morning:

| Item | Before | Now |
|---|---|---|
| Build | red | green |
| Open PRs | 6 | 4 |

The 2 PM meeting moved to 3 PM; the room is the same.`;
const reportRun = card("report", { routineName: "dispatch-gox-pass", status: "completed", summary: REPORT }, NOW - 9 * M);

/** ?scene=unified (#2096, #2098): the bot's conversation with threads off. A
 * live run (Stop beside View run, the hand-off as one grey line), a question
 * answered in place (no Open thread) and the finished report, in the chat. */
const liveRun = card("live", {
  routineName: "dispatch-gox-pass", status: "running", startedAt: NOW - 1 * M - 20_000,
  handedTo: [{ botId: "nova", threadId: "nova-run", name: "Nova", status: "running" }],
} as Partial<RoutineRunCardData> & Pick<RoutineRunCardData, "routineName" | "status">, NOW - 2 * M);
const question: Message = {
  id: "question", role: "bot", kind: "text", at: NOW - 5 * M, from: { botId: "atlas" },
  text: "Atlas has a question for you: Which agreement do I bill #4812 to?",
  attention: {
    id: "attention-1", kind: "question", botId: "atlas", botName: "Atlas", threadId: "atlas-job", routineName: "dispatch-gox-pass", createdAt: NOW - 5 * M,
    items: [{ text: "Which agreement do I bill **#4812** to? The client has two active ones.", ticketId: 4812, ticketUrl: "https://example.test/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=4812" }],
  },
} as unknown as Message;

/** A bot reply as ChatView's own Bubble renders it (same classes, same markdown). */
function NeighbourBubble({ text }: { text: string }) {
  const widths = useChatBubbleWidthClasses();
  return (
    <div data-chat-bubble className={`text-[13px] leading-5 rounded-[18px] bg-bubble-bot px-3 py-[7px] text-ink ${widths[chatBubbleWidth({ terminal: false, wide: prefersWideBubble(text) })]}`}>
      <ChatMarkdown text={text} inert />
    </div>
  );
}

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
          {scene === "report" ? (
            <>
              <div className="ml-auto w-fit rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink">What changed today?</div>
              <NeighbourBubble text={NEIGHBOUR} />
              <RoutineRunRow message={reportRun} botId="atlas" />
            </>
          ) : scene === "unified" ? (
            <>
              <RoutineRunRow message={reportRun} botId="atlas" />
              <AttentionRow message={question} />
              <div className="ml-auto w-fit rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink">Run the dispatch pass again.</div>
              <RoutineRunRow message={liveRun} botId="atlas" />
            </>
          ) : (
            <>
              <GoalRunCard message={goal} />
              <div className="ml-auto w-fit rounded-2xl bg-accent/15 px-4 py-2.5 text-[14px]">Run my routines and tell me how they went.</div>
              <div className="w-fit max-w-[min(42rem,88%)] rounded-2xl bg-card px-4 py-2.5 text-[14px] leading-relaxed text-ink">Sure. Each run shows below as it goes.</div>
              {messages.map((message) => <RoutineRunRow key={message.id} message={message} botId="atlas" onResume={message.id === "failed" ? () => {} : undefined} />)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><StoreProvider><Shell /></StoreProvider></StrictMode>,
);
