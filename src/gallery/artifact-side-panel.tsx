/** Isolated gallery for headless screenshots of the artifact docked side
 * panel beside a mock chat. Not shipped. ?lang=<code>&skin=<id>&width=<px> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArtifactSidePanel } from "../components/artifacts/ArtifactSidePanel";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type Bot } from "../state/store";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.175", __BASE_VERSION__: "0.26.0" });
const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const width = Number(params.get("width") ?? 1280);

const artifact = {
  id: "a1",
  botId: "b1",
  title: lang === "fr" ? "Tableau des ventes" : "Sales dashboard",
  favorite: false,
  popped: false,
  createdAt: 1,
  updatedAt: 2,
  rev: 1,
  refresh: { state: "idle", failures: 0 },
  html: "<body style=\"font-family:sans-serif;padding:16px;background:#f8fafc;color:#111\"><h3 style=\"margin:0 0 8px\">Sales</h3><p style=\"margin:0\">Orders this week: <b>128</b></p><p style=\"margin:12px 0 0;color:#555\">Updated just now</p></body>",
};

const bot = {
  id: "b1",
  threadId: "t1",
  name: "Osprey",
  title: lang === "fr" ? "Recherche" : "Research",
  description: "",
  notifications: true,
  color: "green",
  unread: false,
  mascotLook: { character: "shape" },
  messages: [],
  tasks: [],
  modelSelection: { instanceId: "x", model: "x" },
} as unknown as Bot;

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/bots/b1/artifacts/a1")) {
    return new Response(JSON.stringify({ artifact }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/artifacts/watch")) {
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};

const store = {
  state: {
    ...initialState,
    bots: [bot],
    groups: [],
    selectedId: "b1",
    artifactPanel: { botId: "b1", artifactId: "a1", title: artifact.title },
    hydrated: true,
    connected: true,
    everConnected: true,
    config: { language: lang },
  },
  dispatch: () => {},
  flushBotPatches: () => Promise.resolve(bot),
} as never;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <div data-gallery-sample="" className="relative flex h-[720px] bg-app text-ink" style={{ width }}>
        <div className="flex min-w-0 flex-1 flex-col border-r border-hairline/40 bg-panel">
          <div className="flex h-12 items-center border-b border-hairline/30 px-4 text-[13px] font-medium text-ink">
            Osprey
          </div>
          <div className="flex flex-1 flex-col gap-3 p-6 text-[13px] text-ink-secondary">
            <p className="rounded-2xl bg-hover/60 px-3 py-2 text-ink">
              {lang === "fr" ? "Montre-moi le tableau des ventes." : "Show me the sales dashboard."}
            </p>
            <p className="self-start rounded-2xl bg-panel px-3 py-2 text-ink shadow-sm ring-1 ring-hairline/40">
              {lang === "fr" ? "Le voilà, ouvert sur le côté." : "Here it is, open on the side."}
            </p>
          </div>
        </div>
        <ArtifactSidePanel botId="b1" artifactId="a1" title={artifact.title} />
      </div>
    </BotEditorStore>
  </StrictMode>,
);
