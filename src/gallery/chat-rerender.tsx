/** The real ChatView on a synthetic store, for captures of a long chat
 * (scripts/capture/chat-rerender.mjs, #3323): many turns with tool steps
 * folded under "Worked for", reactions, an edited question with its version
 * arrows, and a last turn still running. No server. Every name and text is
 * synthetic. Not shipped.
 * ?skin=<id>&lang=en|fr&turns=<n>&busy=1 (the last turn runs) */
import { StrictMode, useCallback, useMemo, useReducer } from "react";
import { createRoot } from "react-dom/client";

import { ChatView } from "../components/ChatView";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, reducer, type Action, type AppState, type Bot, type InstanceInfo, type Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const fr = lang === "fr";
const turns = Math.max(2, Number(params.get("turns") ?? "12"));
const busy = params.get("busy") === "1";
const at = Date.UTC(2026, 10, 9, 14, 0);

const QUESTIONS = fr
  ? ["Quels billets sont ouverts ce matin?", "Résume le dernier rapport.", "Vérifie les sauvegardes de la nuit.", "Qui est de garde cette semaine?"]
  : ["Which tickets are open this morning?", "Sum up the last report.", "Check last night's backups.", "Who is on call this week?"];
const ANSWERS = fr
  ? ["Sept billets ouverts, dont deux urgents.", "Le rapport montre une baisse de 12 % des alertes.", "Toutes les sauvegardes ont réussi, sauf une reprise à 3 h.", "Alex est de garde jusqu'à vendredi."]
  : ["Seven open tickets, two of them urgent.", "The report shows alerts down 12%.", "Every backup passed, one retried at 3 a.m.", "Alex is on call until Friday."];
const TOOLS = ["Read file notes.md", "Search tickets", "Run command ls -la", "Fetch report.json"];

const messages: Message[] = [];
let second = 0;
const push = (message: Omit<Message, "at" | "parentId">) => {
  second += 7;
  messages.push({ ...message, at: at + second * 1000, parentId: messages.at(-1)?.id } as Message);
};
for (let turn = 0; turn < turns; turn++) {
  const last = turn === turns - 1;
  push({ id: `u${turn}`, role: "user", kind: "text", text: QUESTIONS[turn % QUESTIONS.length]! });
  for (let step = 0; step < 3; step++) {
    push({ id: `t${turn}-${step}`, role: "bot", kind: "activity", tool: { name: TOOLS[(turn + step) % TOOLS.length]!, ...(last && busy && step === 2 ? {} : { ok: true }) } } as Omit<Message, "at" | "parentId">);
  }
  if (last && busy) break;
  push({
    id: `b${turn}`, role: "bot", kind: "text", text: ANSWERS[turn % ANSWERS.length]!,
    ...(turn % 3 === 1 ? { reactions: [{ emoji: "👍", at, actors: [{ kind: "person", id: "me", name: "Sam" }] }, { emoji: "🎉", at, actors: [{ kind: "bot", id: "wren", name: "Wren" }] }] } : {}),
  } as Omit<Message, "at" | "parentId">);
}
// an edited question: a second version on another branch, shown as "2/2"
const edited = messages.find((message) => message.id === "u2");
if (edited) messages.push({ ...edited, id: "u2-old", text: fr ? "Vérifie les sauvegardes." : "Check the backups.", at: edited.at - 1000 });

const owner: Bot = {
  id: "scout", threadId: "scout-thread", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: false, busy, turnStartedAt: busy ? messages.at(-1)!.at - 20_000 : undefined,
  messages, activeLeafId: [...messages].reverse().find((message) => message.id !== "u2-old")!.id,
  modelSelection: { instanceId: "gallery", model: "m" },
} as Bot;
const start: AppState = {
  ...initialState,
  connected: true,
  config: { features: { showToolCalls: true } } as AppState["config"],
  selectedId: owner.id,
  bots: [owner, { id: "wren", threadId: "wren-t", name: "Wren", title: "", description: "", color: "violet", notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "gallery", model: "m" } } as unknown as Bot],
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
};

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname.startsWith("/api/")) return reply({});
  return realFetch(input, init);
};

function galleryReducer(current: AppState, action: Action): AppState {
  try {
    return reducer(current, action);
  } catch {
    return current;
  }
}

function Gallery() {
  const [current, apply] = useReducer(galleryReducer, start);
  const dispatch = useCallback((action: Action) => apply(action), []);
  const value = useMemo(() => ({ state: current, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }), [current, dispatch]);
  const bot = current.bots.find((entry) => entry.id === owner.id)!;
  return (
    <BotEditorStore value={value as never}>
      <div data-gallery-chat-rerender="" className="flex h-dvh w-full overflow-hidden bg-app">
        <ChatView bot={bot} />
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
