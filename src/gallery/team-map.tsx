/** Isolated gallery for headless screenshots of the Team map page (the Tools
 * page header standard). Neutral fictional bots; a mocked fetch answers the
 * page's reads so nothing connects. Not shipped in the app.
 * ?width=<px>&height=<px>&lang=<code>&skin=<id>&dialog=computers opens the
 * computer button's Add computer modal (same component as Remote sessions). */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { TeamMapPage } from "../components/TeamMapPage";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type AppState, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const width = Number(params.get("width") ?? 1480);
const height = Number(params.get("height") ?? 900);

const bot = (id: string, name: string, color: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color, notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" }, tasks: [{ threadId: `${id}-thread`, title: "Chat", createdAt: 1 }], ...extra,
} as unknown as Bot);
const bots = [
  bot("atlas", "Atlas", "blue", { title: "Dispatch" }),
  bot("boreas", "Boreas", "green", { title: "Billing" }),
  bot("cirrus", "Cirrus", "purple", { title: "Projects" }),
  bot("delta", "Delta", "orange", { title: "Security" }),
];

const state: AppState = { ...initialState, bots };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/team-map")) return json({ collaborations: [{ groupId: "g1", botIds: ["atlas", "boreas"], lastAt: Date.now() - 3_600_000 }], queued: [], running: [] });
  if (url.includes("/api/auth/session")) return json({ kind: "session", id: "s", label: "Mac", scopes: ["client"], expiresAt: 1 });
  if (url.includes("/api/remote-hosts")) return json({ available: true, hosts: [] });
  if (url.includes("/api/team-computers")) return json({ computers: [] });
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

function OpenComputers() {
  useEffect(() => {
    if (params.get("dialog") !== "computers") return;
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>("[data-team-map-computers]")?.click(), 300);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={value}>
      <div data-gallery-sample="team-map" className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
          <TeamMapPage /><OpenComputers />
        </div>
      </div>
    </BotEditorStore>
  </StrictMode>,
);
