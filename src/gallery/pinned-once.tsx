/** Isolated gallery for headless captures of an ask that waits, drawn by
 * the real chat (ChatView) and the real room (GroupView): the transcript,
 * the composer and its pinned card together (#3681: drawn once, on the
 * pinned card, while it waits; its record in the conversation once settled).
 * Answers /api itself with made-up bots; nothing reaches a server. Not
 * shipped in the app.
 * #4204: case=window opens a team bot's task over the chat (CodingChat,
 * its own composer and pinned card) while that bot's question waits: drawn
 * once, on the window's pinned card, never also in a "Waiting on you" head.
 * ?lang=fr|en&skin=<id>&case=question|two|approval|answered|room|window */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import { DesktopCapabilitiesProvider } from "../components/DesktopCapabilities";
import { GroupView } from "../components/GroupView";
import { ChatView } from "../components/ChatView";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const fr = lang === "fr";
const which = params.get("case") ?? "question";
const room = which === "room";
const windowed = which === "window";

const bot = (id: string, name: string, color: string): Bot =>
  ({ id, threadId: `t-${id}`, name, title: "", description: "", notifications: true, color, unread: false, ownerUserId: "pr_me", modelSelection: { instanceId: "fake", model: "test" }, messages: [], tasks: [] }) as unknown as Bot;
const atlas = bot("atlas", "Atlas", "pink");
const iris = bot("iris", "Iris", "orange");
const threadId = room ? "t-ops" : atlas.threadId;
const from = { botId: "atlas", name: "Atlas", color: "pink" } as const;
const at = Date.UTC(2026, 10, 11, 14, 0);

const QUESTION = fr
  ? "Avant de lancer la migration de ce soir, qu'est-ce que je fais avec les intégrations qui écrivent encore dans l'ancien système ? Je peux les mettre en pause, les rediriger vers le nouveau, les laisser rouler ou attendre ta confirmation pour chacune."
  : "Before tonight's migration starts, what do I do with the integrations that still write to the old system? I can pause them, point them at the new one, leave them running or wait for your word on each one.";
const CHOICES = fr
  ? ["Toutes en pause pendant la migration", "Les rediriger vers le nouveau système", "Les laisser rouler, je surveille", "Me demander pour chacune"]
  : ["Pause all of them during the migration", "Point them at the new system", "Leave them running, I will watch", "Ask me for each one"];
const COMMAND = "ls /workspace/integrations; echo READY";

function question(answered?: string): Message {
  return {
    id: "q1", role: "bot", kind: "options", at: at + 120_000, text: "", from,
    card: { title: "", subtitle: "", options: [], requestId: "req-q1", requestType: "question",
      questionRequest: { version: 1, questions: [{ question: QUESTION, options: CHOICES.map((label) => ({ label })) }] },
      ...(answered ? { answered: "answer", answeredText: answered } : {}) },
  } as unknown as Message;
}
function second(): Message {
  return {
    id: "q2", role: "bot", kind: "options", at: at + 150_000, text: "", from,
    card: { title: "", subtitle: "", options: [], requestId: "req-q2", requestType: "question",
      questionRequest: { version: 1, questions: [{ question: fr ? "Je préviens l'équipe avant de commencer ?" : "Do I tell the team before I start?", options: (fr ? ["Oui", "Non"] : ["Yes", "No"]).map((label) => ({ label })) }] } },
  } as unknown as Message;
}
function approval(answered?: "allow"): Message {
  return {
    id: "a1", role: "bot", kind: "options", at: at + 180_000, text: "", from,
    card: { requestId: "req-a1", tool: "mcp__sagax-environment__run_command", mcpTool: "mcp__sagax-environment__run_command", title: "", subtitle: COMMAND,
      toolInput: JSON.stringify({ command: COMMAND }), options: ["Allow", "Deny"], ...(answered ? { answered } : {}) },
  } as unknown as Message;
}
const person: Message = { id: "u1", role: "user", kind: "text", at, text: fr ? "Prépare la migration de ce soir." : "Get tonight's migration ready." };
const words: Message = { id: "w1", role: "bot", kind: "text", at: at + 60_000, from, text: fr ? "La migration est prête. Il reste une décision avant de lancer." : "The migration is ready. One decision is left before I start." };
const after: Message = { id: "w2", role: "bot", kind: "text", at: at + 240_000, from, text: fr ? "Je t'attends pour continuer." : "I am waiting for you to go on." };

// #4204: the team bot's task, its question waiting
const irisFrom = { botId: "iris", name: "Iris", color: "orange" } as const;
const taskThread = "t-iris-task";
const taskMessages: Message[] = [
  { id: "tu1", role: "user", kind: "text", at, text: fr ? "Trie les billets du tableau de soutien." : "Sort the help desk board's tickets." },
  { id: "tw1", role: "bot", kind: "text", at: at + 30_000, from: irisFrom, text: fr ? "Je regarde le tableau d'abord." : "I'll look at the board first." },
  { ...question(), id: "tq1", from: irisFrom, card: { ...question().card!, requestId: "req-tq1" } } as Message,
];
const taskItem = { id: `thread:${taskThread}`, kind: "session", botId: "iris", botName: "Iris", title: fr ? "Trier le tableau de soutien" : "Sort the help desk board", status: "waiting", startedAt: at, updatedAt: at + 60_000, threadId: taskThread, steps: [], stepsTruncated: false, files: [], children: [], canStop: false };

const messages: Message[] = windowed ? [person, words, after]
  : which === "two" ? [person, words, question(), second(), after]
  : which === "approval" ? [person, words, approval(), after]
  : which === "answered" ? [person, words, question(CHOICES[1]), approval("allow"), after]
  : [person, words, question(), after];

let waiting = (windowed ? taskMessages : messages).filter((message) => message.card?.requestId && !message.card.answered).map((message) => ({
  id: message.card!.requestId, kind: message.card!.questionRequest ? "question" : "approval", botId: windowed ? "iris" : "atlas", botName: windowed ? "Iris" : "Atlas", threadId: windowed ? taskThread : threadId,
  messageId: message.id, at: message.at, ageMs: 0, title: "", text: "", options: [], answerWith: "option", freeText: false, skippable: true, message,
}));
const group = {
  id: "ops", threadId: "t-ops", name: fr ? "Opérations" : "Operations", bulletin: "", unread: false, createdAt: at,
  memberIds: ["atlas", "iris"], humanIds: ["pr_me"], ownerId: "pr_me", defaultResponder: { kind: "auto" },
  messages: room ? messages : [], tasks: [],
};

declare global {
  interface Window { __actions: unknown[] }
}
window.__actions = [];
/** The answer the fake server records: the card settles as a live frame would. */
let settle: ((requestId: string, answer: string) => void) | null = null;
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const parsed = new URL(url, location.href);
  if (!parsed.pathname.startsWith("/api/")) return realFetch(input, init);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (init?.method && init.method !== "GET") window.__actions.push({ path: parsed.pathname, body: init.body });
  if (parsed.pathname.endsWith("/respond") && typeof init?.body === "string") {
    const body = JSON.parse(init.body) as { requestId: string; message?: string };
    waiting = waiting.filter((item) => item.id !== body.requestId);
    settle?.(body.requestId, body.message ?? "");
    return json({ ok: true });
  }
  if (parsed.pathname === "/api/bots") return json({ bots: [room ? atlas : { ...atlas, messages }, iris], groups: [group], sections: [], computerControl: {} });
  if (parsed.pathname === "/api/approvals" && parsed.searchParams.get("waiting") === "1") {
    const botId = parsed.searchParams.get("botId");
    return json({ waiting: botId ? waiting.filter((item) => item.botId === botId) : waiting });
  }
  if (parsed.pathname === "/api/bots/iris/activity/item") return json({ item: taskItem });
  if (parsed.pathname === `/api/threads/${taskThread}/messages`) return json({ messages: taskMessages, hasMore: false });
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
  const target = room ? "ops" : "atlas";
  settle = (requestId, answer) => dispatch({ type: "cardSettled", threadId, requestId, patch: { answered: "answer", answeredText: answer } });
  useEffect(() => {
    if (state.hydrated && state.selectedId !== target) dispatch({ type: "select", id: target });
  }, [state.hydrated, state.selectedId, dispatch, target]);
  useEffect(() => {
    if (windowed && state.hydrated && state.selectedId === target) dispatch({ type: "openCodingChat", target: { botId: "iris", itemId: `thread:${taskThread}`, threadId: taskThread } });
  }, [state.hydrated, state.selectedId, dispatch, target]);
  const shownRoom = state.groups.find((candidate) => candidate.id === "ops");
  const one = state.bots.find((candidate) => candidate.id === "atlas");
  return (
    <div data-shot="chat" className="flex h-dvh bg-app text-ink">
      {room ? shownRoom && state.selectedId === "ops" ? <GroupView group={shownRoom} /> : null
        : one && state.selectedId === "atlas" ? <ChatView bot={one} /> : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><DesktopCapabilitiesProvider><Chat /></DesktopCapabilitiesProvider></StoreProvider>
  </StrictMode>,
);
