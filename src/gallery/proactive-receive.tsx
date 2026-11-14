/** Isolated gallery for headless screenshots of #3432 (not shipped):
 * Settings, Notifications, « Ce que je reçois » under the daily budget and
 * quiet hours (its conforming neighbour, SignalSettings), and the bot
 * page's Permissions with « Ce que ce bot suit pour toi » under the
 * Proactive rows. ?skin=<id>&lang=<code>&view=settings|bot|empty */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PermissionsSection } from "../components/bot-settings/PermissionsSection";
import type { useBotSettingsDerived } from "../components/bot-settings/useBotSettingsDerived";
import { SignalSettings } from "../components/settings/SignalSettings";
import { ProactiveReceiveSettings } from "../components/settings/ProactiveReceiveSettings";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
try { localStorage.setItem("sagax.interfaceMode.v1", "advanced"); } catch { /* none */ }

const view = params.get("view") ?? "settings";
const fr = (params.get("lang") ?? "fr") === "fr";
const now = Date.now();
const bots = [
  { id: "bot-main", name: "Mélodie", color: "orange", chiefOfStaff: true, proactiveMode: "proactive", approvalMode: "ask", threadId: "t1",
    directTriggers: { mail: { on: true, filters: "from:*@client.example" }, sms: { on: false } } },
  { id: "bot-atlas", name: "Atlas", color: "blue", proactiveMode: "off", approvalMode: "ask", threadId: "t2" },
] as unknown as Bot[];
const receive = view === "empty" ? { bots: [], domains: [], unavailable: "you have no bot that can carry a watch" } : {
  bots: [{ id: "bot-main", brief: true, checklist: true, endOfDay: true, weekly: false }, { id: "bot-atlas", brief: false, screen: false }],
  domains: [
    { domain: "backups", label: { fr: "Sauvegardes", en: "Backups" }, carriers: ["bot-atlas"],
      watches: [{ id: "backup-failed", summary: fr ? "Sauvegardes en échec" : "Failed backups", cadence: "1h", runsOn: ["bot-atlas"] }] },
    { domain: "service", label: { fr: "Centre de services", en: "Service desk" }, carriers: ["bot-main", "bot-atlas"], lastAlertAt: now - 42 * 60_000,
      watches: [
        { id: "open-overdue", summary: fr ? "Billets ouverts en retard" : "Open tickets past due", cadence: "daily@08:00", runsOn: ["bot-main", "bot-atlas"], lastAlertAt: now - 42 * 60_000 },
        { id: "unassigned", summary: fr ? "Billets sans technicien" : "Tickets with no technician", cadence: "15m", runsOn: ["bot-main", "bot-atlas"] },
      ] },
    // stored on with a bot that can no longer carry it: drawn off, its pause stated
    { domain: "security", label: { fr: "Sécurité", en: "Security" }, carriers: ["bot-atlas"],
      watches: [{ id: "threats", summary: fr ? "Menaces actives" : "Active threats", cadence: "1h", runsOn: ["bot-atlas"] }] },
  ],
};
let choices: Record<string, unknown> = {
  service: { state: "on", botId: "bot-main", at: now, via: "card", by: "me", watchesOff: { unassigned: { at: now, via: "settings" } } },
  backups: { state: "never", at: now, via: "card", by: "me" },
  security: { state: "on", botId: "bot-main", at: now, via: "card", by: "me" },
};


const original = window.fetch.bind(window);
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  if (path === "/api/me/proactive" && (init?.method ?? "GET") === "GET") return json({ domains: choices, receive });
  if (path === "/api/me/proactive") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    choices = { ...choices, [body.domain]: { state: body.state ?? "off", ...(body.botId ? { botId: body.botId } : {}), at: Date.now(), via: "settings", by: "me" } };
    return json({ domains: choices });
  }
  if (path === "/api/me/signals") return json({ budget: "10", quiet: JSON.stringify({ start: "22:00", end: "07:00", timeZone: "America/Toronto" }) });
  // the store's own snapshot hydrates too: answer it with the same bots, or it
  // races the gallery's hydrate and empties the page (a blank capture)
  if (path === "/api/bots") return json({ bots, groups: [], sections: [], computerControl: {}, botQueuedMessages: {} });
  if (path.endsWith("/lifecycle-hooks")) return json({ enabled: false, events: [] });
  if (path.startsWith("/api/")) return json({});
  return original(input, init);
};

const derived = {
  patch: () => {}, engine: undefined, canCoordinate: true, approvalMode: "ask",
  trustedModesAvailable: false, sectionName: "", currentChief: undefined,
} as unknown as ReturnType<typeof useBotSettingsDerived>;

function Hydrate() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots, groups: [], sections: [], computerControl: {} } as never);
  }, [dispatch]);
  return null;
}

function Gallery() {
  const { state } = useStore();
  const main = state.bots.find((bot) => bot.id === "bot-main");
  return (
    <main className="min-h-screen bg-app p-6 text-ink" data-gallery-receive="">
      <Hydrate />
      {view === "bot" ? (
        <div data-gallery-panel="" className="w-[560px] rounded-2xl border border-hairline/40 bg-panel px-4 pb-6 pt-4">
          {main && <PermissionsSection bot={main} derived={derived} part="actsAlone" />}
        </div>
      ) : (
        <div data-gallery-panel="" className="mx-auto flex max-w-[680px] flex-col gap-6">
          <SignalSettings organization />
          {state.bots.length > 0 && <ProactiveReceiveSettings />}
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><StoreProvider><Gallery /></StoreProvider></StrictMode>);
