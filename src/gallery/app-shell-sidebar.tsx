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
 * not connected, which keeps its bar.
 * #3576: ?hidden=N adds N bots the person hid from the sidebar; the sidebar
 * draws nothing for them (Settings > Appearance lists them).
 * #3624: ?scene=idle|background|open is the idle cost measure's window
 * (app-shell-scene.ts, scripts/capture/idle-cost.mjs). */
import { memo, StrictMode, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { AppSidebar } from "../components/AppSidebar";
import { ChatView } from "../components/ChatView";
import { BotSettingsDialog } from "../components/BotSettingsDialog";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, createStreamDeltaBuffer, initialState, reducer, StreamingPreview, type Action, type AppState, type Bot, type InstanceInfo, type Message } from "../state/store";
import { foldLiveFrame } from "../state/store/fold-live-frame";
import { useStoreSelector } from "../state/store-selector";
import { publishLiveFrame } from "../lib/live-events";
import { longConversation, moreBots, readScene, sceneTeamWork, startWorking } from "./app-shell-scene";
import type { ServerFrame } from "../../shared/wire";
import "../styles.css";

const params = new URLSearchParams(location.search);
const scene = readScene(params);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const fr = lang === "fr";
try {
  localStorage.setItem("sagax.interfaceMode.v1", "advanced");
  // the reference's sidebar width (SIDEBAR_DEFAULT_WIDTH, #4093)
  localStorage.setItem("omb-sidebar-width-v2", "280");
  const density = params.get("density");
  if (density === "comfortable" || density === "compact" || density === "icons") localStorage.setItem("openmausbot.sidebarDensity", density);
} catch {
  // the defaults still render
}

// #4093 ?parity=1: the shell the reference is compared with at each window
// width (a table, a question card, the account menu's usage list), on an
// organization server's page so the menu shows every item it can hold
// (Switch account with Personal, Sign out); &update=1 adds a downloaded
// update waiting in the desktop bridge. Get the app on mobile stays out
// until a public link exists (SAGAX_MOBILE_URL), as in the app.
const parity = params.get("parity") === "1";
// #4163 ?pill=long: the chat header's pill with a long name and title;
// ?select=<id> opens another bot's chat (nova for a short one).
const longPill = params.get("pill") === "long";
const selectParam = params.get("select");
if (parity) {
  const ready = { status: "downloaded", version: "9.9.9" };
  const server = { active: true, id: "org-example", name: "Example org", origin: "https://bots.example.com" };
  (window as unknown as { ogb?: Record<string, unknown> }).ogb = {
    ...(window as unknown as { ogb?: Record<string, unknown> }).ogb,
    serverMode: { state: async () => server, leave: async () => {}, setName: async () => {} },
    accounts: { openPersonal: async () => {} },
    ...(params.get("update") === "1"
      ? { updater: { onState: (cb: (state: typeof ready) => void) => { cb(ready); return () => {}; }, check: async () => ready, install: async () => ready } }
      : {}),
  };
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
  if (scene && url.pathname.endsWith("/team-work")) return reply(sceneTeamWork("atlas", fr, Date.now()));
  // #4093: the account menu's Usage › (a made-up plan, this month's cost)
  if (parity && url.pathname === "/api/plan-usage") return reply({ providers: [{
    id: "claude", name: "Claude", driver: "claude", plan: "Max", ok: true, error: null, state: "windows", access: "subscription",
    weekly: { available: true, usedPercent: 64, remainingPercent: 36, resetsAt: new Date(Date.now() + 2.2 * 86_400_000).toISOString() },
    fiveHour: { available: true, usedPercent: 18, remainingPercent: 82, resetsAt: new Date(Date.now() + 3 * 3_600_000).toISOString() },
  }] });
  if (parity && url.pathname === "/api/me/usage") return reply({ groups: [], total: { key: "total", label: "Total", turns: 212, costUsd: 48.27 } });
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
const conversation: Message[] = scene ? longConversation(fr, at, 40) : Array.from({ length: 6 }, (_, i) => [
  line(`u${i}`, "user", fr ? `Question de suivi ${i + 1} sur la file des billets.` : `Follow-up ${i + 1} on the ticket queue.`, i * 2, i === 0 ? undefined : `b${i - 1}`),
  line(`b${i}`, "bot", fr ? `Réponse ${i + 1} : ${i + 3} billets fermés depuis ce matin.` : `Answer ${i + 1}: ${i + 3} tickets closed since this morning.`, i * 2 + 1, `u${i}`),
]).flat();
if (parity) {
  const last = conversation.at(-1)!;
  conversation.push(
    line("u-table", "user", fr ? "Montre le plan de migration en tableau." : "Show the migration plan as a table.", 13, last.id),
    line("b-table", "bot", fr
      ? "Voici le plan.\n\n| Étape | Durée | Risque |\n|---|---|---|\n| Copie des données | 2 h | Faible |\n| Bascule | 30 min | Moyen |\n| Vérification | 1 h | Faible |"
      : "Here is the plan.\n\n| Step | Time | Risk |\n|---|---|---|\n| Copy the data | 2 h | Low |\n| Switch over | 30 min | Medium |\n| Check | 1 h | Low |", 14, "u-table"),
    { id: "q-site", role: "bot", kind: "options", at: at + 15 * 60_000, text: "", parentId: "b-table",
      card: {
        title: "", subtitle: "", options: [], requestId: "req-site", requestType: "question",
        questionRequest: { version: 1, questions: [{ question: fr ? "Quel site je migre en premier ?" : "Which site do I migrate first?", options: (fr ? ["Le siège", "L'entrepôt"] : ["The head office", "The warehouse"]).map((label) => ({ label })) }] },
      } } as unknown as Message,
  );
}
// ?limit=1: the person's last message waits for the reset, and the
// conversation's one line says so (what the server writes, shared/limit-failover.ts);
// ?limit=credits: the engine is out of credit and nothing is held.
if (params.get("limit")) {
  const last = conversation.at(-1)!;
  conversation.push(
    line("u-limit", "user", fr ? "Prépare le rapport de la semaine." : "Prepare this week's report.", 13, last.id),
    params.get("limit") === "credits"
      ? { id: "l-limit", role: "bot", kind: "activity", at: at + 13 * 60_000 + 5_000, parentId: "u-limit", turnSucceeded: false,
        tool: { name: "error: Claude is out of credit", ok: false, limitFailover: { kind: "exhausted", tried: ["Claude"], cause: "credits" } } } as Message
      : { id: "l-limit", role: "bot", kind: "activity", at: at + 13 * 60_000 + 5_000, parentId: "u-limit",
        tool: { name: "recovery: Limit reached", ok: true, limitFailover: { kind: "waiting", from: "Claude", resetsAt: limitResetsAt } } } as Message,
  );
}
const team: Bot[] = [
  bot("nova", "Nova", { chiefOfStaff: true, title: fr ? "Chef de cabinet" : "Chief of staff", mascotBody: "squircle", pinned: true }, fr ? "Je coordonne la semaine." : "Coordinating the week.", 4),
  { ...bot("atlas", longPill ? "Atlas Montgomery-Beauregard" : "Atlas", { title: longPill ? (fr ? "Responsable des opérations du centre de services" : "Head of service desk operations and escalations") : "Service Desk Ops", color: "pink", mascotBody: "squircle", section: "My team" }, "", 8), messages: conversation, activeLeafId: conversation.at(-1)?.id } as Bot,
  bot("iris", "Iris", { title: "Dev Ops", color: "orange", mascotBody: "drop", section: "My team", unread: true }, fr ? "Mémoire nettoyée." : "Memory tidied up.", 42),
  bot("milo", "Milo", { title: fr ? "Vérification" : "Review", color: "teal", mascotBody: "blob", section: "My team", busy: !scene }, fr ? "Je vérifie la règle." : "Checking the rule.", 70),
  bot("lina", "Lina", { title: fr ? "Juridique" : "Legal", color: "purple", mascotBody: "circle", section: "My team" }, fr ? "Aucune routine restante." : "No routine left.", 130),
  bot("veille", fr ? "Veille" : "Watch", { color: "blue", mascotBody: "capsule" }, fr ? "Trois avis à lire." : "Three advisories to read.", 320),
];
// ?hidden=N (#3576): N more bots, each hidden from the sidebar.
const hiddenTeam: Bot[] = Array.from({ length: Math.min(Number(params.get("hidden")) || 0, 30) }, (_, i) =>
  bot(`hidden-${i + 1}`, `Tester ${i + 1}`, { color: "blue", mascotBody: "circle" }, fr ? "Rien de neuf." : "Nothing new.", 400 + i));
if (hiddenTeam.length) {
  try {
    localStorage.setItem("sagax.sidebarHidden.v1", JSON.stringify({ items: hiddenTeam.map((entry, i) => ({ kind: "bot", id: entry.id, at: i + 1 })), unhideOnMessage: { people: true, bots: false } }));
  } catch {
    // a private window: nothing hidden
  }
}
const start: AppState = {
  ...initialState,
  connected: true,
  hydrated: true,
  selectedId: selectParam ?? "atlas",
  config: { profile: { name: "Alex Gagnon" } } as AppState["config"],
  bots: [...team, ...(scene ? moreBots(fr, at) : []), ...hiddenTeam],
  sections: scene ? ["My team", "Ops"] : ["My team"],
  // ?panel=1 opens the bot panel beside the chat, as App.tsx docks it (#2141).
  settingsOpen: params.get("panel") === "1" || Boolean(scene),
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

const galleryCommands = { flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

function Gallery() {
  const [state, apply] = useReducer(galleryReducer, start);
  const dispatch = useCallback((action: Action) => apply(action), []);
  // the commands are stable, as StoreProvider's are (useCallback): a fresh
  // one per state would refetch the bot panel's overview on every frame
  const value = useMemo(() => ({ state, dispatch, ...galleryCommands }), [state, dispatch]);
  // #3624: the server's frames of working bots, through the store's own fold
  const stream = useRef<SceneStream | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (scene !== "background" && scene !== "open") return;
    const feed = (frame: ServerFrame) => {
      const live = stream.current;
      if (!live) return;
      publishLiveFrame(frame);
      foldLiveFrame(frame, {
        rawDispatch: dispatch, dispatch, stateRef, clearStream: live.clear, flushDeltas: live.buffer.flush, deltaBuffer: live.buffer,
        withTaskWrites: (bot) => bot, botPatchQueue: { overlayFor: () => ({}), cancel: () => {} }, showThreadsRef: { current: false },
        refreshInstancesPeripheral: () => {},
      });
    };
    // let the window settle first, so the measure starts on a drawn page
    let stop = () => {};
    const start = setTimeout(() => {
      stop = startWorking(scene === "open" ? ["atlas"] : ["iris", "milo", "lina"], (botId) => stateRef.current.bots.find((entry) => entry.id === botId), feed);
    }, 1_000);
    return () => { clearTimeout(start); stop(); };
  }, [dispatch]);
  return (
    <SceneStreamRoot streamRef={stream}>
      <BotEditorStore value={value as never}>
        <Shell />
      </BotEditorStore>
    </SceneStreamRoot>
  );
}

/** App.tsx's shell: the row, the sidebar, the content frame. It reads the
 * store through selectors, as App does, so a store change renders only the
 * components that read what changed (#3624). */
const Shell = memo(function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(params.get("drawer") === "1");
  const selected = useStoreSelector((current) => current.bots.find((entry) => entry.id === current.selectedId) ?? current.bots[1]!);
  const settingsOpen = useStoreSelector((current) => current.settingsOpen);
  return (
    <div className="flex h-dvh flex-col" data-app-shell="">
      <div className="app-shell-row relative flex min-h-0 flex-1">
        <AppSidebar drawerOpen={drawerOpen} onDrawerOpenChange={setDrawerOpen} composeOpen={false} onCompose={() => {}} />
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col" data-sidebar-follower="">
          <ChatView bot={selected} />
        </div>
        {settingsOpen && <BotSettingsDialog bot={selected} />}
      </div>
    </div>
  );
});

/** The live text a turn streams, kept as StoreProvider's StreamRoot keeps it:
 * its own state, so a delta re-renders only the components that read it. */
interface SceneStream { buffer: ReturnType<typeof createStreamDeltaBuffer>; clear: (threadId: string) => void }
function SceneStreamRoot({ streamRef, children }: { streamRef: { current: SceneStream | null }; children: ReactNode }) {
  const [streaming, setStreaming] = useState<Record<string, string>>({});
  const buffer = useMemo(() => createStreamDeltaBuffer((entries) => setStreaming((prev) => {
    const next = { ...prev };
    for (const [threadId, delta] of entries) next[threadId] = (next[threadId] ?? "") + delta.text;
    return next;
  })), []);
  useEffect(() => () => buffer.dispose(), [buffer]);
  streamRef.current = {
    buffer,
    clear: (threadId) => {
      buffer.clear(threadId);
      setStreaming((prev) => (threadId in prev ? Object.fromEntries(Object.entries(prev).filter(([key]) => key !== threadId)) : prev));
    },
  };
  return <StreamingPreview streaming={streaming}>{children}</StreamingPreview>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
