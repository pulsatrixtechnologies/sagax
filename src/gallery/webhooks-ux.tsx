/** Isolated gallery for headless screenshots of Automations > Webhooks
 * (2026-11-01, lot 2 of the no-modals plan): the sentence builder, the list
 * of triggers, and the WebhookEditor in the right DetailPanel. Fictional
 * webhooks only; a mocked fetch answers the page's reads. Not shipped.
 * ?view=list|editor&width=<px>&height=<px>&lang=<code>&skin=<id> */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { RoutinesPage } from "../components/RoutineCalendarPage";
import { PanelSlotProvider } from "../components/panel-slot";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type AppState, type Bot } from "../state/store";
import type { WebhookTrigger } from "../lib/webhooks";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const view = (params.get("view") ?? "list") as "list" | "editor";
const width = Number(params.get("width") ?? 1200);
const height = Number(params.get("height") ?? 760);

const NOW = Date.now();
const bot = (id: string, name: string, color: string): Bot => ({
  id, threadId: `${id}-thread`, mainThreadId: `${id}-thread`, name, title: "", description: "", color, notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
  tasks: [{ threadId: `${id}-thread`, title: "Main" }],
} as unknown as Bot);
const bots = [bot("atlas", "Atlas", "blue"), bot("boreas", "Boreas", "green"), bot("cirrus", "Cirrus", "purple")];

const webhooks: WebhookTrigger[] = [
  {
    id: "wh1", endpointId: "ep-wh1", name: "Incoming tickets", prompt: "Open a short note for each new ticket and tag the owner.",
    botId: "atlas", runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 12,
    lastReceivedAt: NOW - 12 * 60_000, tokenLast4: "a1B2",
  },
  {
    id: "wh2", endpointId: "ep-wh2", name: "GitHub", prompt: "Summarise failed CI runs.",
    botId: "boreas", runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 4,
    lastReceivedAt: NOW - 2 * 60 * 60_000, tokenLast4: "k3Yz",
    source: { type: "github", events: ["ci.failed"], filters: { repo: ["acme/*"] } }, signingSecretSet: true,
  } as WebhookTrigger,
  {
    id: "wh3", endpointId: "ep-wh3", name: "Billing alerts", prompt: "Draft a reply when a payment fails.",
    botId: "cirrus", runOn: "cloud", enabled: false, createdAt: 1, updatedAt: 1, deliveryCount: 0, tokenLast4: "z9Y8",
  },
];

const state: AppState = {
  ...initialState,
  bots,
  webhooks,
  webhookAttempts: [],
  routines: [],
  routineRuns: [],
  routinesLoadState: "ready",
  routinesFocus: { section: "webhooks", nonce: 1 },
  webhookIngress: { available: true, baseUrl: "https://hooks.example.test" },
  instances: [],
  config: {
    ...initialState.config,
    box: { ...(initialState.config as { box?: object } | null)?.box, configured: false },
    viewer: { principalId: "pr_viewer", profileManagedBy: "perspicax", role: "admin" },
  } as unknown as AppState["config"],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/webhooks")) return json({ webhooks, attempts: [], ingress: state.webhookIngress });
  if (url.includes("/api/calendar-calls")) return json({ calls: [] });
  if (url.includes("/api/bots?")) return json({ bots, groups: [], sections: [], computerControl: {} });
  if (url.includes("/api/routines")) {
    return json({
      routines: [], runs: [], scope: "mine", allowed: { mine: true, team: true, all: true },
      facets: { teams: [], owners: [{ id: "pr_viewer", name: "Alex Doe" }], botChoices: bots.map((entry) => ({ id: entry.id, name: entry.name })) },
    });
  }
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

function Frame({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <PanelSlotProvider slot={slot}>
      <div data-gallery-sample={view} className="app-shell-row relative flex overflow-hidden bg-app text-ink" style={{ width, height }}>
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">{children}</div>
        <div ref={setSlot} data-split-panel-slot="" className="contents" />
      </div>
    </PanelSlotProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={value}>
      <Frame>
        <RoutinesPage fill onBack={() => {}} onOpenRoom={() => {}} />
      </Frame>
    </BotEditorStore>
  </StrictMode>,
);

// Open the editor panel for the editor capture: click Edit settings on the
// first bearer trigger after mount (Playwright drives this for after shots;
// for a static editor view the capture script clicks).
void view;
