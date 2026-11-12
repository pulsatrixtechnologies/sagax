/** Isolated gallery for headless screenshots of a routine's result in the
 * chat (#3581): the compact card (AskCard) with the report's closing line in
 * at most two lines and "Details", the one quiet row (AskSettledLine) of a
 * run in progress or a folded result, through the chat's own row and the
 * real store. Every scene opens with the conforming neighbour, the compact
 * approval card (#3414), so each shot holds both. Neutral fictional bots and
 * routines. Not shipped in the app.
 * ?width=<px>&height=<px|auto>&skin=<id>&lang=en|fr&scene=<scene>
 * scenes: states (every state, the default), reports (real-shaped reports: a
 * long one with tables, one that ends with a courtesy, one that is a
 * structure), stack (17 results in one hour, three with problems, as a
 * heavy user's chat), banner (a failed run's passing banner, a paused
 * routine with Resume), room (a room's chat that holds a result), window (the
 * run window that Details opens, with a long report that holds a table),
 * window-gone (the run window opened from a card whose run's record is gone:
 * the card's own report, whole),
 * feedback (wakes rated in place, a watch alert's exits, a brief), card
 * (#2719: two runs that handed work to teammates beside a finished coding
 * job; a click on Tester's row opens its work in the chat), streak-before
 * and streak-after (#3695: a bot's chat after ten runs of a routine that
 * repeats every five minutes, before and after), streak-3, streak-5,
 * streak-again, streak-failed and streak-failed-again (its one summary card
 * at three runs with problems, at five, works again, told by a failed run,
 * and that card turned to works again with the failure words kept),
 * streak-by-hand (#3910: the summary card at four, and below it the card of
 * a run the person started in the middle of the streak, in the same words). */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { PendingApprovalBox, pendingApprovals } from "../components/PendingApproval";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { RoutineRunRow } from "../components/ChatView";
import { ChatViewSheets } from "../components/ChatView.tsx-parts/ChatViewSheets";
import { CodingJobCard } from "../components/CodingJobCard";
import { DesktopCapabilitiesProvider } from "../components/DesktopCapabilities";
import { TransientNotice } from "../components/TransientNotice";
import { BriefItemsFeedback } from "../components/WakeFeedback";
import type { BotActivityItem } from "../lib/bot-activity";
import { chatBubbleWidth, useChatBubbleWidthClasses } from "../lib/chat-bubble-width";
import { codingJobView } from "../lib/coding-job-card";
import { loadLocale } from "../lib/i18n";
import { prefersWideBubble } from "../lib/rich-blocks";
import type { Routine, RoutineRun } from "../lib/routines";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { openRoutineRun, StoreProvider, useStore, type Bot, type Message } from "../state/store";
import type { RoutineRunCardData } from "../../shared/routine-run";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const FR = params.get("lang") === "fr";
await loadLocale(FR ? "fr" : "en");
const width = Number(params.get("width") ?? 900);
const autoHeight = params.get("height") === "auto";
const height = autoHeight ? undefined : Number(params.get("height") ?? 1500);
const scene = params.get("scene") ?? "states";
const say = (en: string, fr: string) => (FR ? fr : en);

const NOW = Date.now();
const M = 60_000;
const makeBot = (id: string, name: string, color: string, messages: Message[] = []) => ({
  id, threadId: `${id}-thread`, mainThreadId: `${id}-thread`, name, title: "", description: "", color, notifications: true, unread: false, busy: false, messages,
  modelSelection: { instanceId: "test", model: "test" }, tasks: [{ threadId: `${id}-thread`, title: "Main", createdAt: NOW - 48 * 60 * M }],
}) as unknown as Bot;

type CardRun = Partial<RoutineRunCardData> & Pick<RoutineRunCardData, "routineName" | "status">;
const card = (id: string, run: CardRun, at: number, extra: Partial<Message> = {}): Message => ({
  id, role: "bot", kind: "routine.run", at, from: { botId: "server" },
  routineRun: { runId: `run-${id}`, routineId: `r-${id}`, scheduledFor: at, ...run },
  ...extra,
}) as unknown as Message;

/** A real-shaped long report: headings, two tables, a list, and the closing
 * line the run contract asks for. */
const LONG_REPORT = say(`Here is this evening's dispatch pass.

## Board state

| Board | Open | Unassigned | Over SLA |
|---|---|---|---|
| Service desk | 41 | 3 | 2 |
| Projects | 18 | 0 | 0 |
| Alerts | 7 | 7 | 0 |

Three tickets waited on a client answer for more than five days; I sent the follow-up note on each one.

## Reassigned

| Ticket | From | To | Why |
|---|---|---|---|
| #4812 | Bot B | Tester | Bot B is off tomorrow |
| #4830 | (queue) | Bot B | On site anyway |

## Left alone

- #4790: the client asked to wait until Monday.
- #4801: the parts order is in transit, nothing to do before Thursday.

3 tickets reassigned, 2 over SLA; nothing else needs a decision tonight.`, `Voici la passe de répartition de ce soir.

## État des tableaux

| Tableau | Ouverts | Sans technicien | Hors SLA |
|---|---|---|---|
| Centre de services | 41 | 3 | 2 |
| Projets | 18 | 0 | 0 |
| Alertes | 7 | 7 | 0 |

Trois billets attendaient une réponse du client depuis plus de cinq jours; j'ai envoyé le suivi sur chacun.

## Réassignés

| Billet | De | À | Pourquoi |
|---|---|---|---|
| #4812 | Bot B | Tester | Bot B est en congé demain |
| #4830 | (file) | Bot B | Déjà sur place |

## Laissés tels quels

- #4790 : le client a demandé d'attendre lundi.
- #4801 : la commande de pièces est en route, rien à faire avant jeudi.

3 billets réassignés, 2 hors SLA; rien d'autre ne demande une décision ce soir.`);
/** A report that ends with a courtesy: the brief is the real line before it, never the courtesy. */
const COURTESY_REPORT = say(
  "I reconciled the 6 open agreements; one is over its bank by 2.5 hours and I moved the extra time to the right agreement.\n\nLet me know if you need anything else!",
  "J'ai rapproché les 6 ententes ouvertes; une dépasse sa banque de 2,5 heures et j'ai déplacé le temps en trop vers la bonne entente.\n\nDis-moi si tu as besoin d'autre chose!",
);
/** A report that is a structure (a bot that ended with JSON). */
const STRUCTURE_REPORT = JSON.stringify({
  summary: say("Bank watch updated: 2 agreements under 10% of their hours.", "Veille des banques à jour : 2 ententes sous 10 % de leurs heures."),
  todo: [say("Approve sheet 100203", "Approuver la feuille 100203")],
}, null, 2);

const reportCard = card("report", { routineName: say("Evening dispatch", "Répartition du soir"), status: "completed", summary: LONG_REPORT }, NOW - 9 * M);
/** A result whose run the run log no longer holds (trimmed after weeks). */
const goneCard = card("gone", { routineName: say("Evening dispatch", "Répartition du soir"), status: "completed", summary: LONG_REPORT }, NOW - 40 * 24 * 60 * M);

/** Every state of a run, through the chat's own row. */
const STATES: Message[] = [
  reportCard,
  card("problems", { routineName: say("New mail triage", "Tri du courriel"), status: "completed",
    summary: say("The mailbox refused the sign-in, so 4 messages were not sorted. Sign in again from Connect apps.", "La boîte a refusé la connexion, donc 4 messages n'ont pas été triés. Reconnecte-toi depuis Connecter des apps."),
    problems: "sign-in refused", repeat: { firstRunId: "run-p0", count: 4, since: NOW - 2 * 24 * 60 * M, lastAt: NOW - 8 * M } }, NOW - 8 * M),
  card("recovered", { routineName: say("Backup check", "Vérification des sauvegardes"), status: "completed",
    summary: say("All 12 backups completed; the largest took 41 minutes.", "Les 12 sauvegardes sont faites; la plus longue a pris 41 minutes."),
    recovered: { afterRuns: 7, since: NOW - 6 * 60 * M } }, NOW - 7 * M),
  card("blocked", { routineName: say("Supplier prices", "Prix des fournisseurs"), status: "blocked",
    error: say("The supplier site asks for a new password.", "Le site du fournisseur demande un nouveau mot de passe.") }, NOW - 6 * M),
  card("manual", { routineName: say("Month-end export", "Export de fin de mois"), status: "running", startedAt: NOW - 2 * M - 14_000 }, NOW - 3 * M),
  card("waiting", { routineName: say("Quote follow-up", "Suivi des soumissions"), status: "waiting",
    attention: say("Waits for your answer on the quote card.", "Attend ta réponse sur la carte de la soumission.") }, NOW - 5 * M),
  card("quiet", { routineName: say("Close past meetings", "Fermer les réunions passées"), status: "nothing_to_report" }, NOW - 4 * M),
  card("items", { routineName: say("Invoice review", "Revue des factures"), status: "completed",
    summary: say("Two invoices are ready; one needs your approval before it goes out.", "Deux factures sont prêtes; une demande ton approbation avant l'envoi.") }, NOW - 3 * M, {
    attention: { id: "att-1", kind: "human", botId: "server", botName: "Server", threadId: "server-run", sourceMessageId: "m", createdAt: NOW - 3 * M,
      items: [{ text: say("Approve invoice **1042** before it goes out.", "Approuve la facture **1042** avant l'envoi.") }] },
  } as Partial<Message>),
  card("asked", { routineName: say("Weekly review", "Revue hebdomadaire"), status: "completed",
    summary: say("Reviewer and Tester checked the release branch; both found nothing to change.", "Reviewer et Tester ont vérifié la branche de version; rien à changer."),
    handedTo: [
      { botId: "reviewer", threadId: "reviewer-work", name: "Reviewer", status: "completed", task: say("Review the release branch", "Revoir la branche de version") },
      { botId: "tester", threadId: "tester-work", name: "Tester", status: "completed", task: say("Run the board tests", "Rouler les tests du tableau") },
    ] }, NOW - 2 * M),
];
const wake = card("wake", { routineName: say("Heartbeat: Server", "Battement : Server"), status: "completed", wakeTopic: "heartbeat",
  summary: say("The backup service stopped at 3:10 AM. I restarted it; it is running again.", "Le service de sauvegarde s'est arrêté à 3 h 10. Je l'ai redémarré; il roule de nouveau.") }, NOW - 1 * M);

/** A heavy user's hour: 17 routines report, three of them with a problem. */
const STACK_NAMES = ["Morning dispatch", "New mail triage", "Backup check", "Calendar sweep", "Invoice review", "Supplier prices", "Ticket aging", "Agreement banks",
  "Certificate watch", "Disk space", "Patch status", "License count", "Quote follow-up", "Time entries", "Project health", "Alert digest", "Close past meetings"];
const STACK_NAMES_FR = ["Répartition du matin", "Tri du courriel", "Vérification des sauvegardes", "Balayage de l'agenda", "Revue des factures", "Prix des fournisseurs", "Âge des billets", "Banques des ententes",
  "Veille des certificats", "Espace disque", "État des correctifs", "Nombre de licences", "Suivi des soumissions", "Entrées de temps", "Santé des projets", "Résumé des alertes", "Fermer les réunions passées"];
const STACK_BRIEFS = [
  say("3 tickets assigned, 1 waits for a part.", "3 billets assignés, 1 attend une pièce."),
  say("Sorted 14 messages; 2 flagged for you.", "14 messages triés; 2 marqués pour toi."),
  say("All 12 backups completed.", "Les 12 sauvegardes sont faites."),
];
const STACK: Message[] = Array.from({ length: 17 }, (_, index) => {
  const at = NOW - (60 - index * 3.5) * M;
  const problem = index === 4 || index === 9 || index === 13;
  const name = FR ? STACK_NAMES_FR[index]! : STACK_NAMES[index]!;
  return card(`stack-${index}`, {
    routineName: name, routineId: `r-stack-${index}`, status: "completed",
    summary: problem
      ? say("The service refused the sign-in, so the pass stopped halfway. Sign in again from Connect apps.", "Le service a refusé la connexion, donc la passe s'est arrêtée à mi-chemin. Reconnecte-toi depuis Connecter des apps.")
      : `${LONG_REPORT.split("\n\n").slice(0, 3).join("\n\n")}\n\n${STACK_BRIEFS[index % 3]!}`,
    ...(problem ? { problems: "sign-in refused", repeat: { firstRunId: `run-s${index}`, count: 2, since: NOW - 3 * 60 * M, lastAt: at } } : {}),
  } as CardRun, at);
});

/** #3695: ten runs of a routine that repeats every five minutes (ok, a
 * report, four runs with problems reworded each time, ok, ok, one problem,
 * ok). `before`: what the server wrote in the chat until #3695, one card per
 * run with problems, a works again card each time and the report. `after`:
 * the one summary card, told at the third run with problems, its count kept
 * in place, turned to works again. */
const STREAK_NAME = say("Work watch", "Suivi du travail");
const streakAt = (index: number) => NOW - (10 - index) * 5 * M;
const STREAK_PROBLEM = say("Could not finish the pass: the merge queue is stuck.", "La passe n'a pas pu finir : la file de fusion est bloquée.");
const STREAK_SUMMARY = say(
  "The merge queue has been stuck for fifteen minutes on a failed check: two branches wait and nothing lands. Rerun the check or drop the two branches.",
  "La file de fusion est bloquée depuis quinze minutes sur une vérification en échec : deux branches attendent et rien n'entre. Relance la vérification ou retire les deux branches.");
const streakCard = (id: string, index: number, run: Partial<RoutineRunCardData>) =>
  card(id, { routineName: STREAK_NAME, routineId: "r-streak", status: "completed", ...run } as CardRun, streakAt(index));
const STREAK_BEFORE: Message[] = [
  streakCard("sb1", 1, { summary: say("Two finished worktrees removed.", "Deux worktrees terminés retirés.") }),
  streakCard("sb2", 2, { summary: STREAK_PROBLEM, problems: "queue stuck" }),
  streakCard("sb3", 3, { summary: say("Two branches wait in the queue and nothing lands.", "Deux branches attendent dans la file et rien n'entre."), problems: "queue stuck" }),
  streakCard("sb4", 4, { summary: say("The queue still holds the same two branches.", "La file garde encore les deux mêmes branches."), problems: "queue stuck" }),
  streakCard("sb5", 5, { summary: say("Still stuck.", "Toujours bloquée."), problems: "queue stuck" }),
  streakCard("sb6", 6, { status: "nothing_to_report", recovered: { afterRuns: 4, since: streakAt(2) } }),
  streakCard("sb8", 8, { summary: say("One branch failed its check.", "Une branche a échoué sa vérification."), problems: "check failed" }),
  streakCard("sb9", 9, { status: "nothing_to_report", recovered: { afterRuns: 1, since: streakAt(8) } }),
];
const streakRepeat = (count: number) => ({ firstRunId: "run-sb2", count, since: streakAt(2), lastAt: streakAt(1 + count), streak: true as const });
const STREAK_TOLD = (count: number) => streakCard("streak", 4, { runId: "run-streak", summary: STREAK_SUMMARY, brief: STREAK_SUMMARY, problems: "queue stuck", repeat: streakRepeat(count) });
/** #3910: a run the person started during the streak, its own card. */
const STREAK_BY_HAND = streakCard("streak-hand", 5, { runId: "run-streak-hand", startedBy: "person", summary: say("The queue is still stuck on the same two branches.", "La file reste bloquée sur les deux mêmes branches."),
  problems: "queue stuck", repeat: { firstRunId: "run-sb2", count: 4, since: streakAt(2), lastAt: streakAt(5), anyProblem: true } });
const STREAK_AGAIN = streakCard("streak", 4, { runId: "run-streak", summary: STREAK_SUMMARY, brief: STREAK_SUMMARY, recovered: { afterRuns: 4, since: streakAt(2), streak: true } });
const STREAK_FAILED = card("streak-failed", { routineName: STREAK_NAME, routineId: "r-streak", status: "failed",
  error: say("The engine stopped answering.\nThe merge queue did not answer after three tries.", "Le moteur a cessé de répondre.\nLa file de fusion n'a pas répondu après trois essais."), repeat: streakRepeat(3) } as CardRun, streakAt(4));

/** The failed run's card turned to works again: its words became the summary. */
const STREAK_FAILED_AGAIN = card("streak-failed", { routineName: STREAK_NAME, routineId: "r-streak", status: "completed",
  summary: STREAK_FAILED.routineRun!.error, recovered: { afterRuns: 3, since: streakAt(2) } } as CardRun, streakAt(4));

const failedRun = card("failed", { routineName: say("Backup check", "Vérification des sauvegardes"), status: "failed",
  error: say("The storage service did not answer after three tries.", "Le service de stockage n'a pas répondu après trois essais."), autoPausedAfter: 3 }, NOW - 20_000);

/** The conforming neighbour: the compact approval card (#3414). */
const approval = {
  id: "approval", role: "bot", kind: "options", at: NOW - 10 * M,
  card: {
    title: say("Approval needed", "Approbation requise"),
    subtitle: JSON.stringify({ resource: "service/tickets", conditions: "closedFlag=false", pageSize: 25 }),
    toolInput: JSON.stringify({ resource: "service/tickets", conditions: "closedFlag=false", pageSize: 25 }),
    options: ["Allow", "Deny"], requestId: "req-approval", tool: "mcp__example__desk_query", allowSession: true,
  },
} as unknown as Message;

const BRIEF_ITEMS = [
  { id: "b1", text: say("Answer the quote request (mail)", "Répondre à la demande de soumission (courriel)") },
  { id: "b2", text: say("Follow up on the renewal (mail)", "Faire le suivi du renouvellement (courriel)"), feedback: "up" as const },
];
const brief: Message = {
  id: "brief", role: "bot", kind: "text", at: NOW - 20 * M, from: { botId: "server" },
  text: `**${say("Today's brief", "Le point du jour")}**\n\n${BRIEF_ITEMS.map((item) => `- ${item.text}`).join("\n")}`,
  briefItems: BRIEF_ITEMS,
} as unknown as Message;
const watchWake = card("watchwake", {
  routineName: say("Proactive: watch", "Proactif : veille"), status: "completed", wakeTopic: "watch",
  watches: [{ id: "unassigned-tickets", domain: "dispatch" }],
  summary: say("Three tickets have had no technician for over an hour: #4812, #4815 and #4821.", "Trois billets sont sans technicien depuis plus d'une heure : #4812, #4815 et #4821."),
}, NOW - 25 * M);

const server = makeBot("server", "Server", "blue", scene === "stack" ? STACK : []);
const team = [server, makeBot("reviewer", "Reviewer", "green"), makeBot("tester", "Tester", "orange"), makeBot("bot-b", "Bot B", "pink")];
const room = { id: "room", name: say("Operations", "Opérations"), color: "violet", memberIds: ["server", "reviewer"], threadId: "room-thread", mainThreadId: "room-thread", messages: [], tasks: [] };

/** The run behind Details in the window scene, and the routine it ran. */
const windowRoutine = { id: "r-report", botId: "server", name: say("Evening dispatch", "Répartition du soir"), prompt: say("Go through every board, reassign what waits, and tell me what needs a decision.", "Passe chaque tableau, réassigne ce qui attend et dis-moi ce qui demande une décision."),
  target: "bot", runOn: "maus", createdAt: 1, updatedAt: 1, enabled: true, schedule: { type: "cron", expression: "0 18 * * *", timeZone: "UTC" } } as unknown as Routine;
const windowRun = { id: "run-report", routineId: "r-report", routineName: windowRoutine.name, botId: "server", target: "bot", runOn: "maus", status: "completed", manual: false,
  scheduledFor: NOW - 12 * M, createdAt: NOW - 12 * M, startedAt: NOW - 12 * M, finishedAt: NOW - 9 * M, output: LONG_REPORT.slice(0, 600), threadId: "server-run" } as unknown as RoutineRun;

/** ?scene=card (#2719): the delegation rows of a run, beside a coding job. */
const finishedRun = card("finished", { routineName: say("Morning dispatch", "Répartition du matin"), status: "completed", startedAt: NOW - 70 * M,
  summary: say("Morning pass done: 41 open tickets, 3 reassigned, nothing over SLA.", "Passe du matin faite : 41 billets ouverts, 3 réassignés, rien hors SLA."),
  handedTo: [
    { botId: "reviewer", threadId: "reviewer-work-1", name: "Reviewer", status: "completed", task: say("Reconcile the bank overage", "Rapprocher le dépassement de banque"), startedAt: NOW - 70 * M, finishedAt: NOW - 66 * M, note: say("Moved 2.5 h to the right agreement.", "2,5 h déplacées vers la bonne entente.") },
    { botId: "tester", threadId: "tester-work-1", name: "Tester", status: "completed", task: say("Draft the weekly summary", "Rédiger le résumé de la semaine"), startedAt: NOW - 69 * M, finishedAt: NOW - 63 * M },
  ] } as CardRun, NOW - 62 * M);
const activeRun = card("active", { routineName: say("Morning dispatch", "Répartition du matin"), status: "running", startedAt: NOW - 4 * M,
  handedTo: [
    { botId: "reviewer", threadId: "reviewer-work", name: "Reviewer", status: "completed", task: say("Reconcile the bank overage", "Rapprocher le dépassement de banque"), startedAt: NOW - 4 * M, finishedAt: NOW - 1 * M },
    { botId: "tester", threadId: "tester-work", name: "Tester", status: "running", task: say("Draft the weekly summary", "Rédiger le résumé de la semaine"), startedAt: NOW - 3 * M },
  ] } as CardRun, NOW - 4 * M);
const codingJob = {
  id: "thread:job-0", kind: "session", botId: "server", botName: "Server", title: say("Add the tools widget", "Ajouter le widget des outils"), status: "finished",
  startedAt: NOW - 52 * M, endedAt: NOW - 31 * M, updatedAt: NOW - 31 * M, threadId: "job-0", coding: true,
  code: { folder: "/srv/repos/example", branch: "feat/tools-widget", repo: "example/app", pullRequests: [], branches: [], commits: [] },
} as unknown as BotActivityItem;
const testerMessages = [
  { id: "o1", role: "user", kind: "text", at: NOW - 3 * M, text: say("Draft the weekly summary: closed tickets and open escalations.", "Rédige le résumé de la semaine : billets fermés et escalades ouvertes.") },
  { id: "o2", role: "bot", kind: "text", at: NOW - 1 * M, turnId: "t1", text: say("14 tickets closed, 2 escalations still open. Drafting the summary now.", "14 billets fermés, 2 escalades encore ouvertes. Je rédige le résumé.") },
];

const instances = [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" }, models: { options: [{ id: "test", label: "Test" }] } }];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/bots?")) return json({ bots: team, groups: [room], sections: [], computerControl: {} });
  if (url.includes("/api/instances")) return json({ instances });
  if (url.includes("/api/threads/tester-work/messages")) return json({ messages: testerMessages, activeLeafId: "o2", hasMore: false });
  if (url.includes("/api/routines?run=run-gone")) return json({ routines: [windowRoutine], runs: [] });
  if (url.includes("/api/routines?run=")) return json({ routines: [windowRoutine], runs: [{ ...windowRun, report: LONG_REPORT }] });
  if (url.includes("/api/routines")) return json({ routines: [windowRoutine], runs: [windowRun], scope: "mine", allowed: { mine: true, team: false, all: false }, facets: { teams: [], owners: [], botChoices: [] } });
  if (url.includes("/api/me/proactive")) return json({ domains: {}, available: [{ domain: "dispatch", label: { fr: "Répartition", en: "Dispatch" }, eligible: true, watches: [{ id: "unassigned-tickets", summary: say("Tickets with no technician assigned", "Billets sans technicien assigné"), cadence: "1h", products: [], runs: true }] }] });
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

/** A bot reply as ChatView's own Bubble renders it (same classes, same markdown). */
function NeighbourBubble({ text }: { text: string }) {
  const widths = useChatBubbleWidthClasses();
  return (
    <div data-chat-bubble className={`text-[13px] leading-5 rounded-[18px] bg-bubble-bot px-3 py-[7px] text-ink ${widths[chatBubbleWidth({ terminal: false, wide: prefersWideBubble(text) })]}`}>
      <ChatMarkdown text={text} inert />
    </div>
  );
}
const Mine = ({ children }: { children: string }) => <div className="ml-auto w-fit rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink">{children}</div>;

function Shell() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: team, groups: [room], sections: [], computerControl: {} } as never);
    dispatch({ type: "instances", instances } as never);
    dispatch({ type: "routinesHydrated", routines: [windowRoutine], runs: [windowRun] });
    dispatch({ type: "select", id: scene === "room" ? "room" : "server" });
    if (scene === "window") openRoutineRun(dispatch, { runId: "run-report", routineId: "r-report" });
    // #3581: the run log no longer holds this run; Details opens the card's own report
    if (scene === "window-gone") openRoutineRun(dispatch, { runId: goneCard.routineRun!.runId, routineId: "r-report", botId: "server", report: { text: goneCard.routineRun!.summary ?? "", at: goneCard.at } });
  }, [dispatch]);
  const neighbour = <div data-gallery-neighbour><PendingApprovalBox approvals={pendingApprovals([approval])} threadId="server-thread" botFor={() => server} onCancelTurn={() => {}} /></div>;
  return (
    <div data-gallery-sample="routine-run-cards" className="flex overflow-hidden bg-app text-ink" style={{ width, ...(height ? { height } : {}) }}>
      <div className="app-content-frame relative flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-[52px] items-center px-4 text-[14px] font-semibold">{scene === "room" ? room.name : "Server"}</div>
        <div data-gallery-transcript className={`mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-3 px-4 py-4 sm:px-6 ${height ? "overflow-y-auto" : ""}`}>
          {scene === "card" ? (
            <>
              <Mine>{say("Add the tools widget.", "Ajoute le widget des outils.")}</Mine>
              <CodingJobCard job={codingJobView(codingJob, say("The widget is in, with its tests; the 48 tests pass.", "Le widget est ajouté avec ses tests; les 48 tests passent."))} threadId="job-0" now={NOW} />
              <Mine>{say("Run the dispatch pass.", "Lance la passe de répartition.")}</Mine>
              <RoutineRunRow message={finishedRun} botId="server" />
              <NeighbourBubble text={say("Both teammates are done.", "Les deux coéquipiers ont fini.")} />
              <Mine>{say("Run it again for the evening.", "Relance-la pour le soir.")}</Mine>
              <RoutineRunRow message={activeRun} botId="server" />
            </>
          ) : scene === "reports" ? (
            <>
              {neighbour}
              <Mine>{say("Run the evening pass.", "Lance la passe du soir.")}</Mine>
              <RoutineRunRow message={reportCard} botId="server" />
              <RoutineRunRow message={card("courtesy", { routineName: say("Agreement banks", "Banques des ententes"), status: "completed", summary: COURTESY_REPORT }, NOW - 5 * M)} botId="server" />
              <RoutineRunRow message={card("structure", { routineName: say("Bank watch", "Veille des banques"), status: "completed", summary: STRUCTURE_REPORT }, NOW - 2 * M)} botId="server" />
            </>
          ) : scene.startsWith("streak-") ? (
            <>
              {neighbour}
              <Mine>{say("Keep an eye on the work every five minutes.", "Surveille le travail aux cinq minutes.")}</Mine>
              <NeighbourBubble text={say("Done: the routine runs every five minutes.", "C'est fait : la routine roule aux cinq minutes.")} />
              {scene === "streak-before" && STREAK_BEFORE.map((message) => <RoutineRunRow key={message.id} message={message} botId="server" />)}
              {scene === "streak-after" && <RoutineRunRow message={STREAK_AGAIN} botId="server" />}
              {scene === "streak-3" && <RoutineRunRow message={STREAK_TOLD(3)} botId="server" />}
              {scene === "streak-5" && <RoutineRunRow message={STREAK_TOLD(5)} botId="server" />}
              {scene === "streak-by-hand" && <><RoutineRunRow message={STREAK_TOLD(4)} botId="server" /><RoutineRunRow message={STREAK_BY_HAND} botId="server" /></>}
              {scene === "streak-again" && <RoutineRunRow message={STREAK_AGAIN} botId="server" />}
              {scene === "streak-failed" && <RoutineRunRow message={STREAK_FAILED} botId="server" />}
              {scene === "streak-failed-again" && <RoutineRunRow message={STREAK_FAILED_AGAIN} botId="server" />}
            </>
          ) : scene === "stack" ? (
            <>
              {neighbour}
              {STACK.map((message) => <RoutineRunRow key={message.id} message={message} botId="server" />)}
            </>
          ) : scene === "banner" ? (
            <>
              <div data-gallery-banner className="chat-banners">
                <TransientNotice messages={[failedRun]} settled={() => false} render={(m) => <RoutineRunRow message={m} botId="server" onResume={() => {}} />} />
              </div>
              {neighbour}
              <Mine>{say("Check the backups tonight.", "Vérifie les sauvegardes ce soir.")}</Mine>
            </>
          ) : scene === "room" ? (
            <>
              {neighbour}
              <Mine>{say("Run the weekly review for the room.", "Lance la revue hebdomadaire pour la salle.")}</Mine>
              <RoutineRunRow message={STATES[8]!} botId="room" />
            </>
          ) : scene === "window" ? (
            <>
              {neighbour}
              <RoutineRunRow message={reportCard} botId="server" />
              <ChatViewSheets state={{ codingChat: null, routineRunWindow: state.routineRunWindow }} storeBots={team} dispatch={dispatch} />
            </>
          ) : scene === "window-gone" ? (
            <>
              {neighbour}
              <RoutineRunRow message={goneCard} botId="server" />
              <ChatViewSheets state={{ codingChat: null, routineRunWindow: state.routineRunWindow }} storeBots={team} dispatch={dispatch} />
            </>
          ) : scene === "feedback" ? (
            <>
              {neighbour}
              <RoutineRunRow message={wake} botId="server" threadId="server-thread" />
              <div data-gallery-watch-alert><RoutineRunRow message={watchWake} botId="server" threadId="server-thread" /></div>
              <div>
                <NeighbourBubble text={brief.text ?? ""} />
                <BriefItemsFeedback message={brief} botId="server" threadId="server-thread" />
              </div>
            </>
          ) : (
            <>
              {neighbour}
              {STATES.map((message) => <RoutineRunRow key={message.id} message={message} botId="server" />)}
              <RoutineRunRow message={wake} botId="server" threadId="server-thread" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><DesktopCapabilitiesProvider><StoreProvider><Shell /></StoreProvider></DesktopCapabilitiesProvider></StrictMode>,
);
