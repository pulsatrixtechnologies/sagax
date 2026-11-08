/** Gallery of Settings > Developer > Per bot > Event subscriptions (#2700),
 * under the bot's Webhooks section (its neighbour on that page), with every
 * /api path both sections call answered by a fictional stand-in.
 * Query: ?skin=<skin id>, ?lang=<en|fr>, ?empty=1 (no subscription yet).
 * Self-contained on purpose. Fictional names only. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BotEventSubscriptions } from "../components/bot-settings/BotEventSubscriptions";
import { BotWebhooks } from "../components/bot-settings/BotWebhooks";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import type { BotEventSubscription } from "../../shared/bot-event-subscriptions";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const BOT_ID = "scout";

const bot = {
  id: BOT_ID, threadId: "t-scout", name: "Scout", title: "Research", messages: [], tasks: [],
  ownerUserId: "pr_alex", color: "green",
} as unknown as Bot;

const routines = [
  { id: "r-triage", botId: "relay", name: "Triage new findings" },
  { id: "r-digest", botId: "relay", name: "Weekly digest" },
  { id: "r-morning", botId: BOT_ID, name: "Morning summary of important emails" },
].map((routine) => ({
  ...routine, prompt: routine.name, enabled: true, target: "bot",
  schedule: { type: "cron", expression: "0 8 * * 1", timeZone: "America/Toronto" }, createdAt: 1, updatedAt: 1,
}));

const webhooks = [
  { id: "wh-1", endpointId: "ep-1", name: "Morning summary", prompt: "", botId: BOT_ID, routineId: "r-morning", runOn: "bot", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 42 },
  { id: "wh-2", endpointId: "ep-2", name: "Ticket updates", prompt: "", botId: BOT_ID, runOn: "bot", enabled: false, createdAt: 1, updatedAt: 1, deliveryCount: 7 },
];

let subscriptions: BotEventSubscription[] = params.get("empty") ? [] : [
  { id: "s1", botId: BOT_ID, ownerId: "pr_alex", events: ["run.reported", "run.failed"], target: { kind: "url", url: "https://hooks.northwind.example/sagax/scout" }, createdAt: NOW - 3 * HOUR, deliveries: 18, lastDelivery: { at: NOW - 12 * MIN, ok: true, status: 200 } },
  { id: "s2", botId: BOT_ID, ownerId: "pr_alex", events: ["run.failed"], target: { kind: "url", url: "https://alerts.northwind.example/inbound" }, createdAt: NOW - 2 * HOUR, deliveries: 3, lastDelivery: { at: NOW - 40 * MIN, ok: false, status: 503 } },
  { id: "s3", botId: BOT_ID, ownerId: "pr_alex", events: ["run.reported"], target: { kind: "routine", botId: "relay", routineId: "r-triage" }, targetName: "Triage new findings", createdAt: NOW - HOUR, deliveries: 0 },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function answer(method: string, path: string, body: unknown): Response | null {
  const base = `/api/bots/${BOT_ID}/event-subscriptions`;
  if (path === base && method === "GET") return json({ subscriptions });
  if (path === base && method === "POST") {
    const input = body as { events: BotEventSubscription["events"]; target: { kind: "url"; url: string } | { kind: "routine"; routineId: string } };
    const routine = input.target.kind === "routine" ? routines.find((r) => r.id === (input.target as { routineId: string }).routineId) : undefined;
    const sub: BotEventSubscription = {
      id: `s${subscriptions.length + 1}`, botId: BOT_ID, ownerId: "pr_alex", events: input.events,
      target: input.target.kind === "url" ? input.target : { kind: "routine", botId: routine?.botId ?? "relay", routineId: input.target.routineId },
      targetName: routine?.name, createdAt: NOW, deliveries: 0,
    };
    subscriptions = [...subscriptions, sub];
    return json({ subscription: sub, secret: "whsec_example0000000000000000000000000000" });
  }
  const test = path.match(/\/event-subscriptions\/([^/]+)\/test$/);
  if (test && method === "POST") {
    subscriptions = subscriptions.map((sub) => (sub.id === test[1] ? { ...sub, deliveries: sub.deliveries + 1, lastDelivery: { at: NOW, ok: true, status: 200 } } : sub));
    return json({ subscription: subscriptions.find((sub) => sub.id === test[1]) });
  }
  const one = path.match(/\/event-subscriptions\/([^/]+)$/);
  if (one && method === "DELETE") {
    subscriptions = subscriptions.filter((sub) => sub.id !== one[1]);
    return json({ ok: true });
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

function Sections() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines, runs: [] } as never);
    dispatch({ type: "webhooksHydrated", webhooks, attempts: [], ingress: null, graphConnectors: [] } as never);
  }, [dispatch]);
  return (
    <div data-settings-card="developer.bot" className="flex flex-col gap-6">
      <BotWebhooks bot={bot} />
      <BotEventSubscriptions bot={bot} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="min-h-screen bg-app p-8 text-ink" data-gallery-bot-event-subscriptions="">
        <div className="mx-auto w-full max-w-[680px]">
          <Sections />
        </div>
      </div>
    </StoreProvider>
  </StrictMode>,
);
