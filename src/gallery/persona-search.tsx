/** Isolated gallery for the Edit bot modal and its search box, the real
 * PersonaEditorModal on a stand-in /api. Fictional bot, neutral names. Not
 * shipped in the app. ?section=<page> &skin=<id> &lang=<code>
 * scripts/capture/persona-search.mjs types the query and shoots light and dark. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PersonaEditorModal } from "../components/persona/PersonaEditorModal";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type BotSettingsSection } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  if (url.pathname === "/api/config") return json({ profile: { name: "Alex Example" }, features: {}, onboarding: { completedAt: 1, launchMode: "solo" } });
  return json({ error: "not in this gallery" }, 404);
}) as typeof window.fetch;

const bot = {
  id: "scout", threadId: "t", name: "Scout", title: "Research", description: "Finds sources and summarizes them.",
  notifications: true, color: "green", unread: false, messages: [], tasks: [], soul: "Be brief and cite sources.",
  modelSelection: { instanceId: "claude", model: "sonnet" },
} as unknown as Bot;
const section = (params.get("section") ?? "overview") as BotSettingsSection;

function Open() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "openPersonaEditor", botId: bot.id, section });
  }, [dispatch]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="flex h-screen bg-app text-ink" data-gallery-persona-search="">
        <Open />
        <PersonaEditorModal />
      </div>
    </StoreProvider>
  </StrictMode>,
);
