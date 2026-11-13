/** Isolated gallery for headless screenshots of the card pinned over the
 * composer with what the bot waits on (#3214). Not shipped in the app.
 * ?lang=<code>&skin=<id>&case=question|two|collapsed|approval|read|write|room-skill|routine-before|routine-after&width=1440|390
 * A short transcript above (a bubble, the original question card), then the
 * pinned card and a composer-like box, the way the chat stacks them.
 * Every answer is recorded in window.__decisions. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ComposerPendingStrip } from "../components/Composer.tsx-parts/ComposerPendingStrip";
import { usePinnedWaiting } from "../components/Composer.tsx-parts/PinnedWaitingCard";
import type { ServedWaitingItem } from "../../shared/waiting-items";
import type { Pending } from "../components/PendingApproval";
import { QuestionCard } from "../components/QuestionCard";
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
const width = Number(params.get("width") ?? 1440);

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
const store = {
  state: { bots: [bot], instances: [], groups: [], routines: [] },
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

const cases: Record<string, { approvals: Pending[]; questions: Message[]; collapsed?: boolean; room?: boolean; inline?: Message }> = {
  "routine-before": { approvals: [], questions: [routineBefore], inline: routineBefore },
  "routine-after": { approvals: [], questions: routineAfter, inline: routineAfter[0] },
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
    botId: message.from?.botId ?? "bot-orla", botName: message.from?.name ?? "", threadId: "thread-main", messageId: message.id, at: message.at, ageMs: 0,
    title: "", text: "", options: [], answerWith: "text" as const, freeText: true, skippable: true as const, message,
  })).sort((a, b) => a.at - b.at);
  const pinned = usePinnedWaiting(items, "thread-main", [], chosen.approvals);
  const { setCollapsed } = pinned;
  useEffect(() => { if (chosen.collapsed) setCollapsed(true); }, [setCollapsed]);
  const narrow = width < 600;
  return (
    <div data-shot="chat" className="flex flex-col bg-canvas text-ink" style={{ width, minHeight: narrow ? 640 : 560 }}>
      <div className={`mx-auto flex w-full flex-1 flex-col justify-end gap-3 ${narrow ? "px-3 pt-4" : "max-w-[760px] px-6 pt-6"}`}>
        <Bubble>{fr ? "Orla : j'ai préparé la migration, il reste une décision avant de lancer." : "Orla: the migration is ready, one decision is left before I start."}</Bubble>
        <div className={CHAT_BUBBLE_WIDTH_CLASS.fit}><QuestionCard threadId="thread-main" bot={{ id: bot.id, name: bot.name }} message={chosen.inline ?? q1} /></div>
        {chosen.questions.length > 1 && !chosen.inline && <Bubble>{fr ? "Orla : et pour la suite de la semaine, trois projets attendent." : "Orla: and for the rest of the week, three projects wait."}</Bubble>}
        <div className="h-16" />
      </div>
      <div data-composer-dock className={`mx-auto w-full ${narrow ? "px-3 pb-3" : "max-w-[760px] px-6 pb-6"}`}>
        <ComposerPendingStrip bot={chosen.room ? undefined : bot} pinned={pinned} threadId="thread-main" storeBots={chosen.room ? [bot, quasar] : [bot]} approvalBotFor={() => (chosen.room ? quasar : bot)} onCancelTurn={() => window.__decisions.push({ type: "cancelTurn" })} />
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
