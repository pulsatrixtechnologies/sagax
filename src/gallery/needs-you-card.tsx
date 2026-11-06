/** Isolated gallery for headless screenshots of the "needs you" card
 * (2026-11-05): what a bot's turn elsewhere (a hand-off, a thread another bot
 * opened, a routine run) left for the person, drawn in their conversation
 * with that bot through the chat's own rows and the real store: the card
 * from a hand-off that reached no card, a hand-off's question with its answers,
 * and a routine run's own card with its items.
 * Neutral fictional bots, clients and tickets. Not shipped in the app.
 * ?width=<px>&height=<px>&skin=<id>&lang=<en|fr> */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { AttentionRow, RoutineRunRow } from "../components/ChatView";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import type { PersonAttentionCard } from "../../shared/person-attention";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") === "fr" ? "fr" : "en");
const width = Number(params.get("width") ?? 900);
const height = Number(params.get("height") ?? 1200);

const NOW = Date.now();
const M = 60_000;
const makeBot = (id: string, name: string, color: string) => ({
  id, threadId: `${id}-thread`, mainThreadId: `${id}-thread`, name, title: "", description: "", color, notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
  tasks: [{ threadId: `${id}-thread`, title: "Main", createdAt: NOW - 48 * 60 * M }, { threadId: `${id}-work`, title: "@Nova · work", createdAt: NOW - 20 * M, openedBy: { botId: "nova", name: "Nova", kind: "work" } }],
}) as unknown as Bot;
const atlas = makeBot("atlas", "Atlas", "blue");
const nova = makeBot("nova", "Nova", "pink");
const link = (id: number) => `https://cw.example.com/v4_6_release/services/system_io/router/openrecord.rails?recordType=ServiceFv&recid=${id}&companyName=example`;

// Two different results, one card each (never the same items twice): a
// hand-off Nova gave Atlas, which reached no card in the person's chat, and
// a routine run whose own card carries its items.
const handoff: PersonAttentionCard = {
  kind: "human", botId: "atlas", botName: "Atlas", threadId: "atlas-work", threadTitle: "@Nova · work", sourceMessageId: "src-1",
  openedBy: { botId: "nova", name: "Nova" },
  items: [
    { text: "**100305** (board 24, Initech) : the client asks for an on-site visit this week. Pick the day; no technician is free before Thursday.", ticketId: 100305, ticketUrl: link(100305) },
  ],
};
// 2026-11-06: the question a hand-off left, with its answers in brackets
const question: PersonAttentionCard = {
  kind: "question", botId: "atlas", botName: "Atlas", threadId: "atlas-work", threadTitle: "@Nova · work", sourceMessageId: "src-2",
  openedBy: { botId: "nova", name: "Nova" },
  items: [
    { text: "Do we open the ConnectWise ticket to document the Initech firewall audit (create, archive only, or nothing for now)?" },
  ],
};
const runCard: PersonAttentionCard = {
  kind: "human", botId: "atlas", botName: "Atlas", sourceMessageId: "run:r1", routineRunId: "run-1", routineName: "Hourly new tickets", threadId: "atlas-run", threadTitle: "Hourly new tickets",
  items: [
    { text: "**100201** (board 1, Acme) : security notice forwarded by a teammate, still New and held \"To sort\". Decide which client it belongs to and whether patching is needed.", ticketId: 100201, ticketUrl: link(100201) },
    { text: "**100202** (board 1, Globex) : third advertising reminder. The close was refused without a reason, so set it to Completed by hand.", ticketId: 100202, ticketUrl: link(100202) },
  ],
};

const messages: Message[] = [
  { id: "ask", role: "user", kind: "text", at: NOW - 30 * M, text: "Import the dispatch routines." } as Message,
  { id: "card", role: "bot", kind: "text", at: NOW - 2 * M, text: "Atlas needs you", attention: handoff, threadRef: { botId: "atlas", threadId: "atlas-work", title: "@Nova · work" } } as unknown as Message,
  { id: "question", role: "bot", kind: "text", at: NOW - 90_000, text: "Atlas has a question for you", attention: question, threadRef: { botId: "atlas", threadId: "atlas-work", title: "@Nova · work" } } as unknown as Message,
  {
    id: "run", role: "bot", kind: "routine.run", at: NOW - M, from: { botId: "atlas" }, attention: runCard,
    routineRun: { runId: "run-1", routineId: "r1", routineName: "Hourly new tickets", status: "completed", scheduledFor: NOW - M,
      summary: "Board 1: two tickets need you (below). Board 24 had no New ticket. No ConnectWise writes; the run is closed." },
  } as unknown as Message,
];

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
    <div data-gallery-sample="needs-you-card" className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
      <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
        <div className="flex min-h-[52px] items-center px-4 text-[14px] font-semibold">Atlas</div>
        <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
          <div className="ml-auto w-fit rounded-2xl bg-accent/15 px-4 py-2.5 text-[14px]">{messages[0]!.text}</div>
          <AttentionRow message={messages[1]!} />
          <AttentionRow message={messages[2]!} />
          <RoutineRunRow message={messages[3]!} botId="atlas" />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><StoreProvider><Shell /></StoreProvider></StrictMode>,
);
