/** Isolated gallery for Playwright screenshots (not shipped in the app): the
 * screen side panel (#4452) beside a plain conversation area and the real bot
 * panel, the conforming docked neighbour (same header height, hairline edge,
 * round buttons). The browser's stream is a stand-in EventSource and the server
 * a fetch stub. ?skin=<id>&lang=<code>&width=<px>&panel=<px>
 * ?chathead=1 puts the real chat header beside the panel (M-20261127-179),
 * ?control=you hands the browser to the person ("You have control"),
 * ?places=2 leaves out the remote computer (browser and VM only). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScreenPanel } from "../components/ScreenPanel";
import { BotSettingsDialog } from "../components/BotSettingsDialog";
import { ChatHeadSample } from "./chat-head-sample";
import { SCREEN_PANEL_WIDTH_KEY } from "../lib/screen-panel";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { loadLocale } from "../lib/i18n";
import { BotEditorStore, initialState, type Bot } from "../state/store";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.98", __BASE_VERSION__: "0.26.0" });
const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const width = Number(params.get("width") ?? 1440);
const panelWidth = params.get("panel");
if (panelWidth) localStorage.setItem(SCREEN_PANEL_WIDTH_KEY, panelWidth);
const chatHead = params.get("chathead") === "1";
const youControl = params.get("control") === "you";
const twoPlaces = params.get("places") === "2";

/** A page the stand-in browser shows. */
function pagePicture(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1280; canvas.height = 800;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#f6f7f9"; g.fillRect(0, 0, 1280, 800);
  g.fillStyle = "#1f6feb"; g.fillRect(0, 0, 1280, 72);
  g.fillStyle = "#ffffff"; g.font = "bold 30px sans-serif"; g.fillText("Portail client", 40, 46);
  g.fillStyle = "#222"; g.font = "bold 44px sans-serif"; g.fillText("Billets ouverts", 40, 150);
  for (let row = 0; row < 6; row++) {
    g.fillStyle = row % 2 ? "#ffffff" : "#eef1f5"; g.fillRect(40, 190 + row * 80, 1200, 72);
    g.fillStyle = "#333"; g.font = "26px sans-serif"; g.fillText(`#29${7040 + row}  Imprimante du 2e étage`, 64, 236 + row * 80);
  }
  return canvas.toDataURL("image/png").split(",")[1]!;
}

/** A desktop the VM and the remote computer stand-ins show. */
function desktopPicture(title: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1280; canvas.height = 800;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#2b3a55"; g.fillRect(0, 0, 1280, 800);
  g.fillStyle = "#e9edf3"; g.fillRect(120, 90, 1040, 600);
  g.fillStyle = "#1f6feb"; g.fillRect(120, 90, 1040, 52);
  g.fillStyle = "#fff"; g.font = "bold 24px sans-serif"; g.fillText(title, 144, 125);
  g.fillStyle = "#222"; g.font = "28px sans-serif"; g.fillText("Mise à jour du système", 160, 230);
  g.fillStyle = "#cfd6e0"; g.fillRect(160, 270, 960, 26);
  g.fillStyle = "#1f6feb"; g.fillRect(160, 270, 610, 26);
  g.fillStyle = "#333"; g.font = "24px sans-serif"; g.fillText("Redémarrage requis dans 12 minutes", 160, 360);
  g.fillStyle = "#0f1626"; g.fillRect(0, 760, 1280, 40);
  return canvas.toDataURL("image/png");
}
// The Local VM shows through the desktop app's picture and a connected remote
// session through its polled picture (no stream here, so its time shows); the
// capture clicks the tabs. ?tabs=0 keeps the browser alone.
const withTabs = params.get("tabs") !== "0";
(window as unknown as { ogb: unknown }).ogb = { screenFrame: async () => desktopPicture("Ordinateur de Osprey") };

class StandInSource {
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(url: string) {
    setTimeout(() => {
      if (url.includes("/bots/closed/")) { this.emit("offline", {}); return; }
      this.emit("ready", { viewerId: "gallery" });
      this.emit("tabs", { tabs: [{ tabId: "t1", title: "Google", url: "https://www.google.com/", active: true }] });
      if (youControl) this.emit("control", { held: true, owned: true, controlling: true });
      this.emit("frame", { seq: 1, data: pagePicture(), format: "png", metadata: { deviceWidth: 1280, deviceHeight: 800 } });
    }, 50);
  }
  addEventListener(name: string, listener: (event: MessageEvent) => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
  private emit(name: string, data: unknown) { for (const listener of this.listeners.get(name) ?? []) listener(new MessageEvent(name, { data: JSON.stringify(data) })); }
  close() {}
}
(globalThis as { EventSource: unknown }).EventSource = StandInSource;

const bot = {
  id: "osprey", threadId: "t-osprey", name: "Osprey", title: lang === "fr" ? "Recherche" : "Research", description: "",
  notifications: true, color: "green", unread: false, mascotLook: { character: "shape" },
  messages: [], tasks: [], computer: "vm", browserProfile: "own", modelSelection: { instanceId: "x", model: "x" },
} as unknown as Bot;

const realFetch = window.fetch.bind(window);
const json = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }));
window.fetch = ((input: RequestInfo | URL) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (/\/auth\/session/.test(url)) return json({ scopes: ["admin"] });
  if (/\/api\/me\/server-environment/.test(url)) return json({ configured: false });
  if (/\/api\/me\/desktop-bridge/.test(url)) return withTabs ? json({ connected: true, tunnel: false, desktops: [], workplace: "auto", activity: [] }) : Promise.resolve(new Response("{}", { status: 404 }));
  if (/\/remote-sessions\/[^/]+\/screen/.test(url)) return realFetch(desktopPicture("Poste distant"));
  if (/\/remote-sessions/.test(url)) return json({ sessions: withTabs && !twoPlaces ? [{ id: "0123456789ab", code: "ABCDEF", state: "connected", os: "windows", elevated: false, endAt: "2099-01-01T00:00:00Z", hostname: "PC-COMPTA-02", inventory: "ready", osKnown: true, suggestions: [] }] : [] });
  if (/\/team-work/.test(url)) return Promise.resolve(new Response("{}", { status: 404, headers: { "content-type": "application/json" } }));
  if (/\/task-list/.test(url)) return json({ tasks: [] });
  if (/\/activity/.test(url)) return json({ items: [], subagents: [], launchedAgents: [] });
  if (/\/overview/.test(url)) return json({ setup: [] });
  return json({});
}) as typeof fetch;

function Gallery() {
  const store = {
    state: { ...initialState, bots: [bot], groups: [], selectedId: "osprey", settingsOpen: true, routines: [], routineRuns: [], routinesLoadState: "ready",
      config: { browserProfiles: [], browserEngine: { kind: "engine" } },
      instances: [{ instanceId: "x", displayName: "Fixture", engineId: "fixture", models: { options: [{ id: "x", label: "Fixture" }] }, snapshot: { authenticated: true, installed: true } }] },
    dispatch: () => {},
    flushBotPatches: () => Promise.resolve(bot),
  } as never;
  return (
    <BotEditorStore value={store}>
      <div data-gallery-sample="" className="relative flex h-[860px] bg-app text-ink" style={{ width }}>
        {chatHead
          ? <ChatHeadSample bot={bot} lines={lang === "fr" ? ["Ouvre Google dans ton navigateur.", "C'est ouvert, à droite."] : ["Open Google in your browser.", "It is open, on the right."]} />
          : <div className="min-w-0 flex-1 bg-panel p-6 text-[13px] text-ink-secondary">{lang === "fr" ? "Conversation (galerie)" : "Conversation (gallery)"}</div>}
        <ScreenPanel bot={bot} />
        {params.get("neighbour") !== "0" && <BotSettingsDialog bot={bot} />}
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
