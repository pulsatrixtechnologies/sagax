/** Isolated gallery for the Edit bot window (#2092): the real
 * PersonaEditorModal on every page, and the real bot panel on each tab, on a
 * stand-in /api. Fictional bot, neutral names. Not shipped in the app.
 * ?view=editor&section=<page> | ?view=panel&tab=<details|library|computer>
 * &org=1 (an organization server with the person's server environment)
 * &skin=<id>&lang=<code>
 * scripts/capture/edit-bot.mjs shoots every page and tab, light and dark. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PersonaEditorModal } from "../components/persona/PersonaEditorModal";
import { BotSettingsDialog } from "../components/BotSettingsDialog";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type BotSettingsSection } from "../state/store";
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

const bot = {
  id: "scout", threadId: "t-scout", name: "Scout", title: "Recherche", description: "Trouve des sources et les résume.",
  notifications: true, color: "green", unread: false, messages: [], tasks: [{ id: "task-1", threadId: "t-scout", title: "Tri" }],
  soul: "Sois bref et cite tes sources.", modelSelection: { instanceId: "claude", model: "sonnet" }, approvalMode: "ask",
  computer: org ? "cloud" : "local", mcpServers: null,
  toolScope: { deny: ["mcp:mail:send"] },
  alwaysAllow: ["mcp:mail:read_notes"],
  ...(org ? { workFolder: "/workspace/bots/scout" } : {}),
} as unknown as Bot;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  const path = url.pathname;
  if (path === "/api/config") return json({ profile: { name: "Alex Example" }, features: {}, onboarding: { completedAt: 1, launchMode: "solo" }, vps: { configured: false }, box: { configured: false }, tts: { configured: false }, imageGen: { configured: false } });
  if (path === "/api/org") return org
    ? json({ org: { name: "Exemple inc.", identity: { kind: "perspicax", issuer: "https://perspicax.example.test" } }, link: { state: "ok" }, viewerRole: "member", settings: {} })
    : json({ org: null });
  if (path === "/api/mcp/servers") return json({ servers: [
    { name: "mail", enabled: true, auth: "connected" },
    { name: "calendar", enabled: true, auth: "connected" },
    { name: "github", enabled: true, auth: "none" },
  ] });
  if (/\/api\/bots\/[^/]+\/background-brief/.test(path)) return json({ apps: 2, settings: { enabled: false, at: "08:00" }, suggestions: [] });
  if (/\/api\/bots\/[^/]+\/overview/.test(path)) return json({ setup: [] });
  // The profile page's General tab (#2126): accounts, email, reach me, Messages.
  if (/\/api\/bots\/[^/]+\/capabilities/.test(path)) {
    const item = (key: string, form: string, name: string, label: string) => ({ key, form, name, source: { kind: "account", label }, scope: "bot", state: "on", enabled: true, canToggle: true, engine: { mcp: "mounted", nothing: false } });
    return json({ botId: bot.id, engine: { kind: "claude", label: "Claude" }, items: [item("github", "connector", "GitHub", "Example account"), item("calendar", "mcp", "Calendar", "Example account")] });
  }
  if (/\/api\/bots\/[^/]+\/inbound-mail/.test(path)) return json({ available: true, address: "pepper@example.com", enabled: true });
  if (/\/api\/bots\/[^/]+\/reach-me/.test(path)) return json({ saved: true, settings: { channels: ["push"], hours: { always: true } }, channels: { push: { ready: true, devices: 1 } } });
  // Knowledge tab: a couple of fictional skills so the list is not empty.
  if (/\/api\/bots\/[^/]+\/skills$/.test(path)) return json({
    skills: [
      { name: "weekly-report", description: "Writes the weekly status report from the open tasks.", enabled: true, source: "taught", warnings: [] },
      { name: "source-check", description: "Checks every claim against two sources before answering.", enabled: true, source: "imported", warnings: [] },
    ],
    staged: [], library: [], assignedSkills: [],
  });
  if (path === "/api/messages") return json({ available: true, onThisMac: true, useMessages: false, permissions: { fullDiskAccess: "notAsked", automation: "notAsked" } });
  if (/\/api\/bots\/[^/]+\/(activity)/.test(path)) return json({ items: [], subagents: [], launchedAgents: [] });
  if (/\/api\/bots\/[^/]+\/task-list/.test(path)) return json({ tasks: [] });
  if (/\/api\/bots\/[^/]+\/webhooks/.test(path)) return json({ webhooks: [] });
  if (/\/api\/bots\/[^/]+\/history/.test(path)) return json({ entries: [] });
  if (/\/api\/bots\/[^/]+\/workspace$/.test(path)) {
    const entry = (p: string, bytes: number) => ({ path: p, kind: "file", bytes, load: "always", editable: true, markdown: true, forgotten: false });
    return json({
      workspacePath: "/workspace/bots/scout", now: Date.now(), forgottenAfterDays: 30,
      budgets: { rules: { maxLines: 200, maxBytes: 20000 }, memory: { maxLines: 200, maxBytes: 20000 }, soul: { maxBytes: 8000 } },
      rulesTemplate: "", soul: { ...entry("SOUL.md", 40), virtual: "soul" },
      entries: [entry("MEMORY.md", 320), entry("RULES.md", 120)], truncated: false,
    });
  }
  if (/\/api\/threads\/[^/]+\/files/.test(path)) return json({ files: [] });
  if (path.startsWith("/api/remote-sessions")) return json({ sessions: [] });
  if (path.includes("/api/artifacts")) return json({ artifacts: [] });
  if (path.includes("/api/pages")) return json({ pages: [] });
  if (path.includes("/api/routines")) return json({ routines: [], runs: [] });
  return json({ error: "not in this gallery" }, 404);
}) as typeof window.fetch;
(window as unknown as { EventSource: unknown }).EventSource = class { close() {} addEventListener() {} removeEventListener() {} onmessage = null; onerror = null; onopen = null; readyState = 0; };

const view = params.get("view") ?? "editor";
const section = (params.get("section") ?? "overview") as BotSettingsSection;

function Open() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "instances", instances: [{ instanceId: "claude", driverKind: "grokAgent", displayName: "Grok", snapshot: { status: "ready" }, capabilities: { browserMcp: true, computerMcp: true }, models: { default: "sonnet", options: [{ id: "sonnet", label: "Sonnet" }] } }] } as never);
    if (view === "editor") dispatch({ type: "openPersonaEditor", botId: bot.id, section });
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="flex h-screen bg-app text-ink" data-gallery-edit-bot="">
        <Open />
        {view === "editor" ? <PersonaEditorModal /> : <Panel />}
      </div>
    </StoreProvider>
  </StrictMode>,
);
