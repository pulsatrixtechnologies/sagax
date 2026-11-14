/** Isolated gallery for headless screenshots of requests said on a call
 * while the bot works (#4216): the call card keeps the call's own exchange,
 * and each request that runs beside it as a parallel task keeps its own row,
 * its task card and its result. Uses the real voiceCallPlan fold, the real
 * VoiceCallCard and the real ParallelTaskCard. Neutral fictional bot. Not
 * shipped in the app. ?width=<px>&height=<px>&skin=<id>&lang=<en|fr> */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { ParallelTaskCard } from "../components/ParallelTaskCard";
import { VoiceCallCard } from "../components/VoiceCallCard";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { foldVoiceMessage, voiceCallPlan } from "../lib/voice-call-transcript";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") === "fr" ? "fr" : "en";
await loadLocale(lang);
const width = Number(params.get("width") ?? 760);
const height = Number(params.get("height") ?? 760);
const fr = lang === "fr";

const NOW = Date.now();
const M = 60_000;
const CALL = "call-1";
const POSTS = "orla-posts";
const TEXTS = "orla-texts";
const bot = {
  id: "orla", threadId: "orla-thread", mainThreadId: "orla-thread", name: "Orla", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: true, messages: [], modelSelection: { instanceId: "test", model: "test" },
  tasks: [
    { threadId: "orla-thread", title: "Main", createdAt: NOW - 48 * 60 * M, busy: true },
    { threadId: POSTS, title: fr ? "Regarde les nouvelles publications" : "Check the new posts", createdAt: NOW - 3 * M, updatedAt: NOW - M,
      parallelOf: { threadId: "orla-thread" } },
    { threadId: TEXTS, title: fr ? "Dis-moi le dernier texto reçu" : "Tell me the last text message", createdAt: NOW - 2 * M, updatedAt: NOW - M, busy: true,
      parallelOf: { threadId: "orla-thread" } },
  ],
} as unknown as Bot;

const said = (id: string, at: number, text: string, extra: Partial<Message> = {}) =>
  ({ id, role: "user", kind: "text", at, text, voiceCall: { callId: CALL, utteranceId: `utt-${id}` }, via: "call", callId: CALL, ...extra }) as unknown as Message;
const request = (threadId: string, title: string, requestMessageId: string, role: "request" | "card" | "result", state?: string) =>
  ({ threadId, title, requestMessageId, role, ...(state ? { state } : {}), startedAt: NOW - 3 * M }) as unknown as NonNullable<Message["parallelTask"]>;

const postsTitle = fr ? "Regarde les nouvelles publications" : "Check the new posts";
const textsTitle = fr ? "Dis-moi le dernier texto reçu" : "Tell me the last text message";
const thread: Message[] = [
  said("u1", NOW - 4 * M, fr ? "Regarde mes courriels non lus" : "Check my unread mail"),
  said("u2", NOW - 3 * M, postsTitle, { parallelTask: request(POSTS, postsTitle, "u2", "request") }),
  { id: "c2", role: "bot", kind: "text", at: NOW - 3 * M + 1, text: "", parallelTask: request(POSTS, postsTitle, "u2", "card", "done") } as unknown as Message,
  said("u3", NOW - 2 * M, textsTitle, { parallelTask: request(TEXTS, textsTitle, "u3", "request") }),
  { id: "c3", role: "bot", kind: "text", at: NOW - 2 * M + 1, text: "", parallelTask: request(TEXTS, textsTitle, "u3", "card", "running") } as unknown as Message,
  { id: "r2", role: "bot", kind: "text", at: NOW - M, replyToId: "u2", text: fr ? "Trois nouvelles publications : la version, une question sur les prix et un merci d'un lecteur." : "Three new posts: the release, a pricing question and a thank you from a reader.",
    parallelTask: request(POSTS, postsTitle, "u2", "result", "done") } as unknown as Message,
  { id: "b1", role: "bot", kind: "text", at: NOW - M + 10, requestMessageId: "u1", turnTerminal: true, text: fr ? "Tu as deux courriels non lus, les deux du fournisseur." : "You have two unread emails, both from the supplier." } as unknown as Message,
];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/bots?")) return json({ bots: [bot], groups: [], sections: [], computerControl: {} });
  if (url.includes("/api/routines")) return json({ routines: [], runs: [], scope: "mine", allowed: { mine: true, team: false, all: false }, facets: { teams: [], owners: [], botChoices: [] } });
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

function Bubble({ message }: { message: Message }) {
  return message.role === "user"
    ? <div data-row={message.id} className="ml-auto w-fit max-w-[80%] rounded-2xl bg-accent/15 px-4 py-2.5 text-[14px]">{message.text}</div>
    : <div data-row={message.id} className="max-w-[90%] text-[14px] leading-6">{message.text}</div>;
}

function Shell() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines: [], runs: [] });
    dispatch({ type: "select", id: "orla" });
  }, [dispatch]);
  const plan = voiceCallPlan(thread);
  const seen = new Set<string>();
  const rows = thread.flatMap((message) => {
    const fold = foldVoiceMessage(message, plan, seen);
    if (fold.kind === "skip") return [];
    if (fold.kind === "card") return [<VoiceCallCard key={`call:${fold.card.callId}`} threadId="orla-thread" botName="Orla" callId={fold.card.callId} messages={fold.card.messages} forceOpen />];
    if (message.parallelTask?.role === "card") return [<ParallelTaskCard key={message.id} message={message} botId="orla" />];
    return [<Bubble key={message.id} message={message} />];
  });
  return (
    <div data-gallery-sample="voice-parallel-requests" className="app-content-frame flex flex-col overflow-hidden bg-app text-ink" style={{ width, height }}>
      <div className="flex min-h-[52px] items-center px-4 text-[14px] font-semibold">Orla</div>
      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-end gap-3 overflow-hidden px-6 pb-6 pt-4">{rows}</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><StoreProvider><Shell /></StoreProvider></StrictMode>,
);
