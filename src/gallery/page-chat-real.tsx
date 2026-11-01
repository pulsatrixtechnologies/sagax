/** The real ChatView (with its real Composer, PageSurface and page cards)
 * on a synthetic store, for lot 5 captures of Pages and chat
 * (scripts/capture-page-chat-real.mjs). No server: /api/pages answers from
 * this file, the preview frame is routed by the capture script. Every name
 * and text is synthetic. ?skin=<id>&lang=en|fr&busy=1
 * The script drives it like a person: open the card, Show conversation,
 * send, Back to chat. window.__pageChatReal reports what it saw. */
import { StrictMode, useCallback, useMemo, useReducer, useState } from "react";
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

const pageId = "galleryRealPage01";
const fr = lang === "fr";
const title = fr ? "Rapport mensuel synthétique" : "Synthetic monthly report";
const at = Date.UTC(2026, 9, 31, 13, 0);
const versions = Number(params.get("versions") ?? "2");

declare global {
  interface Window {
    __pageChatReal: { sends: unknown[] };
  }
}
window.__pageChatReal = { sends: [] };

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const summary = () => ({
  id: pageId, title, status: "draft", access: "private", expiresAt: null, currentVersion: null,
  botId: "scout", threadId: "scout-thread", createdAt: at, updatedAt: at + versions, expired: false, comments: 0,
  versions: Array.from({ length: versions }, (_, i) => ({ n: i + 1, kind: "html", title, createdAt: at + i + 1, state: "proposed", bytes: 1200, botId: "scout" })),
});
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname === "/api/pages/policy") return reply({ linkSharing: true, readerComments: true });
  const version = /^\/api\/pages\/[^/]+\/versions\/(\d+)$/.exec(url.pathname);
  if (version) return reply({ version: { n: Number(version[1]), kind: "html", title, state: "proposed", previewPath: `/pages/preview/${pageId}/${version[1]}` } });
  if (/^\/api\/pages\/[^/]+$/.test(url.pathname)) return reply({ page: summary() });
  if (url.pathname.startsWith("/api/")) return reply({});
  return realFetch(input, init);
};

const line = (id: string, role: Message["role"], text: string, minute: number, parentId?: string, extra: Partial<Message> = {}): Message =>
  ({ id, role, kind: "text", text, at: at + minute * 60_000, parentId, ...extra }) as Message;
const ask = fr ? "Prépare le rapport du mois en page." : "Turn this month's numbers into a page.";
const filler = Array.from({ length: 8 }, (_, i) => [
  line(`u${i}`, "user", fr ? `Question de suivi ${i + 1} sur les chiffres.` : `Follow-up question ${i + 1} about the numbers.`, i * 2, i === 0 ? undefined : `b${i - 1}`),
  line(`b${i}`, "bot", fr ? `Réponse ${i + 1} : les tickets fermés montent de ${i + 3} %.` : `Answer ${i + 1}: closed tickets are up ${i + 3}%.`, i * 2 + 1, `u${i}`),
]).flat();
const messages: Message[] = [
  ...filler,
  line("ask", "user", ask, 20, "b7"),
  line("p1", "bot", title, 21, "ask", { pagePublish: { pageId, version: 1, title } }),
  ...(versions > 1 ? [
    line("ask2", "user", fr ? "Ajoute une section sur les délais." : "Add a section on response times.", 22, "p1"),
    line("p2", "bot", title, 23, "ask2", { pagePublish: { pageId, version: 2, title } }),
  ] : []),
];
const scout: Bot = {
  id: "scout", threadId: "scout-thread", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: params.get("busy") === "1", messages, activeLeafId: messages.at(-1)?.id,
  modelSelection: { instanceId: "gallery", model: "m" },
  tasks: [{ threadId: "scout-thread", title: fr ? "Rapport mensuel" : "Monthly report", createdAt: at, busy: false, activity: "idle", unread: false, modelSelection: { instanceId: "gallery", model: "m" }, approvalMode: "ask" }],
} as Bot;
const start: AppState = {
  ...initialState,
  connected: true,
  selectedId: "scout",
  bots: [scout],
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
};

// The real reducer, minus actions this server-less fixture cannot satisfy
// (a refresh that expects the server's full lists): those leave it as is.
function galleryReducer(state: AppState, action: Action): AppState {
  try {
    return reducer(state, action);
  } catch {
    return state;
  }
}

function Gallery() {
  const [state, apply] = useReducer(galleryReducer, start);
  const [, setTick] = useState(0);
  const dispatch = useCallback((action: Action) => {
    if (action.type === "send") window.__pageChatReal.sends.push({ text: (action as { text?: string }).text, dataContext: (action as { dataContext?: unknown }).dataContext ?? null });
    apply(action);
    setTick((n) => n + 1);
  }, []);
  const value = useMemo(() => ({ state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }), [state, dispatch]);
  const bot = state.bots.find((entry) => entry.id === "scout")!;
  return (
    <BotEditorStore value={value as never}>
      <div data-gallery-page-chat-real="" className="flex h-dvh w-full overflow-hidden bg-app">
        <ChatView bot={bot} />
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
