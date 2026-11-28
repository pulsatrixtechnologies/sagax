/** Isolated gallery for Playwright screenshots (not shipped in the app): the
 * screen side panel's states (M-20261127-180) with a stand-in browser that
 * answers the panel's actions. Take control is granted after ?take=<ms> (the
 * bot finishing its own action), a navigation reports its url at once and the
 * page's title only after ?title=<ms> (the engine lists tabs after a command).
 * ?skin=<id>&lang=<code>&width=<px>&vm=local|server */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScreenPanel } from "../components/ScreenPanel";
import { ScreenPanelWindowHost } from "../components/ScreenPanelWindowHost";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { loadLocale } from "../lib/i18n";
import { BotEditorStore, initialState, type Bot } from "../state/store";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.176", __BASE_VERSION__: "0.26.0" });
const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const width = Number(params.get("width") ?? 1100);
const takeDelay = Number(params.get("take") ?? 0);
const titleDelay = Number(params.get("title") ?? 0);
const vm = params.get("vm");

/** The page the stand-in browser shows for an address. */
function pagePicture(url: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1280; canvas.height = 800;
  const g = canvas.getContext("2d")!;
  const search = url.includes("duckduckgo.com");
  const query = new URL(url).searchParams.get("q") ?? "";
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 1280, 800);
  g.fillStyle = search ? "#de5833" : "#4285f4"; g.fillRect(0, 0, 1280, 64);
  g.fillStyle = "#ffffff"; g.font = "bold 28px sans-serif"; g.fillText(search ? "DuckDuckGo" : new URL(url).hostname, 40, 42);
  g.fillStyle = "#222"; g.font = "bold 40px sans-serif"; g.fillText(search ? `« ${query} »` : "Page d’accueil", 40, 140);
  for (let row = 0; row < 5; row++) {
    g.fillStyle = "#eef1f5"; g.fillRect(40, 180 + row * 96, 1200, 80);
    g.fillStyle = "#333"; g.font = "24px sans-serif"; g.fillText(search ? `Résultat ${row + 1} pour ${query}` : `Lien ${row + 1}`, 64, 228 + row * 96);
  }
  return canvas.toDataURL("image/png").split(",")[1]!;
}

const titles: Record<string, string> = { "www.google.ca": "Google" };
const page = { url: "https://duckduckgo.com/?q=test", title: "test at DuckDuckGo", seq: 1 };
/** The panel's one live stream, as the stand-in browser's actions reach it. */
const streams: StandInSource[] = [];

class StandInSource {
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(url: string) {
    streams.push(this);
    setTimeout(() => {
      if (url.includes("/bots/closed/")) { this.emit("offline", {}); return; }
      this.emit("ready", { viewerId: "gallery" });
      this.emit("control", { held: false, owned: false, controlling: false });
      this.show();
    }, 50);
  }
  show() {
    this.emit("tabs", { tabs: [{ tabId: "t1", title: page.title, url: page.url, active: true }] });
    this.emit("url", { url: page.url });
    this.emit("frame", { seq: page.seq++, data: pagePicture(page.url), format: "png", metadata: { deviceWidth: 1280, deviceHeight: 800 } });
  }
  addEventListener(name: string, listener: (event: MessageEvent) => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
  emit(name: string, data: unknown) { for (const listener of this.listeners.get(name) ?? []) listener(new MessageEvent(name, { data: JSON.stringify(data) })); }
  close() {}
}
(globalThis as { EventSource: unknown }).EventSource = StandInSource;
(window as unknown as { ogb: unknown }).ogb = { screenFrame: async () => `data:image/png;base64,${pagePicture("https://vm.example/")}` };

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
/** The browser's answers to the panel's actions. */
async function act(body: { type?: string; url?: string }): Promise<unknown> {
  const live = streams.at(-1);
  if (body.type === "take") {
    await wait(takeDelay);
    live?.emit("control", { held: true, owned: true, controlling: true });
    return { waited: takeDelay > 0 };
  }
  if (body.type === "release") { live?.emit("control", { held: false, owned: false, controlling: false }); return {}; }
  if (body.type === "navigate" && body.url) {
    // google.ca redirects to www.google.ca, as the real site does.
    const url = body.url === "https://google.ca/" ? "https://www.google.ca/" : body.url;
    page.url = url; page.title = "";
    live?.emit("url", { url });
    live?.emit("frame", { seq: page.seq++, data: pagePicture(url), format: "png", metadata: { deviceWidth: 1280, deviceHeight: 800 } });
    setTimeout(() => {
      page.title = titles[new URL(url).hostname] ?? `${new URL(url).searchParams.get("q") ?? ""} at DuckDuckGo`;
      live?.emit("tabs", { tabs: [{ tabId: "t1", title: page.title, url: page.url, active: true }] });
    }, titleDelay);
    return {};
  }
  return {};
}

const bot = {
  id: "osprey", threadId: "t-osprey", name: "Osprey", title: lang === "fr" ? "Recherche" : "Research", description: "",
  notifications: true, color: "green", unread: false, mascotLook: { character: "shape" },
  messages: [], tasks: [], computer: "vm", browserProfile: "own", modelSelection: { instanceId: "x", model: "x" },
} as unknown as Bot;

const json = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }));
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (/\/browser\/action/.test(url)) return json(await act(JSON.parse(String(init?.body ?? "{}"))));
  if (/\/auth\/session/.test(url)) return json({ scopes: ["admin"] });
  if (/\/api\/me\/server-environment/.test(url)) return json(vm === "server" ? { configured: true, state: "running" } : { configured: false });
  if (/\/api\/me\/desktop-bridge/.test(url)) return vm === "local" ? json({ connected: true, tunnel: false, desktops: [], workplace: "auto", activity: [] }) : new Response("{}", { status: 404 });
  if (/\/remote-sessions/.test(url)) return json({ sessions: [] });
  return json({});
}) as typeof fetch;

const state = {
  ...initialState, bots: [bot], groups: [], selectedId: "osprey", routines: [], routineRuns: [], routinesLoadState: "ready",
  config: { browserProfiles: [], browserEngine: { kind: "engine" } },
};

function Gallery() {
  const store = { state, dispatch: () => {}, flushBotPatches: () => Promise.resolve(bot) } as never;
  return (
    <BotEditorStore value={store}>
      <div data-gallery-sample="" className="relative flex h-[760px] bg-app text-ink" style={{ width }}>
        <div className="min-w-0 flex-1 bg-panel p-6 text-[13px] text-ink-secondary">{lang === "fr" ? "Conversation (galerie)" : "Conversation (gallery)"}</div>
        <ScreenPanel bot={bot} />
      </div>
      <ScreenPanelWindowHost />
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
