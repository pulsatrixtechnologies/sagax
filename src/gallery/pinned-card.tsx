/** Isolated gallery for headless screenshots of the card pinned over the
 * composer with what the bot waits on (#3214). Not shipped in the app.
 * ?lang=<code>&skin=<id>&case=question|fix-before|fix-after|two|collapsed|approval|approval-only|org-approval|read|write|room-skill|routine-before|routine-after|room-keyed|room-keyed-other|room-answered|fixes-before|fixes-after|timesheet|timesheet-closed|fix-closed|fix-answered&width=1440|390&cardw=980|640|390 (the card's own width)
 * form cases (#4585): form-time|form-long|form-kinds|form-checklist|form-time-answered
 * A short transcript above (a bubble, the original question card), then the
 * pinned card and a composer-like box, the way the chat stacks them.
 * Every answer is recorded in window.__decisions. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ComposerPendingStrip } from "../components/Composer.tsx-parts/ComposerPendingStrip";
import { usePinnedWaiting } from "../components/Composer.tsx-parts/PinnedWaitingCard";
import type { ServedWaitingItem } from "../../shared/waiting-items";
import { answerWithNote, parseAskChoiceInput } from "../../shared/options-card";
import { formatQuestionAnswers, type AskQuestion } from "../../shared/ask-question";
import type { Pending } from "../components/PendingApproval";
import { QuestionCard } from "../components/QuestionCard";
import { ApprovalCard } from "../components/ApprovalCard";
import { RelayProvenance } from "../components/RelayViaLabel";
import { CHAT_BUBBLE_WIDTH_CLASS } from "../lib/chat-bubble-width";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type Message, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const which = params.get("case") ?? "question";
const cardw = Number(params.get("cardw") ?? 0);
const width = cardw ? cardw + (cardw < 600 ? 24 : 48) : Number(params.get("width") ?? 1440);

declare global {
  interface Window { __decisions: unknown[] }
}
window.__decisions = [];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/auth/session")) return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/custom-rules/policy")) return new Response(JSON.stringify({ alwaysAllow: true, orgRules: 0 }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/custom-rules")) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const bot = { id: "bot-orla", name: "Orla", color: "violet", threadId: "thread-main", messages: [], tasks: [] } as unknown as Bot;
// #4219: the person looking at a room card (its addressee, or another
// person of the room)
const viewerId = params.get("viewer") ?? "p-ana";
const store = {
  state: { bots: [bot], instances: [], groups: [], routines: [], config: { viewer: { principalId: viewerId } } },
  dispatch: (action: unknown) => { window.__decisions.push(action); },
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

const fr = lang === "fr";
function ask(id: string, at: number, question: string, options: string[]): Message {
  return {
    id, role: "bot", kind: "options", at, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
    card: { title: "", subtitle: "", options: [], requestId: `req-${id}`, requestType: "question", questionRequest: { version: 1, questions: [{ question, options: options.map((label) => ({ label })) }] } },
  } as unknown as Message;
}
const q1 = ask("q1", 10,
  fr ? "Je mets en pause mes deux webhooks pendant la migration de ce soir ?" : "Do I pause my two webhooks during tonight's migration?",
  fr ? ["Oui, mets-les en pause", "Non, garde-les actifs"] : ["Yes, pause them", "No, keep them running"]);
const q2 = ask("q2", 20,
  fr ? "Quel projet je prends en premier cette semaine ?" : "Which project do I take first this week?",
  fr ? ["Le pare-feu du siège", "Le déménagement de la comptabilité", "Le ménage des comptes inactifs"] : ["The head office firewall", "The accounting move", "The inactive accounts cleanup"]);
const COMMAND = "ls /workspace/plugins 2>/dev/null; echo READY";
const approvalMessage = {
  id: "ap1", role: "bot", kind: "options", at: 5, text: "",
  card: {
    requestId: "req-ap1", tool: "mcp__sagax-environment__run_command", mcpTool: "mcp__sagax-environment__run_command",
    title: "", subtitle: COMMAND, toolInput: JSON.stringify({ command: COMMAND }), options: ["Allow", "Deny"],
    ownerRule: { tool: "mcp__sagax-environment__run_command", scope: { call: "x" }, description: fr ? "Rouler une commande sur ton ordinateur cloud (ls, echo)" : "Run a command on your cloud computer (ls, echo)", from: "origin" },
  },
} as unknown as Message;
const approval: Pending = { message: approvalMessage, requestId: "req-ap1", tool: "mcp__sagax-environment__run_command", detail: COMMAND, threadId: "thread-main" };

// #3414: a background turn's read and write (a proactive wake, its card
// asked from the bot's own background conversation)
function toolAsk(id: string, tool: string, input: Record<string, unknown>): Pending {
  const message = {
    id, role: "bot", kind: "options", at: 4, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
    card: { requestId: `req-${id}`, tool, mcpTool: tool, title: "", subtitle: JSON.stringify(input), toolInput: JSON.stringify(input), options: ["Allow", "Deny"], allowSession: true, approvalOrigin: { threadId: "thread-wake", messageId: id, requestId: `req-${id}` } },
  } as unknown as Message;
  return { message, requestId: `req-${id}`, tool, detail: JSON.stringify(input), allowSession: true, threadId: "thread-wake", askedBy: bot.name };
}
const readAsk = toolAsk("rd1", "mcp__claude_ai_Acme_Desk__acme_desk__query", { resource: "service/tickets", conditions: "closedFlag=false", pageSize: 25 });
const writeAsk = toolAsk("wr1", "mcp__perspicax_example_flow__acme_desk_write", { resource: "service/tickets", action: "update", id: 4821, set: { status: { id: 12 } } });

// #3414: a room (group chat): the composer has no bot of its own, and a
// member bot's skill proposal, whose title never names the bot, waits
const quasar = { id: "bot-quasar", name: "Quasar", color: "teal", threadId: "thread-main", messages: [], tasks: [] } as unknown as Bot;
const skillGist = fr ? "Arrêter proprement une tâche quand on me le demande." : "Stop a task cleanly when asked to.";
const skillMessage = {
  id: "sk1", role: "bot", kind: "options", at: 6, text: "", from: { botId: quasar.id, name: quasar.name, color: "teal" },
  card: {
    title: 'Enable skill "task-abort"?', subtitle: skillGist, options: ["Enable", "Deny"], requestId: "skill-sk1", tool: "stage_skill",
    ownerRule: { tool: "sagax:skill", scope: { action: "create", source: "review" }, description: fr ? "Garder les compétences que ce bot apprend de ses conversations" : "Keep the skills this bot learns from its conversations" },
    skillRequest: { version: 1, requestId: "skill-sk1", botId: quasar.id, threadId: "thread-main", stagedId: "staged-sk1", action: "create", name: "task-abort", gist: skillGist, source: "learn:automatic review of this conversation", preview: `---\nname: task-abort\n---\n${skillGist}\n`, sha256: "6d3bee9d".repeat(8), warnings: [], createdAt: 1 },
  },
} as unknown as Message;
const roomSkill: Pending = { message: skillMessage, requestId: "skill-sk1", tool: "stage_skill", detail: skillGist };

// #4205: a routine that leaves nine time entries to decide. Before: one
// generic card whose question the server cut at 500 characters. After: one
// card per entry with its own choices and its whole text.
const entry = (n: number) => fr
  ? `${n}. Billet #${1000 + n} : 1,5 h saisie le lundi pour la migration du serveur de fichiers.\nNote : le technicien a travaillé pendant ces heures sur la copie des dossiers partagés, puis sur la vérification des droits d'accès de chaque équipe et le nettoyage des anciens partages.\nApprouver, Refuser, Corriger ou Toujours permettre ?`
  : `${n}. Ticket #${1000 + n}: 1.5 h logged on Monday for the file server migration.\nNote: during those hours the technician copied the shared folders, then checked each team's access rights and cleaned up the old shares.\nApprove, Refuse, Correct or Always allow?`;
const entryChoices = fr ? ["Approuver", "Refuser", "Corriger", "Toujours permettre"] : ["Approve", "Refuse", "Correct", "Always allow"];
const routineWhole = Array.from({ length: 9 }, (_, index) => entry(index + 1));
const routineFlat = routineWhole.join(" ").replace(/\s+/g, " ");
const routineBefore = ask("rb", 30, `${routineFlat.slice(0, 499).trimEnd()}\u2026`, fr ? ["Continuer", "Arrêter ici"] : ["Continue", "Stop here"]);
const routineAfter = routineWhole.map((question, index) => ask(`ra${index + 1}`, 30 + index, question, entryChoices));

// #4219: a keyed card a shared bot raised in a room, addressed to one
// person of the room; the others see it waiting on that person, and the
// answered row names who answered.
const roomQuestion = fr ? "Billet #1012 : qui prend la visite sur place aujourd'hui ?" : "Ticket #1012: who takes the on-site visit today?";
const roomChoices = fr ? ["Je la prends", "Je la passe"] : ["I take it", "I hand it over"];
const roomKeyed = (more: Record<string, unknown> = {}): Message => {
  const base = ask("rk", 40, roomQuestion, roomChoices);
  return { ...base, from: { botId: quasar.id, name: quasar.name, color: "teal" }, card: { ...base.card!, askKey: "ticket-1012", noHold: true, askTo: { id: "p-ana", name: "Ana" }, ...more } } as Message;
};
const roomOpen = roomKeyed();
const roomAnswered = roomKeyed({ answered: "answer", answeredText: roomChoices[0], answeredBy: { kind: "session", id: "p-ana", name: "Ana" } });

// #4303: a phone line fix card. Before: the lead and the whole reason of
// the organization server, folded under a generic title. After: the lead
// and the reason's whole sentences that fit, shown whole as the title.
const fixLead = fr ? "Les appels à ta ligne +15145550100 n'ont pas la voix." : "Calls to your phone line +15145550100 do not get the voice.";
const fixReason = fr
  ? ["La voix en temps réel n'a pas répondu au dernier test.", "Les appelants entendent le message de relève au lieu du bot tant que le compte de voix ne répond pas."]
  : ["The realtime voice did not answer the last health check.", "Callers hear the fallback message instead of the bot until the voice account answers again."];
const fixChoices = fr ? ["Vérifier la ligne", "Expliquer la correction"] : ["Check the line", "Explain the fix"];
const fixCard = (id: string, question: string): Message => {
  const base = ask(id, 50, question, fixChoices);
  return { ...base, card: { ...base.card!, askKey: "voice-line", noHold: true } } as Message;
};
const fixBefore = fixCard("fb", `${fixLead}\n\n${fixReason.join(" ")}`);
const fixAfter = fixCard("fa", `${fixLead} ${fixReason[0]}`);

// #4451: an organization approval in an admin's chat with their Primary Bot:
// the same card as an ordinary approval, named by the asking bot and its person
const nimbus = { id: "bot-nimbus", name: "Nimbus", color: "teal", threadId: "thread-member", messages: [], tasks: [] } as unknown as Bot;
const ORG_COMMAND = "systemctl restart backup-agent";
const orgMessage = {
  id: "org1", role: "bot", kind: "options", at: 5, text: "", from: { botId: nimbus.id, name: nimbus.name, color: "teal" },
  relayVia: "organization", relayAsk: { text: "", by: nimbus.name, botId: nimbus.id, for: "Erin" },
  card: {
    requestId: "admin:src1", tool: "Bash", title: "Approval needed", subtitle: ORG_COMMAND, toolInput: JSON.stringify({ command: ORG_COMMAND }), options: ["Allow", "Deny"], requestType: "permission", adminApproval: true,
    ownerRule: { tool: "Bash", scope: { command: ORG_COMMAND }, description: fr ? `Rouler « ${ORG_COMMAND} » sur le serveur de l'organisation` : `Run "${ORG_COMMAND}" on the organization's server`, from: "admin" },
    approvalOrigin: { threadId: "thread-member", messageId: "src1", requestId: "req-src1", admin: true },
  },
} as unknown as Message;
const orgApproval: Pending = { message: orgMessage, requestId: "admin:src1", tool: "Bash", detail: ORG_COMMAND, threadId: "thread-member", askedBy: nimbus.name };

// #4438: five routine fix cards of one bot (the owner's capture: "1 of 5").
// Before: the first one's raw tool error in its text. After: its plain
// sentence, the raw words under Details. An answer takes it off at once.
const RAW_HANDLE = "Api result query failed 3 times and never succeeded after: handle res_5f0c2a91d4e7b836 is unknown, expired, or not yours (handle_unknown)";
const fixChoicesRoutine = fr ? ["Lancer une vérification", "Mettre la routine en pause", "Ouvrir la routine"] : ["Run a check", "Pause the routine", "Open the routine"];
const routineNames = fr ? ["Tri du courriel", "Feuilles de temps", "Rapport du matin", "Suivi des billets", "Sauvegardes"] : ["Mail triage", "Time sheets", "Morning report", "Ticket follow-up", "Backups"];
const routineFix = (n: number, plain: boolean): Message => {
  const name = routineNames[n - 1]!;
  const lead = fr ? `La routine ${name} a eu des problèmes à sa dernière passe.` : `${name} ended with problems on its last run.`;
  const said = n === 1
    ? (plain ? (fr ? "La routine n'a pas pu lire un résultat enregistré : il n'était plus disponible." : "The routine could not read a saved result: it was no longer available.") : RAW_HANDLE)
    : (fr ? "Flow a échoué 2 fois et n'a jamais réussi ensuite : outil introuvable." : "Flow failed 2 times and never succeeded after: Tool not found: Flow");
  const base = ask(`fx${n}`, 60 + n, `${lead}\n\n${said}`, fixChoicesRoutine);
  return { ...base, card: { ...base.card!, askKey: `routine-problem:r${n}`, noHold: true, ...(plain && n === 1 ? { technicalDetails: RAW_HANDLE } : {}) } } as Message;
};
const fixesBefore = [1, 2, 3, 4, 5].map((n) => routineFix(n, false));
const fixesAfter = [1, 2, 3, 4, 5].map((n) => routineFix(n, true));
// #4438: a bot's keyed card about a business object: it says since when its
// facts were read (a time sheet asked about this morning)
const timesheet = (() => {
  const base = ask("ts", 70, fr ? "La feuille de temps de la semaine 46 est encore en attente d'approbation. Je l'approuve ?" : "The time sheet of week 46 is still waiting for approval. Do I approve it?", fr ? ["Approuver", "Laisser"] : ["Approve", "Leave it"]);
  return { ...base, card: { ...base.card!, askKey: "timesheet-46", noHold: true, factsAt: new Date(2026, 10, 16, 9, 14).getTime() } } as Message;
})();

// #4438: a card closed because its matter is settled says why: the time
// sheet approved elsewhere (the bot's retire reason), a fix card whose
// routine worked since
const timesheetClosed = { ...timesheet, id: "tsc", card: { ...timesheet.card!, expired: true, options: [], answerNote: fr ? "Déjà approuvée le 16 nov." : "Already approved on Nov 16" } } as Message;
// #4438: a fix card answered from an app that reads no note: the server
// says what happened after the answer's words too; this app says it once
const fixAnswered = (() => {
  const base = fixesAfter[2]!;
  const pick = fixChoicesRoutine[1]!;
  const note = t("routine.problemCard.pausedNow");
  return { ...base, id: "fxa", card: { ...base.card!, answered: "answer", answeredText: answerWithNote(pick, note), answerNote: note } } as Message;
})();
const fixClosed = { ...fixesAfter[1]!, id: "fxc", card: { ...fixesAfter[1]!.card!, expired: true, options: [], answerNote: t("routine.problemCard.alreadyFixed") } } as Message;

// #4585: the form cards, one row per question (the three-question form the
// owner looked at, a long choice, a long text and a checklist)
function form(id: string, at: number, input: Record<string, unknown>, more: Record<string, unknown> = {}): Message {
  const parsed = parseAskChoiceInput(input);
  if (!parsed.ok || !("value" in parsed) || !parsed.value.questions) throw new Error("gallery form refused");
  return {
    id, role: "bot", kind: "options", at, text: "", from: { botId: bot.id, name: bot.name, color: "violet" },
    card: { title: String(input.title ?? ""), subtitle: String(input.question ?? ""), options: [], requestId: `req-${id}`, requestType: "question", noHold: true, questionRequest: { version: 1, questions: parsed.value.questions }, ...more },
  } as unknown as Message;
}
const formTime = form("ft", 80, {
  title: fr ? "Entrées de temps à confirmer" : "Time entries to confirm",
  question: fr ? "Confirme chaque entrée tirée du calendrier d'aujourd'hui." : "Confirm each entry drafted from today's calendar.",
  questions: [
    { question: fr ? "Standup avec l'équipe, 9 h à 9 h 15" : "Standup with the team, 9:00 to 9:15", kind: "choice", options: fr ? ["Fait", "Pas fait", "Demain"] : ["Done", "Not done", "Tomorrow"] },
    { question: fr ? "Revue de design avec Ada : combien de temps ?" : "Design review with Ada: how long?", kind: "duration" },
    { question: fr ? "Appel du billet 481516 : facturable ?" : "Ticket 481516 call: billable?", kind: "yes_no" },
  ],
});
const formLong = form("fl", 81, {
  title: fr ? "Réservation de la salle" : "Room booking",
  question: fr ? "Quelques détails pour réserver." : "A few details to book.",
  questions: [
    { question: fr ? "Quelle salle veux-tu réserver pour la rencontre ?" : "Which room do you want for the meeting?", kind: "choice", options: fr ? ["Nord", "Sud", "Ouest", "Salle du conseil", "Atelier du sous-sol", "Terrasse"] : ["North", "South", "West", "Board room", "Basement workshop", "Terrace"] },
    { question: fr ? "Nom de la rencontre" : "Meeting name", kind: "text" },
    { question: fr ? "Date" : "Date", kind: "date" },
    { question: fr ? "Notes pour l'équipe" : "Notes for the team", kind: "long_text", optional: true },
  ],
});
const formChecklist = form("fc", 82, {
  title: fr ? "Publications de ce soir" : "Posts for tonight",
  question: fr ? "Décoche ceux que tu ne veux pas publier." : "Untick the ones you do not want to post.",
  items: (fr ? ["Notes de version 2.4", "Fil sur la rencontre", "Clip de la barre latérale"] : ["Release notes 2.4", "Thread about the meetup", "Sidebar clip"]).map((label) => ({ label, detail: `${label}.` })),
  actions: fr ? ["Publier la sélection", "Sauter ce soir"] : ["Post selected", "Skip tonight"],
});
const formQuestions = formTime.card!.questionRequest!.questions as AskQuestion[];
const formAnswered = { ...formTime, id: "fta", card: { ...formTime.card!, answered: "answer", answeredText: formatQuestionAnswers(formQuestions, [[formQuestions[0]!.options[0]!.label], ["90 min"], ["yes"]]) } } as Message;

const cases: Record<string, { approvals: Pending[]; questions: Message[]; collapsed?: boolean; room?: boolean; inline?: Message; org?: boolean }> = {
  "approval-only": { approvals: [approval], questions: [] },
  "org-approval": { approvals: [orgApproval], questions: [], org: true },
  "timesheet-closed": { approvals: [], questions: [], inline: timesheetClosed },
  "fix-closed": { approvals: [], questions: [], inline: fixClosed },
  "fix-answered": { approvals: [], questions: [], inline: fixAnswered },
  "fixes-before": { approvals: [], questions: fixesBefore, inline: fixesBefore[0] },
  "fixes-after": { approvals: [], questions: fixesAfter, inline: fixesAfter[0] },
  timesheet: { approvals: [], questions: [timesheet], inline: timesheet },
  "room-keyed": { approvals: [], questions: [roomOpen], room: true, inline: roomOpen },
  "room-keyed-other": { approvals: [], questions: [], room: true, inline: roomOpen },
  "room-answered": { approvals: [], questions: [], room: true, inline: roomAnswered },
  "routine-before": { approvals: [], questions: [routineBefore], inline: routineBefore },
  "routine-after": { approvals: [], questions: routineAfter, inline: routineAfter[0] },
  "fix-before": { approvals: [], questions: [fixBefore], inline: fixBefore },
  "fix-after": { approvals: [], questions: [fixAfter], inline: fixAfter },
  "form-time": { approvals: [], questions: [formTime], inline: formTime },
  "form-long": { approvals: [], questions: [formLong], inline: formLong },
  "form-checklist": { approvals: [], questions: [formChecklist], inline: formChecklist },
  "form-time-answered": { approvals: [], questions: [], inline: formAnswered },
  question: { approvals: [], questions: [q1] },
  two: { approvals: [], questions: [q1, q2] },
  collapsed: { approvals: [], questions: [q1], collapsed: true },
  approval: { approvals: [approval], questions: [q1] },
  read: { approvals: [readAsk], questions: [] },
  write: { approvals: [writeAsk], questions: [] },
  "room-skill": { approvals: [roomSkill], questions: [], room: true },
};
const chosen = cases[which] ?? cases.question!;

function Bubble({ children }: { children: string }) {
  return <div className={`rounded-[18px] bg-card px-3 py-[7px] text-[13px] leading-5 text-ink ${CHAT_BUBBLE_WIDTH_CLASS.fit}`}>{children}</div>;
}

function Gallery() {
  // the server's items (#3543), as GET /api/approvals?waiting=1 serves them
  const items: ServedWaitingItem[] = [...chosen.approvals.map((pending) => pending.message), ...chosen.questions].map((message) => ({
    id: message.card?.requestId ?? message.id, kind: (message.card?.questionRequest ? "question" : "approval") as ServedWaitingItem["kind"],
    // #4438: the fix cards sit in an earlier topic the store has not loaded
    botId: message.from?.botId ?? "bot-orla", botName: message.from?.name ?? "", threadId: which.startsWith("fixes") ? "thread-earlier" : "thread-main", messageId: message.id, at: message.at, ageMs: 0,
    title: "", text: "", options: [], answerWith: "text" as const, freeText: true, skippable: true as const, message,
  })).sort((a, b) => a.at - b.at);
  const pinned = usePinnedWaiting(items, "thread-main", [], chosen.approvals);
  const { setCollapsed } = pinned;
  useEffect(() => { if (chosen.collapsed) setCollapsed(true); }, [setCollapsed]);
  const narrow = width < 600;
  return (
    <div data-shot="chat" className="flex flex-col bg-canvas text-ink" style={{ width, minHeight: narrow ? 640 : 560 }}>
      <div className={`mx-auto flex w-full flex-1 flex-col justify-end gap-3 ${narrow ? "px-3 pt-4" : cardw ? "px-6 pt-6" : "max-w-[760px] px-6 pt-6"}`}>
        <Bubble>{fr ? "Orla : j'ai préparé la migration, il reste une décision avant de lancer." : "Orla: the migration is ready, one decision is left before I start."}</Bubble>
        {chosen.org ? (
          <div className={CHAT_BUBBLE_WIDTH_CLASS.fit}><RelayProvenance message={orgMessage} bots={[bot]} self={bot} /><ApprovalCard bot={{ name: bot.name }} message={orgMessage} /></div>
        ) : which === "approval-only" ? (
          <div className={CHAT_BUBBLE_WIDTH_CLASS.fit}><ApprovalCard bot={{ name: bot.name }} message={approvalMessage} /></div>
        ) : <div className={cardw ? "" : CHAT_BUBBLE_WIDTH_CLASS.fit} style={cardw ? { width: cardw } : undefined}><QuestionCard threadId="thread-main" bot={chosen.room ? { id: quasar.id, name: quasar.name } : { id: bot.id, name: bot.name }} message={chosen.inline ?? q1} /></div>}
        {chosen.questions.length > 1 && !chosen.inline && <Bubble>{fr ? "Orla : et pour la suite de la semaine, trois projets attendent." : "Orla: and for the rest of the week, three projects wait."}</Bubble>}
        <div className="h-16" />
      </div>
      <div data-composer-dock className={`mx-auto w-full ${narrow ? "px-3 pb-3" : cardw ? "px-6 pb-6" : "max-w-[760px] px-6 pb-6"}`}>
        <ComposerPendingStrip bot={chosen.room ? undefined : bot} pinned={pinned} threadId="thread-main" storeBots={chosen.room ? [bot, quasar] : [bot]} approvalBotFor={(pending) => (chosen.room ? quasar : pending.message.card?.approvalOrigin?.admin ? undefined : bot)} onCancelTurn={() => window.__decisions.push({ type: "cancelTurn" })} />
        <div className="rounded-2xl border border-hairline bg-card px-4 py-3 text-[14px] text-ink-secondary">
          {pinned.current?.kind === "question" ? t("composer.placeholder.question") : t("composer.placeholder.approval")}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><BotEditorStore value={store}><Gallery /></BotEditorStore></StrictMode>,
);
