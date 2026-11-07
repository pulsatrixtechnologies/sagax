/** Isolated gallery for headless screenshots of a question asked by a
 * parallel task (#2082, 2026-11-05): the conversation it serves (its task
 * card in the thread, then the composer area drawn over the end of the
 * thread as the app does), next to the task's own conversation, where the
 * question lives inline with its choices. Uses the real store, the real
 * useParallelCards hook and the real composer strip. Neutral fictional
 * bot and projects. Not shipped in the app.
 * ?width=<px>&height=<px>&skin=<id>&lang=<en|fr> */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { ComposerPendingStrip } from "../components/Composer.tsx-parts/ComposerPendingStrip";
import { optionsCardRow } from "../components/OptionsCardRow";
import { ParallelTaskCard } from "../components/ParallelTaskCard";
import { useParallelCards } from "../components/parallel-approvals";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") === "fr" ? "fr" : "en";
await loadLocale(lang);
const width = Number(params.get("width") ?? 1400);
const height = Number(params.get("height") ?? 760);

const NOW = Date.now();
const M = 60_000;
const TASK = "orla-task";
const bot = {
  id: "orla", threadId: "orla-thread", mainThreadId: "orla-thread", name: "Orla", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "test" },
  tasks: [
    { threadId: "orla-thread", title: "Main", createdAt: NOW - 48 * 60 * M },
    { threadId: TASK, title: "Proactive teammate message", createdAt: NOW - 10 * M, updatedAt: NOW - M, activity: "waiting-on-you",
      parallelOf: { threadId: "orla-thread" } },
  ],
} as unknown as Bot;

const question: Message = {
  id: "q1", role: "bot", kind: "options", at: NOW - M,
  card: {
    title: "", subtitle: "", options: [], requestId: "req-q1", requestType: "question",
    questionRequest: { version: 1, questions: [{
      header: lang === "fr" ? "Projets à décider" : "Projects to decide",
      question: lang === "fr"
        ? "Trois projets attendent une décision cette semaine : la migration des postes de l'équipe comptable, le renouvellement du pare-feu du siège et le nettoyage des comptes inactifs. Lequel je priorise d'abord, sachant que le pare-feu arrive à échéance vendredi et que la migration demande deux soirs de travail planifiés avec le client ?"
        : "Three projects wait for a decision this week: moving the accounting team's computers, renewing the head office firewall and cleaning up inactive accounts. Which one do I take first, knowing the firewall expires Friday and the move needs two evenings planned with the client?",
      options: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }],
    }] },
  },
} as unknown as Message;

const thread: Message[] = [
  { id: "u1", role: "user", kind: "text", at: NOW - 30 * M, text: lang === "fr" ? "Fais le tour des projets ouverts et dis-moi où on en est." : "Go over the open projects and tell me where we stand." } as Message,
  { id: "b1", role: "bot", kind: "text", at: NOW - 28 * M, text: lang === "fr"
    ? "Voici l'état des projets ouverts. La migration des postes avance, il reste deux soirs à planifier. Le pare-feu du siège arrive à échéance vendredi. Le nettoyage des comptes inactifs est prêt à partir dès que tu confirmes la liste."
    : "Here is where the open projects stand. The computer move is on track, two evenings left to plan. The head office firewall expires Friday. The inactive accounts cleanup is ready as soon as you confirm the list." } as Message,
  { id: "card", role: "bot", kind: "text", at: NOW - 10 * M, text: "", parallelTask: { role: "card", threadId: TASK, title: "Proactive teammate message", startedAt: NOW - 10 * M } } as unknown as Message,
  { id: "b2", role: "bot", kind: "text", at: NOW - 5 * M, text: lang === "fr"
    ? "Je continue ici avec le suivi des billets de la semaine : quatre sont fermés, deux attendent le client et un est à reprendre demain matin avec le technicien."
    : "I keep going here with this week's tickets: four are closed, two wait on the client and one picks up tomorrow morning with the technician." } as Message,
];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes(`/api/threads/${TASK}/messages`)) return json({ messages: [question] });
  if (url.includes("/api/bots?")) return json({ bots: [bot], groups: [], sections: [], computerControl: {} });
  if (url.includes("/api/routines")) return json({ routines: [], runs: [], scope: "mine", allowed: { mine: true, team: false, all: false }, facets: { teams: [], owners: [], botChoices: [] } });
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

function Bubble({ message }: { message: Message }) {
  return message.role === "user"
    ? <div className="ml-auto w-fit max-w-[80%] rounded-2xl bg-accent/15 px-4 py-2.5 text-[14px]">{message.text}</div>
    : <div className="max-w-[90%] text-[14px] leading-6">{message.text}</div>;
}

function Pane({ title, children, composer, sample }: { title: string; children: React.ReactNode; composer?: React.ReactNode; sample: string }) {
  return (
    <div data-gallery-pane={sample} className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col border-r border-hairline/40">
      <div className="flex min-h-[52px] items-center px-4 text-[14px] font-semibold">{title}</div>
      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-end gap-3 overflow-hidden px-6 pb-[132px] pt-4">{children}</div>
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[640px] px-6 pb-4">
        {composer}
        <div className="rounded-2xl border border-hairline/60 bg-panel px-4 py-3 text-[14px] text-ink-tertiary">{lang === "fr" ? "Écris à Orla" : "Message Orla"}</div>
      </div>
    </div>
  );
}

function Shell() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines: [], runs: [] });
    dispatch({ type: "select", id: "orla" });
  }, [dispatch]);
  const live = state.bots.find((candidate) => candidate.id === "orla");
  const cards = useParallelCards(live) as { pendings: never[]; questions?: unknown[] };
  // before #2082 the strip also took the task's questions
  const strip = { parallelQuestions: cards.questions ?? [] } as Record<string, unknown>;
  return (
    <div data-gallery-sample="parallel-question" className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
      <Pane sample="source" title="Orla" composer={live && (
        <ComposerPendingStrip bot={live} approvals={[]} threadId="orla-thread" approvalBotFor={() => live} onCancelTurn={() => {}} {...strip} />
      )}>
        {thread.map((message) => message.parallelTask
          ? <ParallelTaskCard key={message.id} message={message} botId="orla" />
          : <Bubble key={message.id} message={message} />)}
      </Pane>
      <Pane sample="task" title={lang === "fr" ? "Orla · Proactive teammate message" : "Orla · Proactive teammate message"}>
        {optionsCardRow({ message: question, transcript: [question], botId: "orla", botName: "Orla", threadId: TASK })}
      </Pane>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><StoreProvider><Shell /></StoreProvider></StrictMode>,
);
