/** Isolated gallery for Playwright screenshots (not shipped in the app): the
 * screen side panel (#4452) beside a plain conversation area and the real bot
 * panel, the conforming docked neighbour (same header height, hairline edge,
 * round buttons). The browser's stream is a stand-in EventSource and the server
 * a fetch stub. ?skin=<id>&lang=<code>&width=<px> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScreenPanel } from "../components/ScreenPanel";
import { BotSettingsDialog } from "../components/BotSettingsDialog";
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

class StandInSource {
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(url: string) {
    setTimeout(() => {
      if (url.includes("/bots/closed/")) { this.emit("offline", {}); return; }
      this.emit("ready", { viewerId: "gallery" });
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
  messages: [], tasks: [], computer: "local", browserProfile: "own", modelSelection: { instanceId: "x", model: "x" },
} as unknown as Bot;

const json = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }));
window.fetch = ((input: RequestInfo | URL) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (/\/auth\/session/.test(url)) return json({ scopes: ["admin"] });
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
        <div className="min-w-0 flex-1 bg-panel p-6 text-[13px] text-ink-secondary">{lang === "fr" ? "Conversation (galerie)" : "Conversation (gallery)"}</div>
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
