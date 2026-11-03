/** Isolated gallery for headless screenshots of "Edit routine" (2026-10-29):
 * the editor on a clock routine or a webhook routine, the routine page's
 * Configuration with its webhook, and Edit bot's webhook list. Mocked API;
 * no server. Not shipped in the app.
 * ?lang=<code>&skin=<id>&view=editor|panel-editor|page|bot&trigger=clock|webhook
 * panel-editor: "Edit routine" in the side panel (400 px), as JC sees it. */
import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RoutineEditor } from "../components/RoutineCalendarPage";
import { RoutineConfiguration } from "../components/routines/RoutineConfiguration";
import { BotWebhooks } from "../components/bot-settings/BotWebhooks";
import { RoutinesSection } from "../components/bot-settings/RoutinesSection";
import type { RoutineRun } from "../lib/routines";
import { loadLocale } from "../lib/i18n";
import type { Routine } from "../lib/routines";
import type { WebhookTrigger } from "../lib/webhooks";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const view = params.get("view") ?? "editor";
const trigger = params.get("trigger") ?? "clock";

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/")) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const bot = { id: "bot-ember", name: "Ember", color: "violet", tasks: [], threadId: "thread-ember" } as unknown as Bot;
const prompt = [
  "Passe en revue les billets ouverts et résume ce qui a changé depuis la dernière exécution.",
  "",
  "- Regroupe par client.",
  "- Signale les billets en attente depuis plus de 2 jours.",
  "- Termine par **trois actions** à faire en priorité.",
].join("\n");
const routine = {
  id: "routine-1", name: trigger === "webhook" ? "Nouvelle commande" : "Suivi des billets", prompt,
  target: "bot", botId: bot.id, runOn: "maus", enabled: true, overlap: "skip",
  schedule: trigger === "webhook" ? { type: "webhook" } : { type: "cron", expression: params.get("cron") ?? "30 8,12,16 * * 1-5", timeZone: "America/Toronto" },
  durationMinutes: 30, timeoutMinutes: 30, nextRunAt: Date.now() + 3_600_000, createdAt: Date.now(), updatedAt: Date.now(),
} as unknown as Routine;
const webhooks = [
  { id: "wh-1", endpointId: "wh_7f3k2p9q", routineId: "routine-1", name: "Nouvelle commande", prompt, botId: bot.id, runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 12, lastReceivedAt: Date.now() - 25 * 60_000, tokenLast4: "x8Qa" },
  { id: "wh-2", endpointId: "wh_a1b2c3d4", name: "Alerte de surveillance", prompt: "Analyse l'alerte reçue.", botId: bot.id, runOn: "maus", enabled: false, createdAt: 1, updatedAt: 1, deliveryCount: 0, tokenLast4: "m2Lk" },
] as unknown as WebhookTrigger[];

const now = Date.now();
const runs = [0, 1, 2].map((index) => ({
  id: `run-${index}`, routineId: routine.id, routineName: routine.name, botId: bot.id, target: "bot", status: index === 1 ? "failed" : "succeeded",
  scheduledFor: now - (index + 1) * 4 * 3_600_000, startedAt: now - (index + 1) * 4 * 3_600_000, finishedAt: now - (index + 1) * 4 * 3_600_000 + 95_000,
  output: index === 1 ? undefined : "## Résumé\n\n- 3 billets ouverts depuis hier\n- 1 billet en attente du client", error: index === 1 ? "Le connecteur n'a pas répondu à temps." : undefined,
  prompt, runOn: "maus", trigger: "schedule",
})) as unknown as RoutineRun[];

function Seed({ children }: { children: ReactNode }) {
  const { state, dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "webhooksHydrated", webhooks, attempts: [], ingress: { available: true, baseUrl: "https://hooks.example.test" } } as never);
    dispatch({ type: "routinesHydrated", routines: [routine], runs } as never);
    if (view === "panel") dispatch({ type: "openRoutine", botId: bot.id, routineId: routine.id } as never);
  }, [dispatch]);
  return state.webhooks.length ? <>{children}</> : null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Seed>
        {view === "panel-editor"
          ? <aside data-gallery-card style={{ width: 400 }} className="relative h-[880px] overflow-hidden border border-hairline/40 bg-panel text-ink"><RoutineEditor routine={routine} bots={[bot]} lockedBotId={bot.id} presentation="panel" onClose={() => {}} /></aside>
          : view === "panel"
          ? <aside data-gallery-card style={{ width: 400 }} className="relative h-[820px] border border-hairline/40 bg-panel text-ink"><RoutinesSection bot={bot} routines={[routine]} runs={runs} grouped /></aside>
          : view === "page"
          ? <div style={{ maxWidth: 720, padding: 16 }} data-gallery-card className="bg-canvas"><RoutineConfiguration routine={routine} bots={[bot]} /></div>
          : view === "bot"
            ? <div style={{ maxWidth: 560, padding: 16 }} data-gallery-card className="bg-canvas"><BotWebhooks bot={bot} /></div>
            : <RoutineEditor routine={routine} bots={[bot]} lockedBotId={bot.id} onClose={() => {}} />}
      </Seed>
    </StoreProvider>
  </StrictMode>,
);
