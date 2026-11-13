/** The real ChatView on a synthetic store, for captures of a conversation's
 * turn timing line (scripts/capture/turn-timing.mjs, #4215): a cold first turn
 * and a warm next one. No server. Every name and text is synthetic. Not shipped.
 * ?lang=en|fr&timing=1|0 (the developer setting on or off)&turn=cold|warm */
import { StrictMode, useCallback, useMemo, useReducer } from "react";
import { createRoot } from "react-dom/client";

import { ChatView } from "../components/ChatView";
import { loadLocale } from "../lib/i18n";
import { setShowTurnTiming } from "../lib/turn-timing-preferences";
import { BotEditorStore, initialState, reducer, type Action, type AppState, type Bot, type InstanceInfo, type Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const fr = lang === "fr";
setShowTurnTiming(params.get("timing") !== "0");
const warm = params.get("turn") === "warm";
const at = Date.UTC(2026, 10, 13, 14, 0);
const messages: Message[] = [
  { id: "u1", role: "user", kind: "text", text: fr ? "Combien font 17 fois 23 ?" : "What is 17 times 23?", at } as Message,
  { id: "b1", role: "bot", kind: "text", text: "17 × 23 = 391", at: at + 4_000, parentId: "u1" } as Message,
];
const timing = warm
  ? { queueMs: 14, engineStartMs: 3, engineStart: "warm" as const, firstResponseMs: 1_850, firstWordMs: 1_864, totalMs: 2_310 }
  : { queueMs: 2_140, engineStartMs: 6_480, engineStart: "cold" as const, firstResponseMs: 9_020, firstWordMs: 11_160, totalMs: 12_900 };
const bot: Bot = {
  id: "scout", threadId: "scout-thread", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages, activeLeafId: "b1",
  tasks: [{ threadId: "scout-thread", title: fr ? "Calcul" : "Arithmetic", busy: false, turnTiming: timing }],
  modelSelection: { instanceId: "gallery", model: "m" },
} as unknown as Bot;
const start: AppState = {
  ...initialState,
  connected: true,
  selectedId: bot.id,
  bots: [bot],
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname.startsWith("/api/")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
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
  const shown = current.bots.find((entry) => entry.id === bot.id)!;
  return (
    <BotEditorStore value={value as never}>
      <div data-gallery-turn-timing="" className="flex h-dvh w-full overflow-hidden bg-app">
        <ChatView bot={shown} />
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
