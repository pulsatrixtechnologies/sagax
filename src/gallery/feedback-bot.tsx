/** The Feedback bot in the sidebar (#2955): the real AppSidebar beside the
 * real ChatView on a synthetic store, while another bot is busy with a long
 * turn. ?state=before: the member's bot list without the Feedback bot (what
 * the server sent before the fix). ?state=after: the Feedback bot listed in
 * the bots section with its chat open on the kind card. A fixture, not the
 * live server. Captured by scripts/capture/feedback-bot.mjs.
 * ?skin=<id>&lang=en|fr&state=before|after */
import { StrictMode, useCallback, useMemo, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";

import { AppSidebar } from "../components/AppSidebar";
import { ChatView } from "../components/ChatView";
import { BotSettingsDialog } from "../components/BotSettingsDialog";
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
try {
  localStorage.setItem("sagax.interfaceMode.v1", "advanced");
  localStorage.setItem("omb-sidebar-width-v2", "300");
  const density = params.get("density");
  if (density === "comfortable" || density === "compact" || density === "icons") localStorage.setItem("openmausbot.sidebarDensity", density);
} catch {
  // the defaults still render
}

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname === "/api/config") return reply({ profile: { name: "Alex Gagnon" } });
  // ?limit=1|credits: the bot's engine at its limit (or out of credit), the
  // composer locked (the maintainer, 2026-11-04, src/lib/send-state.ts engine_limit)
  if (url.pathname.endsWith("/send-state") && params.get("limit")) {
    const credits = params.get("limit") === "credits";
    return reply({ block: { reason: "engine_limit", name: "Claude", message: "Claude limit reached.", action: { kind: "switch_engine" },
      limit: credits ? { cause: "credits" } : { cause: "usage_limit", resetsAt: Date.now() + 95 * 60_000 } } });
  }
  if (url.pathname.startsWith("/api/")) return reply({});
  return realFetch(input, init);
};
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

const at = Date.UTC(2026, 10, 1, 13, 0);
const line = (id: string, role: Message["role"], text: string, minute: number, parentId?: string): Message =>
  ({ id, role, kind: "text", text, at: at + minute * 60_000, parentId }) as Message;
const bot = (id: string, name: string, extra: Partial<Bot>, last: string, minute: number): Bot => ({
  id, threadId: `t-${id}`, name, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "gallery", model: "m" },
  messages: [line(`m-${id}`, "bot", last, minute)],
  tasks: [{ threadId: `t-${id}`, title: fr ? "Général" : "General", createdAt: at, updatedAt: at + minute * 60_000 }],
  ...extra,
} as Bot);
const conversation: Message[] = Array.from({ length: 6 }, (_, i) => [
  line(`u${i}`, "user", fr ? `Question de suivi ${i + 1} sur la file des billets.` : `Follow-up ${i + 1} on the ticket queue.`, i * 2, i === 0 ? undefined : `b${i - 1}`),
  line(`b${i}`, "bot", fr ? `Réponse ${i + 1} : ${i + 3} billets fermés depuis ce matin.` : `Answer ${i + 1}: ${i + 3} tickets closed since this morning.`, i * 2 + 1, `u${i}`),
]).flat();
const after = params.get("state") === "after";
const kindCard = fr
  ? { title: "Qu'est-ce qu'on signale?", subtitle: "Choisissez, ou décrivez-le dans vos mots.", options: ["Un bogue", "Une idée", "Une question"] }
  : { title: "What would you like to report?", subtitle: "Pick one, or describe it in your own words.", options: ["A bug", "An idea", "A question"] };
const feedbackMessages: Message[] = [
  { id: "f1", role: "bot", kind: "text", text: fr ? "Je m'occupe de votre rapport. Je pose quelques questions." : "I'll take care of your report. A few questions first.", at: at + 200 * 60_000 } as Message,
  { id: "f2", role: "bot", kind: "options", card: { ...kindCard, requestId: "fb-r1-kind-x", requestType: "question" }, at: at + 201 * 60_000 } as unknown as Message,
];
const team: Bot[] = [
  bot("nova", "Nova", { chiefOfStaff: true, title: fr ? "Chef de cabinet" : "Chief of staff", mascotBody: "squircle", pinned: true }, fr ? "Je coordonne la semaine." : "Coordinating the week.", 4),
  { ...bot("atlas", "Atlas", { title: "Grok 4.6", color: "pink", mascotBody: "squircle", section: "My team", busy: true }, "", 8), messages: conversation, activeLeafId: conversation.at(-1)?.id } as Bot,
  bot("iris", "Iris", { title: "Dev Ops", color: "orange", mascotBody: "drop", section: "My team" }, fr ? "Mémoire nettoyée." : "Memory tidied up.", 42),
  ...(after ? [{ ...bot("feedback", "Feedback", { title: fr ? "Vos retours" : "Your feedback", color: "teal", mascotBody: "blob", section: "My team", systemBot: "feedback" } as Partial<Bot>, "", 201), messages: feedbackMessages, activeLeafId: "f2" } as Bot] : []),
];
const start: AppState = {
  ...initialState,
  connected: true,
  hydrated: true,
  selectedId: after ? "feedback" : "atlas",
  config: { profile: { name: "Alex Gagnon" } } as AppState["config"],
  bots: team,
  sections: ["My team"],
  // ?panel=1 opens the bot panel beside the chat, as App.tsx docks it (#2141).
  settingsOpen: params.get("panel") === "1",
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
} as AppState;

function galleryReducer(state: AppState, action: Action): AppState {
  try {
    return reducer(state, action);
  } catch {
    return state;
  }
}

function Gallery() {
  const [state, apply] = useReducer(galleryReducer, start);
  const [drawerOpen, setDrawerOpen] = useState(params.get("drawer") === "1");
  const dispatch = useCallback((action: Action) => apply(action), []);
  const value = useMemo(() => ({ state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }), [state, dispatch]);
  const selected = state.bots.find((entry) => entry.id === state.selectedId) ?? state.bots[1]!;
  return (
    <BotEditorStore value={value as never}>
      {/* App.tsx's shell: the row, the sidebar, the content frame */}
      <div className="flex h-dvh flex-col" data-app-shell="">
        <div className="app-shell-row relative flex min-h-0 flex-1">
          <AppSidebar drawerOpen={drawerOpen} onDrawerOpenChange={setDrawerOpen} composeOpen={false} onCompose={() => {}} />
          <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col" data-sidebar-follower="">
            <ChatView bot={selected} />
          </div>
          {state.settingsOpen && <BotSettingsDialog bot={selected} />}
        </div>
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
