/** Isolated gallery for the Edit bot window (#2092): the real
 * PersonaEditorModal on every page, and the real bot panel on each tab, on a
 * stand-in /api. Fictional bot, neutral names. Not shipped in the app.
 * ?view=editor&section=<page> (the profile page in the main panel, beside
 * the real sidebar) | ?view=panel&tab=<details|library|computer>
 * &org=1 (an organization server with the person's server environment)
 * &skin=<id>&lang=<code>
 * scripts/capture/edit-bot.mjs shoots every page and tab, light and dark. */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PersonaEditorModal } from "../components/persona/PersonaEditorModal";
import { BotSettingsDialog } from "../components/BotSettingsDialog";
import { AppSidebar } from "../components/AppSidebar";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type BotSettingsSection } from "../state/store";
import { editBotFixture } from "./edit-bot-api";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.28", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const org = params.get("org") === "1";

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  if (reason && (reason.name === "AbortError" || String(reason).includes("AbortError"))) event.preventDefault();
});

const { bot, neighbours, routines, answer } = editBotFixture(org);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  return answer(url.pathname) ?? json({ error: "not in this gallery" }, 404);
}) as typeof window.fetch;
(window as unknown as { EventSource: unknown }).EventSource = class { close() {} addEventListener() {} removeEventListener() {} onmessage = null; onerror = null; onopen = null; readyState = 0; };

const view = params.get("view") ?? "editor";
const section = (params.get("section") ?? "overview") as BotSettingsSection;

function Open() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot, ...neighbours], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines, runs: [] } as never);
    dispatch({ type: "instances", instances: [{ instanceId: "claude", driverKind: "grokAgent", displayName: "Grok", snapshot: { status: "ready" }, capabilities: { browserMcp: true, computerMcp: true }, models: { default: "sonnet", options: [{ id: "sonnet", label: "Sonnet" }] } }] } as never);
    if (view === "editor") {
      // select first: selecting a bot leaves the profile, so the page opens after
      dispatch({ type: "select", id: bot.id } as never);
      dispatch({ type: "openPersonaEditor", botId: bot.id, section });
    }
    else dispatch({ type: "select", id: bot.id } as never);
  }, [dispatch]);
  return null;
}

function Panel() {
  const { state } = useStore();
  const current = state.bots.find((candidate) => candidate.id === bot.id);
  if (!current) return null;
  return <div className="relative ml-auto flex h-screen w-[400px] border-l border-hairline" data-edit-bot-panel=""><BotSettingsDialog bot={current} /></div>;
}

/** The profile page fills the main panel beside the real sidebar (#2136). */
function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col" data-app-shell="">
      <div className="app-shell-row relative flex min-h-0 flex-1">
        <AppSidebar drawerOpen={drawerOpen} onDrawerOpenChange={setDrawerOpen} composeOpen={false} onCompose={() => {}} />
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col" data-sidebar-follower="">
          <PersonaEditorModal />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="flex h-screen bg-app text-ink" data-gallery-edit-bot="">
        <Open />
        {view === "editor" ? <Shell /> : <Panel />}
      </div>
    </StoreProvider>
  </StrictMode>,
);
