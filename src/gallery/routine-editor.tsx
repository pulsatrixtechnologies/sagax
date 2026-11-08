/** Isolated gallery for headless screenshots of "Edit routine" (2026-10-29):
 * the editor on a clock routine or a webhook routine, the routine page's
 * Configuration with its webhook, and Edit bot's webhook list. Mocked API;
 * no server. Not shipped in the app.
 * ?lang=<code>&skin=<id>&view=editor|panel-editor|page|bot&trigger=clock|webhook&mode=view|edit&advanced=1
 * panel-editor: the routine panel in the side panel (400 px), as JC sees it;
 * mode=edit opens it editable (2026-11-03: view mode first), advanced=1 opens
 * Advanced. goal=1 gives the routine a goal in progress (#2696). */
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
const mode = params.get("mode") === "edit" ? "edit" : "view";
// #2272: the editor always opens with Advanced folded; advanced=1 unfolds it
// after the first paint, as a person's click would.
if (params.get("advanced") === "1") {
  const unfold = () => {
    const more = document.querySelector<HTMLElement>("[data-routine-editor-more] > summary");
    if (more) more.click(); else setTimeout(unfold, 50);
  };
  setTimeout(unfold, 50);
}

const realFetch = window.fetch.bind(window);
(window as unknown as { __routinePatches: unknown[] }).__routinePatches = [];
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  // 2026-11-06: a routine's page saves in place; PATCH and POST answer with
  // the routine as saved, so the gallery can walk the real flow.
  const method = init?.method ?? "GET";
  if (/\/api\/routines(\/routine-1)?$/.test(url) && (method === "PATCH" || method === "POST")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as Partial<Routine>;
    saved = { ...saved, ...body, ...(method === "POST" ? { id: "routine-2" } : {}), updatedAt: Date.now() } as Routine;
    (window as unknown as { __routinePatches: unknown[] }).__routinePatches.push({ method, body });
    return new Response(JSON.stringify({ routine: saved }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/api/")) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const bot = { id: "bot-ember", name: "Ember", color: "violet", tasks: [], threadId: "thread-ember", modelSelection: { instanceId: "claude-1", model: "opus", auto: false } } as unknown as Bot;
// #2049: a Claude engine, so the editor offers Model and Sub-agent model.
const claudeInstance = { instanceId: "claude-1", driverKind: "claudeAgent", models: { default: "opus", options: [{ id: "opus", label: "Opus" }, { id: "sonnet", label: "Sonnet" }, { id: "haiku", label: "Haiku" }] } };
const prompt = [
  "Passe en revue les billets ouverts et résume ce qui a changé depuis la dernière exécution.",
  "",
  "- Regroupe par client.",
  "- Signale les billets en attente depuis plus de 2 jours.",
  "- Termine par **trois actions** à faire en priorité.",
  "",
  "Consulte [le tableau des billets](https://example.test/board) et la [liste des clients](https://example.test/clients).",
].join("\n");
// long=1: an instruction of several screens (Show more in view mode).
const longPrompt = Array.from({ length: 14 }, (_, index) => `## Étape ${index + 1}\n\n${prompt}`).join("\n\n");
const routine = {
  id: "routine-1", name: trigger === "webhook" ? "Nouvelle commande" : "Suivi des billets", prompt: params.get("long") === "1" ? longPrompt : prompt,
  target: "bot", botId: bot.id, runOn: "maus", enabled: true, overlap: "skip",
  schedule: trigger === "webhook" ? { type: "webhook" } : { type: "cron", expression: params.get("cron") ?? "30 8,12,16 * * 1-5", timeZone: "America/Toronto" },
  postResults: true, attachments: trigger === "webhook" ? [] : [{ id: "a1", kind: "file", name: "clients.md", path: "/tmp/clients.md", size: 1200 }],
  durationMinutes: 30, timeoutMinutes: 30, nextRunAt: Date.now() + 3_600_000, createdAt: Date.now(), updatedAt: Date.now(),
  ...(params.get("goal") === "1" ? { goal: { text: "Ramener la sauvegarde nocturne à 100 % sur tous les postes.", status: "active", deadline: Date.now() + 3 * 86_400_000, checks: 4, progress: "82 % (41 postes sur 50)", nextCheckAt: Date.now() + 3 * 3_600_000 } } : {}),
} as unknown as Routine;
let saved = routine;
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

/** The panel follows the store, as the app does: a save shows on the page. */
function LiveRoutines() {
  const { state } = useStore();
  return <RoutinesSection bot={bot} routines={state.routines.length ? state.routines : [routine]} runs={runs} grouped />;
}

function Seed({ children }: { children: ReactNode }) {
  const { state, dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "instances", instances: [claudeInstance] } as never);
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
        {view === "panel-new"
          ? <aside data-gallery-card style={{ width: 400 }} className="relative h-[560px] overflow-hidden border border-hairline/40 bg-panel text-ink"><RoutineEditor bots={[bot]} lockedBotId={bot.id} presentation="panel" onClose={() => {}} /></aside>
          : view === "panel-editor"
          ? <aside data-gallery-card style={{ width: 400 }} className="relative h-[880px] overflow-hidden border border-hairline/40 bg-panel text-ink"><RoutineEditor routine={routine} mode={mode} bots={[bot]} lockedBotId={bot.id} presentation="panel" onClose={() => {}} onDismiss={() => {}} /></aside>
          : view === "panel"
          ? <aside data-gallery-card style={{ width: 400 }} className="relative h-[820px] border border-hairline/40 bg-panel text-ink"><LiveRoutines /></aside>
          : view === "page"
          ? <div style={{ maxWidth: 720, padding: 16 }} data-gallery-card className="bg-canvas"><RoutineConfiguration routine={routine} bots={[bot]} /></div>
          : view === "bot"
            ? <div style={{ maxWidth: 560, padding: 16 }} data-gallery-card className="bg-canvas"><BotWebhooks bot={bot} /></div>
            : <RoutineEditor routine={routine} bots={[bot]} lockedBotId={bot.id} onClose={() => {}} />}
      </Seed>
    </StoreProvider>
  </StrictMode>,
);
