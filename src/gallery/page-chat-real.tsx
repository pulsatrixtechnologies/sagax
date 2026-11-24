/** The real ChatView (with its real Composer, PageSurface and page cards)
 * on a synthetic store, for lot 5 captures of Pages and chat
 * (scripts/capture/page-chat-real.mjs). No server: /api/pages answers from
 * this file, the preview frame is routed by the capture script. Every name
 * and text is synthetic. ?skin=<id>&lang=en|fr&busy=1
 * &ask=1 ends on the person's message, so a busy bot shows its working line;
 * &wait=1 adds the "finishing another conversation" wait chip after it
 * (tool details on), which the working line names instead of a row.
 * &usage=1 gives the conversation a priced usage (the header's chip, #5224).
 * The script drives it like a person: open the card, Show conversation,
 * send, Back to chat. window.__pageChatReal reports what it saw;
 * window.__pageChatReal.publish() lands the bot's next version and ends its
 * turn, as the server's frames would (the in-place ask, #4099). */
import { StrictMode, useCallback, useMemo, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";

import { ChatView } from "../components/ChatView";
import { loadLocale, t } from "../lib/i18n";
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
// the page preview frame sends no referrer: tell the gallery's preview stub
// (vite.gallery.config.ts) the language through a cookie
document.cookie = `sagax-gallery-lang=${fr ? "fr" : "en"}; path=/; SameSite=Lax`;
const title = fr ? "Rapport mensuel synthétique" : "Synthetic monthly report";
const at = Date.UTC(2026, 9, 31, 13, 0);
let versions = Number(params.get("versions") ?? "2");

declare global {
  interface Window {
    __pageChatReal: { sends: unknown[]; publish?: () => void };
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
  // Undo of the bot's edit (#4099): the page answers decline and publish
  if (/^\/api\/pages\/[^/]+\/(decline|publish)$/.test(url.pathname)) {
    window.__pageChatReal.sends.push({ api: `${init?.method ?? "GET"} ${url.pathname}`, body: init?.body ?? null });
    return reply({ page: summary() });
  }
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
// &image=1 (#2954): the person attaches a photo and asks for an edit; the bot
// posts the edited image (make_image) and one short line.
if (params.get("image") === "1") {
  const photo = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png";
  const edited = "1b2c3d4e-5f60-4b7c-9d8e-0f1a2b3c4d5e.png";
  messages.push(
    line("img-ask", "user", `${fr ? "Mets cette personne à Paris." : "Put this person in Paris."}\n\n<attached-image path="${photo}" name="photo.png" />`, 24, messages.at(-1)!.id),
    line("img-out", "bot", "", 25, "img-ask", { attachments: [{ kind: "image", path: edited, mime: "image/png", name: "Edited image.png" }] }),
    line("img-done", "bot", fr ? "Voilà, à Paris." : "Here you go, in Paris.", 25, "img-out"),
  );
}
if (params.get("ask") === "1") messages.push(line("ask3", "user", fr ? "Sors les billets ouverts de la semaine." : "Pull the open tickets for the week.", 24, messages.at(-1)!.id));
const wait = params.get("wait") === "1";
if (wait) messages.push({
  id: "wait", role: "bot", kind: "activity", at: at + 25 * 60_000, parentId: messages.at(-1)!.id,
  from: { botId: "scout", name: "Scout", color: "green" },
  tool: { name: t("chat.presence.busyElsewhere", { name: "Scout" }), spoken: t("chat.presence.busyElsewhere", { name: "Scout" }) },
} as Message);
const scout: Bot = {
  id: "scout", threadId: "scout-thread", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: params.get("busy") === "1", messages, activeLeafId: messages.at(-1)?.id,
  modelSelection: { instanceId: "gallery", model: "m" },
  tasks: [{ threadId: "scout-thread", title: fr ? "Rapport mensuel" : "Monthly report", createdAt: at, busy: params.get("ask") === "1", activity: params.get("ask") === "1" ? "working" : "idle", turnStartedAt: Date.now() - 25_000, unread: false, modelSelection: { instanceId: "gallery", model: "m" }, approvalMode: "ask",
    // &usage=1 (#5224): a priced conversation, for the header's usage chip
    ...(params.get("usage") === "1" ? { usage: { input: 52_000, output: 4_100, cachedInput: 14_000, costUsd: 2.53, turns: 9, lastTurn: { input: 6_200, output: 480, cachedInput: 5_000, costUsd: 0.31 } } } : {}) }],
  ...(params.get("ask") === "1" ? { activity: "working", turnStartedAt: Date.now() - 25_000 } : {}),
} as Bot;
const start: AppState = {
  ...initialState,
  connected: true,
  ...(wait ? { config: { features: { showToolCalls: true } } as AppState["config"] } : {}),
  selectedId: "scout",
  bots: [scout],
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: fr ? "Modèle de la galerie" : "Gallery model" }] } } as unknown as InstanceInfo],
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
  window.__pageChatReal.publish = () => {
    versions += 1;
    const current = state.bots.find((entry) => entry.id === "scout")!;
    apply({ type: "messageAdded", threadId: "scout-thread", message: line(`p${versions}`, "bot", title, 30, current.activeLeafId ?? undefined, { pagePublish: { pageId, version: versions, title } }) } as Action);
    // a bot frame carries no transcript
    const { messages: _messages, activeLeafId: _leaf, ...frame } = current;
    apply({ type: "botPatched", bot: { ...frame, busy: false, activity: "idle", tasks: current.tasks?.map((task) => ({ ...task, busy: false, activity: "idle" })) } } as Action);
    setTick((n) => n + 1);
  };
  return (
    <BotEditorStore value={value as never}>
      <div data-gallery-page-chat-real="" className="flex h-dvh w-full overflow-hidden bg-app">
        <ChatView bot={bot} />
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
