/** The app shell's sidebar by window width (JC 2026-11-01): the real
 * AppSidebar (menu button, scrim, Sidebar) beside the real ChatView, laid out
 * like App.tsx's shell row, on a synthetic store. Below 640px a drawer, 640
 * to 768px the automatic icons rail, above the person's own density.
 * Captured by scripts/capture/sidebar-rail.mjs. Every name is synthetic.
 * ?skin=<id>&lang=en|fr&density=comfortable|compact|icons&drawer=1&limit=1|credits&blocked=connect
 * #3552: ?limit= is the bot's engine at its usage limit (or out of credit):
 * the conversation's one line, the model picker's dot at its limit, and an
 * older server's send-state still answering the limit as a block, which the
 * message box ignores. ?blocked=connect is the neighbouring state, an engine
 * not connected, which keeps its bar. */
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

const limitResetsAt = Date.now() + 95 * 60_000;
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname === "/api/config") return reply({ profile: { name: "Alex Gagnon" } });
  if (url.pathname.endsWith("/send-state") && params.get("blocked") === "connect") {
    return reply({ block: { reason: "engine_not_connected", name: "Claude", message: "Claude is not connected for you.", action: { kind: "connect", instanceId: "gallery", engine: "Claude" } } });
  }
  if (url.pathname.startsWith("/api/limit-resets") && params.get("limit") === "1") {
    return reply({ checkedAt: Date.now(), engines: [{ engine: "gallery", name: "Claude", driver: "claude", window: "5-hour", usedPercent: 100, resetsAt: limitResetsAt, blocked: true }] });
  }
  if (url.pathname.endsWith("/send-state") && params.get("limit")) {
    const credits = params.get("limit") === "credits";
    return reply({ block: { reason: "engine_limit", name: "Claude", message: "Claude limit reached.", action: { kind: "switch_engine" },
      limit: credits ? { cause: "credits" } : { cause: "usage_limit", resetsAt: limitResetsAt } } });
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
// ?limit=1: the person's last message waits for the reset, and the
// conversation's one line says so (what the server writes, shared/limit-failover.ts);
// ?limit=credits: the engine is out of credit and nothing is held.
if (params.get("limit")) {
  const last = conversation.at(-1)!;
  conversation.push(
    line("u-limit", "user", fr ? "Prépare le rapport de la semaine." : "Prepare this week's report.", 13, last.id),
    params.get("limit") === "credits"
      ? { id: "l-limit", role: "bot", kind: "activity", at: at + 13 * 60_000 + 5_000, parentId: "u-limit", turnSucceeded: false,
        tool: { name: "error: Claude is out of credit", ok: false, limitFailover: { kind: "credits", engine: "Claude" } } } as Message
      : { id: "l-limit", role: "bot", kind: "activity", at: at + 13 * 60_000 + 5_000, parentId: "u-limit",
        tool: { name: "recovery: Limit reached", ok: true, limitFailover: { kind: "waiting", from: "Claude", resetsAt: limitResetsAt } } } as Message,
  );
}
const team: Bot[] = [
  bot("nova", "Nova", { chiefOfStaff: true, title: fr ? "Chef de cabinet" : "Chief of staff", mascotBody: "squircle", pinned: true }, fr ? "Je coordonne la semaine." : "Coordinating the week.", 4),
  { ...bot("atlas", "Atlas", { title: "Service Desk Ops", color: "pink", mascotBody: "squircle", section: "My team" }, "", 8), messages: conversation, activeLeafId: conversation.at(-1)?.id } as Bot,
  bot("iris", "Iris", { title: "Dev Ops", color: "orange", mascotBody: "drop", section: "My team", unread: true }, fr ? "Mémoire nettoyée." : "Memory tidied up.", 42),
  bot("milo", "Milo", { title: fr ? "Vérification" : "Review", color: "teal", mascotBody: "blob", section: "My team", busy: true }, fr ? "Je vérifie la règle." : "Checking the rule.", 70),
  bot("lina", "Lina", { title: fr ? "Juridique" : "Legal", color: "purple", mascotBody: "circle", section: "My team" }, fr ? "Aucune routine restante." : "No routine left.", 130),
  bot("veille", fr ? "Veille" : "Watch", { color: "blue", mascotBody: "capsule" }, fr ? "Trois avis à lire." : "Three advisories to read.", 320),
];
const start: AppState = {
  ...initialState,
  connected: true,
  hydrated: true,
  selectedId: "atlas",
  config: { profile: { name: "Alex Gagnon" } } as AppState["config"],
  bots: team,
  sections: ["My team"],
  // ?panel=1 opens the bot panel beside the chat, as App.tsx docks it (#2141).
  settingsOpen: params.get("panel") === "1",
  // #3552: with ?limit= or ?blocked=, the bot's engine is the one the limit
  // (or the connect bar) names, so the picker's dot sits beside its name.
  instances: [params.get("limit") || params.get("blocked")
    ? { instanceId: "gallery", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Claude Opus" }] } } as unknown as InstanceInfo
    : { instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
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
