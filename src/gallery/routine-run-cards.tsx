/** Isolated gallery for headless screenshots of routine run cards in the chat
 * (2026-11-04 / #2081): a clean Done report reads as a normal bot message
 * under a provenance line; status cards stay for Nothing to report (with a
 * hand-off), Completed with problems, Failed and paused, Running live. Under
 * a team goal card for comparison, through the chat's own row and the real
 * store. Neutral fictional bots and routines. Not shipped in the app.
 * ?width=<px>&height=<px>&skin=<id> (pulsatrix: dark, pulsatrix-light: light)
 * ?scene=delegation (2026-11-06): a run that handed work to three teammates,
 * Done and Running mixed, as Grok Bot's sub-agent list.
 * ?scene=feedback (#2694): a heartbeat and a mail wake rated in place, a
 * "needs you" card and each point of a brief, beside a suggestion card
 * (the compliant neighbour, OptionCard with its feedback row). */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { ChatMarkdown } from "../components/ChatMarkdown";
import { AttentionRow, RoutineRunRow } from "../components/ChatView";
import { CodingJobCard } from "../components/CodingJobCard";
import { GoalRunCard } from "../components/GoalRunCard";
import { NewMessagesDivider } from "../components/NewMessagesDivider";
import { OptionCard } from "../components/OptionCard";
import { BriefItemsFeedback } from "../components/WakeFeedback";
import type { BotActivityItem } from "../lib/bot-activity";
import { chatBubbleWidth, useChatBubbleWidthClasses } from "../lib/chat-bubble-width";
import { codingJobView } from "../lib/coding-job-card";
import { loadLocale } from "../lib/i18n";
import { prefersWideBubble } from "../lib/rich-blocks";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import type { RoutineRunCardData } from "../../shared/routine-run";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(new URLSearchParams(location.search).get("lang") === "fr" ? "fr" : "en");
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
const teammate = (id: string, name: string, color: string, model: string, threadId: string, busy: boolean) => {
  const bot = makeBot(id, name, color) as unknown as { modelSelection: unknown; tasks: unknown[] };
  bot.modelSelection = { instanceId: "test", model };
  bot.tasks = [...bot.tasks, { threadId, title: name, createdAt: NOW - 10 * M, busy, activity: busy ? "working" : "idle" }];
  return bot as unknown as Bot;
};
const harrie = teammate("harrie", "Harrie", "green", "Opus 4.7", "harrie-work", false);
const orla = teammate("orla", "Orla", "orange", "Sonnet 4.6", "orla-work", true);
const quill = teammate("quill", "Quill", "purple", "Haiku 4.5", "quill-work", true);
const team = [atlas, nova, harrie, orla, quill];

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
const delegatedRun = card("delegated", {
  routineName: "dispatch-gox-pass", status: "running", startedAt: NOW - 4 * M,
  handedTo: [
    { botId: "harrie", threadId: "harrie-work", name: "Harrie", status: "completed", task: "Reconcile the bank overage for Northwind", startedAt: NOW - 4 * M, finishedAt: NOW - 1 * M, note: "Moved 2.5 h to the right agreement." },
    { botId: "orla", threadId: "orla-work", name: "Orla", status: "running", task: "Draft the weekly client summary", startedAt: NOW - 3 * M },
    { botId: "quill", threadId: "quill-work", name: "Quill", status: "running", startedAt: NOW - 2 * M },
  ],
} as Partial<RoutineRunCardData> & Pick<RoutineRunCardData, "routineName" | "status">, NOW - 4 * M);
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

const heartbeatWake = card("heartbeat", { routineName: "Heartbeat: Atlas", status: "completed", wakeTopic: "heartbeat", summary: "The backup service stopped at 3:10 AM. I restarted it; it is running again." }, NOW - 40 * M);
const mailWake = card("mailwake", { routineName: "Mail", status: "completed", wakeTopic: "mail", feedback: "less", summary: "Carla asked for the signed quote; I drafted the answer in your Drafts folder." }, NOW - 30 * M);
const BRIEF_ITEMS = [
  { id: "b1", text: "Answer Carla about the signed quote (Outlook)" },
  { id: "b2", text: "Follow up with Paul on the renewal (Outlook)", feedback: "up" as const },
  { id: "b3", text: "Read the release thread (Teams)" },
];
const brief: Message = {
  id: "brief", role: "bot", kind: "text", at: NOW - 20 * M, from: { botId: "atlas" },
  text: "**Today's brief**\n\n" + BRIEF_ITEMS.map((item) => `- ${item.text} (2026-11-08)`).join("\n"),
  briefItems: BRIEF_ITEMS,
} as unknown as Message;
const proposal: Message = {
  id: "proposal", role: "bot", kind: "options", at: NOW - 10 * M, from: { botId: "atlas" },
  card: { title: "Carla asked for the signed quote. Should I draft the answer?", subtitle: "", options: ["Yes, handle it", "No thanks"], requestId: "req-proposal", proactiveProposal: { id: "p1" } },
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

/** ?scene=card (#2719): a realistic stretch of Atlas's conversation with
 * two hand-offs as cards (one finished and folded, one still running and
 * open) between normal bubbles, under the finished coding job card (#2148,
 * the conforming neighbour) and across the "New" separator. A click on
 * Orla's row opens her work right there (her messages come from the fetch
 * override below). */
const finishedRun = card("finished", {
  routineName: "dispatch-gox-pass", status: "completed", startedAt: NOW - 70 * M, finishedAt: NOW - 62 * M,
  summary: "Morning pass done: 41 open tickets, 3 reassigned, nothing over SLA. Harrie fixed the Northwind overage and Orla sent the weekly summary.",
  handedTo: [
    { botId: "harrie", threadId: "harrie-work-1", name: "Harrie", status: "completed", task: "Reconcile the bank overage for Northwind", startedAt: NOW - 70 * M, finishedAt: NOW - 66 * M, note: "Moved 2.5 h to the right agreement." },
    { botId: "orla", threadId: "orla-work-1", name: "Orla", status: "completed", task: "Draft the weekly client summary", startedAt: NOW - 69 * M, finishedAt: NOW - 63 * M, note: "Summary sent to the three account managers." },
  ],
} as Partial<RoutineRunCardData> & Pick<RoutineRunCardData, "routineName" | "status">, NOW - 70 * M);
const activeRun = card("active", {
  routineName: "dispatch-gox-pass", status: "running", startedAt: NOW - 4 * M,
  handedTo: [
    { botId: "harrie", threadId: "harrie-work", name: "Harrie", status: "completed", task: "Reconcile the bank overage for Northwind", startedAt: NOW - 4 * M, finishedAt: NOW - 1 * M, note: "Moved 2.5 h to the right agreement." },
    { botId: "orla", threadId: "orla-work", name: "Orla", status: "running", task: "Draft the weekly client summary", startedAt: NOW - 3 * M },
  ],
} as Partial<RoutineRunCardData> & Pick<RoutineRunCardData, "routineName" | "status">, NOW - 4 * M);
/** The finished coding job of src/gallery/coding-job-cards.tsx, as the neighbour card. */
const codingJob = {
  id: "thread:job-0", kind: "session", botId: "atlas", botName: "Atlas", title: "Ajouter le widget des outils TI", status: "finished",
  startedAt: NOW - 52 * M, endedAt: NOW - 31 * M, updatedAt: NOW - 31 * M, threadId: "job-0", coding: true,
  code: {
    folder: "/srv/repos/marketplace", branch: "feat/it-tools-widget", repo: "acme/marketplace",
    pullRequests: [{ repo: "acme/marketplace", number: 42, title: "Widget des outils TI", url: "https://github.com/acme/marketplace/pull/42", action: "opened", branch: "feat/it-tools-widget", at: NOW - 32 * M }],
    branches: [{ name: "feat/it-tools-widget", repo: "acme/marketplace", pushed: true, url: "https://github.com/acme/marketplace/tree/feat/it-tools-widget", at: NOW - 33 * M }],
    commits: [],
  },
} as unknown as BotActivityItem;
const codingResult = "J'ai ajouté le widget en grille de trois colonnes, avec ses tests. Les 48 tests passent et la PR est ouverte.";
/** Orla's work conversation (what the click on her row shows). */
const orlaMessages: Message[] = [
  { id: "o1", role: "user", kind: "text", at: NOW - 3 * M, text: "Draft the weekly client summary for the three account managers: closed tickets, open escalations and the two projects that moved this week. Send it to them when it reads well." },
  { id: "o2", role: "bot", kind: "text", at: NOW - 3 * M + 20_000, turnId: "t1", text: "I'll pull this week's closed tickets and the open escalations first." },
  { id: "o3", role: "bot", kind: "activity", at: NOW - 3 * M + 40_000, turnId: "t1", tool: { name: "cw_psa_find_tickets", ok: true, durationMs: 1_840, input: "closedFlag=true closedSince=this week", output: "14 tickets" } },
  { id: "o4", role: "bot", kind: "activity", at: NOW - 2 * M, turnId: "t1", tool: { name: "cw_psa_find_project_tickets", ok: true, durationMs: 960, input: "projects=Northwind rollout, Contoso VoIP", output: "2 projects, 6 tickets moved" } },
  { id: "o5", role: "bot", kind: "text", at: NOW - 1 * M, turnId: "t1", text: "14 tickets closed, 2 escalations still open (one waiting on the client). Drafting the summary now, one paragraph per manager." },
] as unknown as Message[];

// The engine the team's bots run on; also what GET /api/instances answers,
// since the live store reloads that list after hydrate.
const instances = [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" }, models: { options: [{ id: "Opus 4.7", label: "Opus 4.7" }, { id: "Sonnet 4.6", label: "Sonnet 4.6" }, { id: "Haiku 4.5", label: "Haiku 4.5" }] } }];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/bots?")) return json({ bots: team, groups: [], sections: [], computerControl: {} });
  if (url.includes("/api/instances")) return json({ instances });
  if (url.includes("/api/threads/orla-work/messages")) return json({ messages: orlaMessages, activeLeafId: "o5", hasMore: false });
  if (url.includes("/api/routines")) return json({ routines: [], runs: [], scope: "mine", allowed: { mine: true, team: false, all: false }, facets: { teams: [], owners: [], botChoices: [] } });
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

function Shell() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: team, groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "instances", instances } as never);
    dispatch({ type: "routinesHydrated", routines: [], runs: [] });
    dispatch({ type: "select", id: "atlas" });
  }, [dispatch]);
  return (
    <div data-gallery-sample="routine-run-cards" className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
      <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
        <div className="flex min-h-[52px] items-center px-4 text-[14px] font-semibold">Atlas</div>
        <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
          {scene === "card" ? (
            <>
              <div className="ml-auto w-fit rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink">Add the IT tools widget to the marketplace.</div>
              <CodingJobCard job={codingJobView(codingJob, codingResult)} threadId="job-0" now={NOW} />
              <div className="ml-auto w-fit rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink">Run the dispatch pass.</div>
              <RoutineRunRow message={finishedRun} botId="atlas" />
              <NeighbourBubble text="Both teammates are done; the Northwind overage is on the right agreement now." />
              <NewMessagesDivider fading={false} />
              <div className="ml-auto w-fit rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink">Run it again for the evening.</div>
              <RoutineRunRow message={activeRun} botId="atlas" />
            </>
          ) : scene === "report" ? (
            <>
              <div className="ml-auto w-fit rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink">What changed today?</div>
              <NeighbourBubble text={NEIGHBOUR} />
              <RoutineRunRow message={reportRun} botId="atlas" />
            </>
          ) : scene === "delegation" ? (
            <>
              <div className="ml-auto w-fit rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink">Run the dispatch pass.</div>
              <RoutineRunRow message={delegatedRun} botId="atlas" />
            </>
          ) : scene === "feedback" ? (
            <>
              <OptionCard botId="atlas" threadId="atlas-thread" message={proposal} />
              <RoutineRunRow message={heartbeatWake} botId="atlas" threadId="atlas-thread" />
              <RoutineRunRow message={mailWake} botId="atlas" threadId="atlas-thread" />
              <AttentionRow message={question} threadId="atlas-thread" />
              <div>
                <NeighbourBubble text={brief.text ?? ""} />
                <BriefItemsFeedback message={brief} botId="atlas" threadId="atlas-thread" />
              </div>
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
