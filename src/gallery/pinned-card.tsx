/** Isolated gallery for headless screenshots of the card pinned over the
 * composer with what the bot waits on (#3214). Not shipped in the app.
 * ?lang=<code>&skin=<id>&case=question|two|collapsed|approval&width=1440|390
 * A short transcript above (a bubble, the original question card), then the
 * pinned card and a composer-like box, the way the chat stacks them.
 * Every answer is recorded in window.__decisions. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ComposerPendingStrip } from "../components/Composer.tsx-parts/ComposerPendingStrip";
import { usePinnedWaiting } from "../components/Composer.tsx-parts/PinnedWaitingCard";
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

const cases: Record<string, { approvals: Pending[]; questions: Message[]; collapsed?: boolean }> = {
  question: { approvals: [], questions: [q1] },
  two: { approvals: [], questions: [q1, q2] },
  collapsed: { approvals: [], questions: [q1], collapsed: true },
  approval: { approvals: [approval], questions: [q1] },
};
const chosen = cases[which] ?? cases.question!;

function Bubble({ children }: { children: string }) {
  return <div className={`rounded-[18px] bg-card px-3 py-[7px] text-[13px] leading-5 text-ink ${CHAT_BUBBLE_WIDTH_CLASS.fit}`}>{children}</div>;
}

function Gallery() {
  const pinned = usePinnedWaiting(chosen.approvals, chosen.questions);
  const { setCollapsed } = pinned;
  useEffect(() => { if (chosen.collapsed) setCollapsed(true); }, [setCollapsed]);
  const narrow = width < 600;
  return (
    <div data-shot="chat" className="flex flex-col bg-canvas text-ink" style={{ width, minHeight: narrow ? 640 : 560 }}>
      <div className={`mx-auto flex w-full flex-1 flex-col justify-end gap-3 ${narrow ? "px-3 pt-4" : "max-w-[760px] px-6 pt-6"}`}>
        <Bubble>{fr ? "Orla : j'ai préparé la migration, il reste une décision avant de lancer." : "Orla: the migration is ready, one decision is left before I start."}</Bubble>
        <div className={CHAT_BUBBLE_WIDTH_CLASS.fit}><QuestionCard threadId="thread-main" bot={{ id: bot.id, name: bot.name }} message={q1} /></div>
        {chosen.questions.length > 1 && <Bubble>{fr ? "Orla : et pour la suite de la semaine, trois projets attendent." : "Orla: and for the rest of the week, three projects wait."}</Bubble>}
        <div className="h-16" />
      </div>
      <div data-composer-dock className={`mx-auto w-full ${narrow ? "px-3 pb-3" : "max-w-[760px] px-6 pb-6"}`}>
        <ComposerPendingStrip bot={bot} pinned={pinned} threadId="thread-main" storeBots={[bot]} approvalBotFor={() => bot} onCancelTurn={() => window.__decisions.push({ type: "cancelTurn" })} />
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
