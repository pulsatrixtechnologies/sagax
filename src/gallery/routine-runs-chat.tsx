/** Isolated gallery for headless captures of a bot's chat that routines
 * report to (#3990), drawn by the real chat (ChatView): the person's
 * messages, the bot's replies, a teammate's line, and the rows and cards
 * that routine runs left there before (a trigger-started routine "with
 * problems", "works again", the same problem again, a wake with its
 * feedback strip, a run with nothing to report). The chat draws none of
 * those rows now; they stay in the routine's run log. case=streak and
 * case=streak-again show the one summary card that remains, at three runs
 * with problems in a row and turned to works again. case=daily-first: a
 * routine that runs once a day tells its first problem at once, as the one
 * summary (state=before: the run's own card as it was written before).
 * case=proactive: the result card a wake on a teammate's message stored
 * before, drawn by the released app (state=before) and left out of the
 * chat now (the same stored row in both states). Neutral fictional bots and routines; a mocked fetch answers
 * /api, nothing reaches a server. Not shipped in the app.
 * ?lang=fr|en&skin=<id>&case=chat|streak|streak-again|daily-first|proactive&state=before|after */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import { DesktopCapabilitiesProvider } from "../components/DesktopCapabilities";
import { ChatView } from "../components/ChatView";
import type { RoutineRunCardData } from "../../shared/routine-run";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const fr = lang === "fr";
const say = (en: string, french: string) => (fr ? french : en);
const which = params.get("case") ?? "chat";

const bot = (id: string, name: string, color: string): Bot =>
  ({ id, threadId: `t-${id}`, name, title: "", description: "", notifications: true, color, unread: false, ownerUserId: "pr_me", modelSelection: { instanceId: "fake", model: "test" }, messages: [], tasks: [] }) as unknown as Bot;
const atlas = bot("atlas", "Atlas", "pink");
const iris = bot("iris", "Iris", "orange");
const M = 60_000;
const at = Date.now() - 90 * M;

const run = (id: string, minute: number, card: Partial<RoutineRunCardData> & { routineName: string; status: string }): Message => ({
  id, role: "bot", kind: "routine.run", at: at + minute * M, text: card.routineName,
  routineRun: { runId: `run-${id}`, routineId: `routine-${id}`, executionThreadId: `t-run-${id}`, ...card } as RoutineRunCardData,
} as unknown as Message);

const MAIL = say("New email", "Nouveau courriel");
const PEER = say("Proactive: teammate message", "Proactif : message d'un coéquipier");
const WATCH = say("Work watch", "Veille du travail");
const NOTHING = say("Nothing urgent, and it is no longer in the inbox.", "Rien d'urgent, et il n'est plus dans la boîte de réception.");
const VERDICT = say("I already gave my verdict in its thread, nothing in the message needs an answer from me.", "J'ai déjà donné mon avis dans son fil, rien dans le message n'attend de réponse de ma part.");

const person = (id: string, minute: number, text: string): Message => ({ id, role: "user", kind: "text", at: at + minute * M, text } as Message);
const reply = (id: string, minute: number, text: string): Message => ({ id, role: "bot", kind: "text", at: at + minute * M, text } as Message);

/** The chat of the owner's screenshots, in neutral words. */
const CHAT: Message[] = [
  person("u1", 0, say("Watch the support inbox for me today.", "Surveille la boîte de soutien pour moi aujourd'hui.")),
  reply("b1", 1, say("Okay. I watch it and tell you only what needs you.", "D'accord. Je la surveille et je te dis seulement ce qui a besoin de toi.")),
  // a card stored before: the same problem again, four runs in a row
  run("old", 4, { routineName: MAIL, status: "completed", summary: NOTHING, brief: NOTHING, problems: say("Get message failed 2 times", "Lire le message a échoué 2 fois"),
    repeat: { firstRunId: "run-first", count: 4, since: at - 60 * M, lastAt: at + 4 * M } }),
  run("peer", 8, { routineName: PEER, status: "completed", summary: VERDICT, brief: VERDICT, problems: say("The run ended on an announcement", "L'exécution s'est terminée sur une annonce"), wakeTopic: "peer" }),
  { id: "x1", role: "bot", kind: "activity", at: at + 9 * M, text: "", tool: { name: say("Message from Iris: Supplier reply", "Message d'Iris : Réponse du fournisseur"), ok: true }, threadRef: { botId: "iris", threadId: "t-iris-1" } } as unknown as Message,
  run("again", 12, { routineName: MAIL, status: "completed", summary: say("Filed the receipt.", "Reçu classé."), brief: say("Filed the receipt.", "Reçu classé."), recovered: { afterRuns: 2, since: at - 20 * M } }),
  run("quiet", 14, { routineName: WATCH, status: "nothing_to_report" }),
  run("blocked", 15, { routineName: WATCH, status: "blocked", error: say("The engine is signed out", "Le moteur est déconnecté") }),
  person("u2", 20, say("Anything I need to do?", "Est-ce que j'ai quelque chose à faire ?")),
  reply("b2", 21, say("One reply waits for you on the supplier thread; the rest is handled.", "Une réponse t'attend dans le fil du fournisseur ; le reste est réglé.")),
  run("mine", 24, { routineName: say("Morning brief", "Briefing du matin"), status: "completed", startedBy: "person", summary: say("Three meetings today, the first at nine.", "Trois réunions aujourd'hui, la première à neuf heures."), brief: say("Three meetings today, the first at nine.", "Trois réunions aujourd'hui, la première à neuf heures.") }),
];

const STREAK_WORDS = say("The mailbox has refused every move for twenty minutes: sign in to it again.", "La boîte refuse chaque déplacement depuis vingt minutes : reconnecte-toi.");
const STREAK: Message[] = [
  person("u1", 0, say("Watch the support inbox for me today.", "Surveille la boîte de soutien pour moi aujourd'hui.")),
  reply("b1", 1, say("Okay. I watch it and tell you only what needs you.", "D'accord. Je la surveille et je te dis seulement ce qui a besoin de toi.")),
  which === "streak-again"
    ? run("streak", 30, { routineName: MAIL, status: "completed", summary: STREAK_WORDS, brief: STREAK_WORDS, recovered: { afterRuns: 4, since: at + 12 * M, streak: true } })
    : run("streak", 30, { routineName: MAIL, status: "completed", summary: STREAK_WORDS, brief: STREAK_WORDS, problems: say("the mailbox refused the move", "la boîte a refusé le déplacement"),
      repeat: { firstRunId: "run-first", count: 3, since: at + 12 * M, lastAt: at + 30 * M, streak: true } }),
];
const before = params.get("state") === "before";
const OPENING = STREAK.slice(0, 2);
const BACKUP = say("Backup check", "Vérification des sauvegardes");
const BACKUP_WORDS = say("The backup host did not answer this morning: check that it is on.", "L'hôte de sauvegarde n'a pas répondu ce matin : vérifie qu'il est allumé.");
const DAILY_FIRST: Message[] = [
  ...OPENING,
  run("daily", 30, { routineName: BACKUP, status: "completed", summary: BACKUP_WORDS, brief: BACKUP_WORDS, problems: say("the backup host did not answer", "l'hôte de sauvegarde n'a pas répondu"),
    ...(before ? {} : { repeat: { firstRunId: "run-daily", count: 1, since: at + 30 * M, lastAt: at + 30 * M, streak: true as const } }) }),
];
const PEER_WORDS = say("I read Iris's note: the ticket is closed and nothing needs you.", "J'ai lu la note d'Iris : le billet est fermé et rien n'a besoin de toi.");
const PROACTIVE: Message[] = [
  ...OPENING,
  { id: "x1", role: "bot", kind: "activity", at: at + 9 * M, text: "", tool: { name: say("Message from Iris: Ticket closed", "Message d'Iris : Billet fermé"), ok: true }, threadRef: { botId: "iris", threadId: "t-iris-1" } } as unknown as Message,
  // the same stored card in both states: the chat's own filter leaves it out
  run("peer", 10, { routineName: PEER, status: "completed", summary: PEER_WORDS, brief: PEER_WORDS, wakeTopic: "peer" }),
];
const messages = which === "chat" ? CHAT : which === "daily-first" ? DAILY_FIRST : which === "proactive" ? PROACTIVE : STREAK;

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const parsed = new URL(url, location.href);
  if (!parsed.pathname.startsWith("/api/")) return realFetch(input, init);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (parsed.pathname === "/api/bots") return json({ bots: [{ ...atlas, messages }, iris], groups: [], sections: [], computerControl: {} });
  if (parsed.pathname === "/api/approvals") return json({ waiting: [] });
  if (parsed.pathname === "/api/config") return json({ profile: { name: "Alex", email: "alex@example.test" }, viewer: { principalId: "pr_me", role: "member" } });
  return json({ error: "gallery" }, 404);
}) as typeof window.fetch;
class SilentEventSource {
  onmessage = null;
  onerror = null;
  onopen = null;
  readyState = 0;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
(window as unknown as { EventSource: unknown }).EventSource = SilentEventSource;

function Chat() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    if (state.hydrated && state.selectedId !== "atlas") dispatch({ type: "select", id: "atlas" });
  }, [state.hydrated, state.selectedId, dispatch]);
  const one = state.bots.find((candidate) => candidate.id === "atlas");
  return (
    <div data-shot="chat" className="flex h-dvh bg-app text-ink">
      {one && state.selectedId === "atlas" ? <ChatView bot={one} /> : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><DesktopCapabilitiesProvider><Chat /></DesktopCapabilitiesProvider></StoreProvider>
  </StrictMode>,
);
