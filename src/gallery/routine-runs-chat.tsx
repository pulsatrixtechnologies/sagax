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
 * chat now (the same stored row in both states). case=watch-wake: a dozen
 * "Proactive: teammate message" rows (wake topic "peer"), each saying in
 * the bot's words there is nothing for the person, among the person's
 * messages and the teammates' notices, as the released app draws what the
 * server wrote (state=before); the server writes none now (state=after).
 * case=streak-failed (#4058): the one summary of a streak whose run failed
 * and paused its routine, just written: a row the chat keeps, with Resume
 * (state=before: the released rule drew it as a passing banner only).
 * Neutral fictional bots and routines; a mocked fetch answers
 * /api, nothing reaches a server. Not shipped in the app.
 * case=form (#4234): a routine run's form drawn at its row, see FORM.
 * case=problem-rows (#4161): every kind of a routine's problem row in one
 * chat, beside the bot's bubbles and a result that ran fine.
 * ?lang=fr|en&skin=<id>&case=chat|streak|streak-again|streak-failed|daily-first|proactive|watch-wake|form|problem-rows&state=before|after */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import { DesktopCapabilitiesProvider } from "../components/DesktopCapabilities";
import { ChatView } from "../components/ChatView";
import type { RoutineRunCardData } from "../../shared/routine-run";
import { parseWidgetInput, widgetToText } from "../../shared/widget";
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
const FAILED_WORDS = say("The mailbox refused to sign in three times in a row.\nThe routine is paused until you sign in again.", "La boîte a refusé la connexion trois fois de suite.\nLa routine est en pause jusqu'à ce que tu te reconnectes.");
/** #4058: written a few seconds ago, so the released rule still showed its banner. */
const STREAK_FAILED: Message[] = [
  ...STREAK.slice(0, 2),
  { ...run("streak-failed", 0, { routineName: MAIL, routineId: "routine-mail", status: "failed", error: FAILED_WORDS, autoPausedAfter: 3,
    repeat: { firstRunId: "run-first", count: 3, since: at + 12 * M, lastAt: Date.now() - 5000, streak: true } }), at: Date.now() - 5000 } as Message,
];
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
/** #3990: the words a teammate's message wake ended with when it had nothing for the person. */
const NOTHING_FOR_YOU = [
  say("Nothing to do on your side.", "Rien à faire de ton côté."),
  say("Nothing to bring up.", "Rien à remonter."),
  say("Iris closed the ticket, nothing is blocked, you have nothing to do.", "Iris a fermé le billet, rien n'est bloqué, tu n'as rien à faire."),
  say("The teammate's note is handled, nothing for you.", "La note du coéquipier est réglée, rien pour toi."),
];
/** One teammate's notice: the bot-to-bot line that stays in the chat. */
const notice = (id: string, minute: number): Message => ({ id, role: "bot", kind: "activity", at: at + minute * M, text: "",
  tool: { name: say("Message from Iris: Ticket update", "Message d'Iris : Suivi du billet"), ok: true }, threadRef: { botId: "iris", threadId: `t-iris-${id}` } } as unknown as Message);
/** The rows as the released app receives them: one per "Proactive:
 * teammate message" wake (sources ["peer"] only), its request answered,
 * completed with the bot's plain words (state=before). The server writes
 * none of them now (state=after): the chat keeps the person's messages and
 * the teammates' notices. */
const WATCH_WAKE: Message[] = [
  ...OPENING,
  ...Array.from({ length: 12 }, (_, index) => {
    const words = NOTHING_FOR_YOU[index % NOTHING_FOR_YOU.length]!;
    const minute = 4 + index * 5;
    const row = run(`wake-${index}`, minute + 1, { routineName: PEER, routineId: "proactive:atlas", status: "completed", summary: words, brief: words, wakeTopic: "peer" });
    const mid = index === 4 ? [person("u2", minute + 2, say("Did the supplier answer?", "Est-ce que le fournisseur a répondu ?")), reply("b2", minute + 3, say("Not yet. I tell you as soon as they do.", "Pas encore. Je te le dis dès qu'il répond."))] : [];
    return [notice(`n${index}`, minute), ...(before ? [row] : []), ...mid];
  }).flat(),
  person("u3", 70, say("Thanks, that is all for today.", "Merci, c'est tout pour aujourd'hui.")),
];
/** #4234: the owner's daily routine that drafts replies and lets the person
 * choose them (case=form): state=before, as the released app drew it (the
 * rounded card with the run's last sentence; the form stayed in the run's
 * hidden task); state=after, the reference's line with the run's words and
 * its form under it, usable there; a plain result and a result with a
 * question for the person beside it. A widget the bot drew in the chat
 * itself (the conforming neighbour) opens the scene. */
const LONG_NAME = say("Nightly backup verification for every site", "Vérification nocturne des sauvegardes de chaque site");
const DRAFT_WORDS = say(
  "I drafted 2 replies for tonight's messages.\n\nUncheck one or hit Skip tonight and that account stays quiet.",
  "J'ai préparé 2 réponses pour les messages de ce soir.\n\nDécoche-en une ou appuie sur Passer ce soir et ce compte reste silencieux.",
);
const draftsForm = parseWidgetInput({
  type: "Card", title: say("Tonight's replies", "Réponses de ce soir"), children: [
    { type: "Checkbox", name: "supplier", label: say("Reply to the supplier: the order ships Monday", "Répondre au fournisseur : la commande part lundi"), defaultChecked: true },
    { type: "Checkbox", name: "landlord", label: say("Reply to the landlord: the visit is confirmed", "Répondre au propriétaire : la visite est confirmée"), defaultChecked: true },
  ],
  confirm: { label: say("Send", "Envoyer"), action: { type: "send_drafts" } },
  cancel: { label: say("Skip tonight", "Passer ce soir"), action: { type: "skip" } },
});
const neighbourForm = parseWidgetInput({
  type: "Card", title: say("Pick a time", "Choisis une heure"), children: [
    { type: "RadioGroup", name: "slot", label: say("Time", "Heure"), options: [{ label: "9:00", value: "9" }, { label: "13:00", value: "13" }] },
  ],
  confirm: { label: say("Book", "Réserver"), action: { type: "book" } },
});
const widgetRow = (id: string, minute: number, parsed: ReturnType<typeof parseWidgetInput>): Message[] =>
  parsed.ok ? [{ id, role: "bot", kind: "widget", at: at + minute * M, text: widgetToText(parsed.value), widget: { v: 1, root: parsed.value } } as Message] : [];
const FORM: Message[] = [
  person("u1", 0, say("Book me a call tomorrow.", "Réserve-moi un appel demain.")),
  ...widgetRow("w-neighbour", 1, neighbourForm),
  run("backups", 40, { routineName: BACKUP, status: "completed", summary: say("All 12 backups completed tonight.", "Les 12 sauvegardes ont réussi ce soir.") }),
  { ...run("invoice", 50, { routineName: say("Invoice check", "Vérification des factures"), status: "completed", summary: say("One invoice waits for your answer.", "Une facture attend ta réponse.") }),
    attention: { kind: "human", items: [{ text: say("Send invoice 100203 now?", "Envoyer la facture 100203 maintenant ?") }], botId: "atlas", botName: "Atlas", threadId: "t-atlas", sourceMessageId: "m" } } as Message,
  run("drafts", 60, { routineName: say("Evening replies", "Réponses du soir"), status: "completed", summary: DRAFT_WORDS, ...(before ? {} : { widgetId: "w-drafts" }) }),
  // the server moves the run's form here and the run's row draws it
  ...(before ? [] : widgetRow("w-drafts", 60, draftsForm)),  // a long name and a long brief: at a narrow width the status words and
  // the brief are cut, the name keeps its room
  run("long-done", 70, { routineName: LONG_NAME, status: "completed", summary: say(
    "Every site answered and all nightly copies were checked against last week's size; two sites took longer than usual but finished before the morning window.",
    "Tous les sites ont répondu et chaque copie de la nuit a été comparée à la taille de la semaine passée ; deux sites ont pris plus de temps que d'habitude, mais ont fini avant la fenêtre du matin.",
  ) }),
  run("long-running", 80, { routineName: LONG_NAME, status: "running", startedAt: at + 79 * M }),
];
/** #4161: every kind of a routine's problem row the chat keeps, beside the
 * bot's bubbles and a result that ran fine (the conforming neighbour): a
 * streak's summary that failed and paused its routine (Resume) with a long
 * sentence, a streak's summary with problems, and a routine whose result
 * needs the person. */
const PROBLEM_ROWS: Message[] = [
  ...OPENING,
  run("streak-failed", 30, { routineName: MAIL, routineId: "routine-mail", status: "failed", error: FAILED_WORDS, autoPausedAfter: 3,
    repeat: { firstRunId: "run-first", count: 3, since: at + 12 * M, lastAt: at + 30 * M, streak: true } }),
  run("streak", 34, { routineName: BACKUP, status: "completed", summary: BACKUP_WORDS, brief: BACKUP_WORDS,
    problems: say("the backup host did not answer", "l'hôte de sauvegarde n'a pas répondu"), repeat: { firstRunId: "run-b", count: 3, since: at + 10 * M, lastAt: at + 34 * M, streak: true } }),
  person("u2", 40, say("Anything I need to do?", "Est-ce que j'ai quelque chose à faire ?")),
  reply("b2", 41, say("One reply waits for you on the supplier thread; the rest is handled.", "Une réponse t'attend dans le fil du fournisseur ; le reste est réglé.")),
  { ...run("needs", 44, { routineName: say("Invoice review", "Revue des factures"), status: "completed", summary: say("Two invoices wait for your approval.", "Deux factures attendent ton approbation."), brief: say("Two invoices wait for your approval.", "Deux factures attendent ton approbation.") }),
    attention: { kind: "human", items: [{ text: say("Approve invoice 1042", "Approuver la facture 1042") }], botId: "atlas", botName: "Atlas", threadId: "t-atlas", sourceMessageId: "m-needs" } } as Message,
  // a result that ran fine, the conforming neighbour: the reference's line
  run("done", 50, { routineName: say("Morning brief", "Briefing du matin"), status: "completed", summary: say("Three meetings today, the first at nine.", "Trois réunions aujourd'hui, la première à neuf heures."), brief: say("Three meetings today, the first at nine.", "Trois réunions aujourd'hui, la première à neuf heures.") }),
];
const messages = which === "form" ? FORM : which === "problem-rows" ? PROBLEM_ROWS : which === "chat" ? CHAT : which === "streak-failed" ? STREAK_FAILED : which === "daily-first" ? DAILY_FIRST : which === "proactive" ? PROACTIVE : which === "watch-wake" ? WATCH_WAKE : STREAK;

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const parsed = new URL(url, location.href);
  if (!parsed.pathname.startsWith("/api/")) return realFetch(input, init);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (parsed.pathname === "/api/bots") return json({ bots: [{ ...atlas, messages }, iris], groups: [], sections: [], computerControl: {} });
  if (parsed.pathname === "/api/approvals") return json({ waiting: [] });
  // the routine the failed streak paused (case=streak-failed: Resume on its row)
  if (parsed.pathname === "/api/routines") return json({ routines: which === "streak-failed" || which === "problem-rows" ? [{ id: "routine-mail", botId: "atlas", name: MAIL, enabled: false, prompt: "", schedule: { type: "interval", everyMinutes: 10 } }] : [], runs: [] });
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
