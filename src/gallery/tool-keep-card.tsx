/** Gallery of Settings > Developer > Per bot > Tool selection with the tools
 * a bot stopped listing up front (#4527 lot E), every /api path the card
 * calls answered by a fictional stand-in.
 * Query: ?skin=<skin id>, ?lang=<en|fr>, ?open=1 (the row expanded),
 * ?empty=1 (nothing left out: the card as before). Fictional names only. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ToolSelectionCard } from "../components/bot-settings/ToolSelectionCard";
import { SettingsSurfaceProvider } from "../components/SettingsPrimitives";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const BOT_ID = "scout";
const bot = {
  id: BOT_ID, threadId: "t-scout", name: "Scout", title: "Records", messages: [], tasks: [],
  ownerUserId: "pr_alex", color: "green", mcpServers: null, toolScope: { deny: ["mcp:crm:delete_deal"] },
} as unknown as Bot;

let toolKeep = params.get("empty") ? { leftOut: [], alwaysListed: [] } : {
  leftOut: ["agents/list_rooms", "agents/propose_page", "agents/launch_cloud_agent", "agents/make_video", "crm/export_report"],
  alwaysListed: ["agents/run_routine"],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function answer(method: string, path: string, body: unknown): Response | null {
  if (path === "/api/mcp/servers") return json({ servers: [{ name: "crm", enabled: true }, { name: "mail", enabled: true }] });
  if (path === `/api/bots/${BOT_ID}/capabilities`) return json({ botId: BOT_ID, engine: { kind: "codex", label: "Codex" }, items: [], toolKeep });
  if (path === `/api/bots/${BOT_ID}` && method === "PATCH") {
    const change = (body as { toolKeep?: { bringAllBack?: boolean; tool?: string; alwaysListed?: boolean } } | null)?.toolKeep;
    if (change?.bringAllBack) toolKeep = { leftOut: [], alwaysListed: toolKeep.alwaysListed };
    else if (change?.tool) {
      const id = change.tool;
      toolKeep = change.alwaysListed
        ? { leftOut: toolKeep.leftOut.filter((entry) => entry !== id), alwaysListed: [...toolKeep.alwaysListed, id] }
        : { leftOut: toolKeep.leftOut, alwaysListed: toolKeep.alwaysListed.filter((entry) => entry !== id) };
    }
    return json({ toolKeep });
  }
  return null;
}

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  let body: unknown = null;
  try { body = typeof init?.body === "string" ? JSON.parse(init.body) : null; } catch { body = null; }
  return answer(method, url.pathname, body) ?? json({ error: "not in this gallery" }, 404);
}) as typeof window.fetch;

class QuietEventSource extends EventTarget {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 2;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSED = 2;
  readyState = 1; url: string; withCredentials = false;
  onopen: ((e: Event) => void) | null = null; onmessage: ((e: MessageEvent) => void) | null = null; onerror: ((e: Event) => void) | null = null;
  constructor(url: string | URL) { super(); this.url = String(url); }
  close() { this.readyState = 2; }
}
(window as unknown as { EventSource: unknown }).EventSource = QuietEventSource;

function Card() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    if (!params.get("open")) return;
    const timer = window.setInterval(() => {
      const expander = document.querySelector<HTMLButtonElement>('[data-tool-group="tool-keep"] button[aria-expanded="false"]');
      if (expander) { expander.click(); window.clearInterval(timer); }
    }, 50);
    return () => window.clearInterval(timer);
  }, [dispatch]);
  return (
    <div data-settings-card="developer.bot" className="flex flex-col gap-6">
      <ToolSelectionCard bot={bot} engineKind="codex" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <SettingsSurfaceProvider surface="plain">
        <div className="min-h-screen bg-app p-8 text-ink max-[480px]:p-3" data-gallery-tool-keep-card="">
          <div className="mx-auto w-full max-w-[680px]">
            <Card />
          </div>
        </div>
      </SettingsSurfaceProvider>
    </StoreProvider>
  </StrictMode>,
);
