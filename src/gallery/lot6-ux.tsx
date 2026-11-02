/** Headless gallery for Sagax UX lot 6: team DetailPanel, remote sessions
 * admin with logs panel, Settings > Providers key editor. Synthetic data
 * only. ?view=team|sessions|keys&skin=<id>&lang=<code> */
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { TeamDialog } from "../components/TeamDialog";
import { TeamMemoryDialog } from "../components/TeamMemoryDialog";
import { RemoteSessionsAdminPage } from "../components/remote-session/RemoteSessionsAdminPage";
import type { RemoteSessionAdminRow, RemoteSessionLogEntry } from "../../shared/remote-session-admin";
import { SettingsModal } from "../components/SettingsModal";
import { openProviderKeyDialog } from "../components/settings/ProviderKeys";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore } from "../state/store";
import { PanelSlotProvider } from "../components/panel-slot";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.24", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const view = params.get("view") ?? "team";

const DAY = "2026-10-22T";
const NOW = Date.UTC(2026, 9, 22, 14);
const rows: RemoteSessionAdminRow[] = [
  {
    id: "a1b2c3d4e5f6", code: "UD6HFH", host: "POSTE-RECEPTION", user: "marie", os: "windows", osKnown: true,
    startedAt: `${DAY}13:02:00Z`, endAt: `${DAY}18:00:00Z`, status: "connected", elevated: true,
    botId: "bot-atlas", botLabel: "Atlas", openedBy: "technicien@example", reachable: true,
    unattended: true, unattendedSince: "2026-09-30T09:00:00Z", unattendedExpiresAt: "2026-12-29T09:00:00Z", bannerVisible: false, signed: true,
  },
];
const log: RemoteSessionLogEntry[] = [
  { at: `${DAY}13:02:04Z`, kind: "start" },
  { at: `${DAY}13:02:20Z`, kind: "exec", command: "Get-Service -Name Spooler", readOnly: true },
  { at: `${DAY}13:06:30Z`, kind: "exec", command: "Restart-Service -Name Spooler", readOnly: false, approved: true, exitCode: 0 },
];

const bots = [
  {
    id: "bot-atlas", name: "Atlas", section: "Ops", ownerUserId: "p-1", instanceId: "claude", model: "sonnet",
    threadId: "thread-atlas", modelSelection: { instanceId: "claude", model: "sonnet" }, threads: [], messages: [],
  },
  {
    id: "bot-boreas", name: "Boreas", section: "Ops", ownerUserId: "p-1", instanceId: "grok", model: "grok-4",
    threadId: "thread-boreas", modelSelection: { instanceId: "grok", model: "grok-4" }, threads: [], messages: [],
  },
];

const API: Record<string, unknown> = {
  "/api/config": {
    profile: { name: "Alex Example", email: "alex@example.com" },
    anthropic: { configured: false },
    openai: { configured: true },
    xai: { configured: false },
    box: { configured: false },
    vps: { configured: false, sshAlias: "" },
    rooms: { turnTimeoutMinutes: 5 },
    tts: { configured: false, ready: false, voice: "", provider: "system", keys: { elevenlabs: false, fish: false } },
    live: { enabled: false, configured: false, voice: "", readTypedReplies: true, idleMinutes: 5 },
    imageGen: { configured: false },
    onboarding: { completedAt: NOW - 30 * 86_400_000, launchMode: "solo" },
    features: {},
    newBotDefaults: { profile: { modelSelection: { instanceId: "claude", model: "sonnet", effort: "medium" }, approvalMode: "ask" } },
  },
  "/api/instances": {
    instances: [
      {
        instanceId: "claude", displayName: "Claude", driverKind: "claudeAgent", cliDefault: "claude", access: "api",
        snapshot: { state: "available", authenticated: false },
        models: { default: "sonnet", options: [{ id: "sonnet", label: "Claude Sonnet 4.5" }, { id: "opus", label: "Claude Opus 4.1" }] },
        capabilities: { effortLevels: ["low", "medium", "high"] },
      },
      {
        instanceId: "grok", displayName: "Grok", driverKind: "grokAgent", cliDefault: "grok", access: "subscription",
        snapshot: { state: "available", authenticated: true },
        models: { default: "grok-4", options: [{ id: "grok-4", label: "Grok 4" }] },
        capabilities: { effortLevels: ["low", "medium", "high"] },
      },
      {
        instanceId: "openai-api", displayName: "OpenAI (API key)", driverKind: "codex", access: "api",
        snapshot: { state: "available", authenticated: true },
        models: { default: "", options: [] },
      },
    ],
  },
  "/api/bots": { bots, groups: [], sections: ["Ops"] },
  "/api/auth/session": {},
  "/api/me/providers": { keys: [{ provider: "openai", last4: "demo" }], servers: [] },
  "/api/me/engines": { engines: [] },
  "/api/me/cloud-agent-providers": { providers: [] },
  "/api/me/local-models": { expose: false, share: false, connected: false, endpoints: [], published: [], probes: [] },
  "/api/me/voice-keys": { elevenlabs: { configured: false, last4: null }, fish: { configured: false, last4: null }, xai: { configured: false, last4: null }, openai: { configured: false, last4: null } },
  "/api/voice/status": { provider: "system", available: true, organization: false, tts: "system", stt: "openai", providers: { tts: ["system"], stt: ["openai"] } },
  "/api/voice/voices": { voices: [] },
  "/api/approval-rules": { rules: [] },
  "/api/security-keys": { keys: [], classes: [], rpId: "localhost" },
  "/api/me/tool-grants": { grants: [], adminOnlyAreas: [] },
  "/api/me/credentials/list": { items: [], wallets: {}, onePassword: { available: false, reason: "absent" } },
  "/api/routines": { routines: [], runs: [] },
  "/api/webhooks": { webhooks: [], ingress: { available: false } },
  "/api/sidebar-sections": { sections: ["Ops"], bots },
  "/api/team-memory": {
    entries: [
      { id: "e1", kind: "term", name: "OMS", detail: "Order management system", aliases: [], status: "accepted", source: { botId: "bot-atlas", botName: "Atlas", threadId: "t1", at: 1 }, updatedAt: 1 },
      { id: "e2", kind: "person", name: "Sam Example", detail: "Ops lead", aliases: ["Sam"], status: "proposed", source: { botId: "bot-atlas", botName: "Atlas", threadId: "t1", at: 1 }, updatedAt: 1 },
    ],
  },
  "/api/admin/remote-sessions": { sessions: rows, admin: true },
  "/api/admin/remote-sessions/hosts": { hosts: [], available: true },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  if (url.pathname.match(/^\/api\/admin\/remote-sessions\/[^/]+\/logs$/)) {
    return json({ entries: log });
  }
  const body = API[url.pathname];
  if (body !== undefined) return json(body);
  return json({ error: "not in this gallery" }, 404);
}) as typeof window.fetch;

(window as unknown as { EventSource: unknown }).EventSource = class {
  close() {}
  addEventListener() {}
  removeEventListener() {}
  onmessage = null;
  onerror = null;
  onopen = null;
  readyState = 0;
};

function Frame({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div data-gallery-sample={id} className="relative flex h-[720px] w-[1100px] overflow-hidden border border-hairline/50 bg-app text-ink">
      {children}
    </div>
  );
}

function TeamSample() {
  const [panel, setPanel] = useState<"team" | "memory">("memory");
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <PanelSlotProvider slot={slot}>
      <Frame id="team">
        <div className="flex min-w-0 flex-1 flex-col p-6">
          <h1 className="text-[17px] font-semibold text-ink">Team map (gallery)</h1>
          <p className="mt-1 text-[12px] text-ink-secondary">Synthetic Ops team with the detail panel open.</p>
          <div className="mt-4 flex gap-2">
            <button type="button" className="rounded-lg border border-hairline px-3 py-1.5 text-[13px]" onClick={() => setPanel("team")}>Manage bots</button>
            <button type="button" className="rounded-lg border border-hairline px-3 py-1.5 text-[13px]" onClick={() => setPanel("memory")}>Team memory</button>
          </div>
          <div className="mt-6 rounded-xl border border-dashed border-hairline/60 p-8 text-[13px] text-ink-secondary">Ops · Atlas · Boreas</div>
        </div>
        <div ref={setSlot} data-split-panel-slot="" className="contents" />
        {panel === "team" && <TeamDialog section="Ops" onClose={() => setPanel("memory")} />}
        {panel === "memory" && <TeamMemoryDialog section="Ops" label="Ops" onClose={() => setPanel("team")} />}
      </Frame>
    </PanelSlotProvider>
  );
}

function SessionsSample() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>("[data-remote-admin-logs-open]")?.click();
    }, 900);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <PanelSlotProvider slot={slot}>
      <Frame id="sessions">
        <div className="min-w-0 flex-1 overflow-hidden">
          <RemoteSessionsAdminPage />
        </div>
        <div ref={setSlot} data-split-panel-slot="" className="contents" />
      </Frame>
    </PanelSlotProvider>
  );
}

function KeysSample() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "toggleAppSettings", open: true, section: "providers" });
    const timer = window.setTimeout(() => openProviderKeyDialog("anthropic"), 1200);
    return () => window.clearTimeout(timer);
  }, [dispatch]);
  return (
    <Frame id="keys">
      <div className="relative h-full w-full overflow-hidden">
        <SettingsModal />
      </div>
    </Frame>
  );
}

function Gallery() {
  return (
    <div className="min-h-screen bg-app text-ink p-4">
      {view === "team" && <TeamSample />}
      {view === "sessions" && <SessionsSample />}
      {view === "keys" && <KeysSample />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Gallery />
    </StoreProvider>
  </StrictMode>,
);
