/** Isolated gallery for the bot panel's head and its routine rows (#4151):
 * the real BotSettingsDialog beside a plain conversation area, a bot with a
 * short or a long name and title, and routines whose last run went fine,
 * failed, ended with problems, or never ran. Synthetic data only, the server
 * answered by a fetch stub. Not shipped in the app.
 * ?rows=states (#4202): a running routine, paused and active change
 * triggers, a paused webhook, beside a plain schedule.
 * ?skin=<id>&lang=<code>&width=<px>&long=1&rows=states */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { loadLocale } from "../lib/i18n";
import { BotEditorStore, initialState, type Bot } from "../state/store";
import { BotSettingsDialog } from "../components/BotSettingsDialog";
import type { Routine, RoutineRun } from "../../shared/routines";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.98", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const fr = lang === "fr";
const long = params.get("long") === "1";
const width = Number(params.get("width") ?? 1280);

const NOW = Date.now();
const H = 3_600_000;
const bot = {
  id: "osprey", threadId: "t-osprey",
  name: long ? "Osprey of the northern operations desk" : "Osprey",
  title: long ? (fr ? "Coordonnateur des opérations et des rapports hebdomadaires" : "Operations and weekly reports coordinator") : (fr ? "Recherche" : "Research"),
  description: "", notifications: true, color: "green", unread: false, mascotLook: { character: params.get("character") ?? "shape" },
  messages: [], tasks: [], computer: "local", modelSelection: { instanceId: "x", model: "x" },
} as unknown as Bot;

const routine = (id: string, name: string, expression: string, offset: number): Routine => ({
  id, name, prompt: "Report", target: "bot", botId: "osprey", runOn: "maus", enabled: true,
  schedule: { type: "cron", expression, timeZone: "America/Toronto" }, durationMinutes: 30, nextRunAt: NOW + offset, createdAt: 1, updatedAt: 1,
} as Routine);

const states = params.get("rows") === "states";
const routines = states ? [
  routine("r-running", fr ? "Revue des billets ouverts" : "Open tickets review", "0 * * * *", 2 * H),
  routine("r-fine", fr ? "Résumé du matin" : "Morning summary", "30 8 * * 1-5", H),
  { ...routine("r-watch", fr ? "Suivi des rapports" : "Reports watch", "0 9 * * *", 3 * H), precheck: { kind: "watch", source: { type: "files", path: "reports" } } } as Routine,
  { ...routine("r-watch-off", fr ? "Tri de la boîte de réception" : "Inbox triage", "3 4 * * *", 0), enabled: false, nextRunAt: null, precheck: { kind: "watch", source: { type: "files", path: "reports" } } } as Routine,
  { ...routine("r-hook-off", fr ? "Alerte de déploiement" : "Deploy alert", "0 0 * * *", 0), enabled: false, nextRunAt: null, schedule: { type: "webhook" } } as Routine,
] : [
  routine("r-fine", fr ? "Résumé du matin" : "Morning summary", "30 8 * * 1-5", H),
  routine("r-failed", fr ? "Revue des billets ouverts" : "Open tickets review", "0 * * * *", 2 * H),
  routine("r-problems", fr ? "Rapport hebdomadaire des sauvegardes" : "Weekly backup report", "0 9 * * 1", 3 * H),
  routine("r-never", fr ? "Tri de la boîte de réception" : "Inbox triage", "0 17 * * 5", 4 * H),
];

const run = (routineId: string, extra: Partial<RoutineRun>): RoutineRun => ({
  id: `run-${routineId}`, routineId, routineName: routineId, target: "bot", botId: "osprey", runOn: "maus",
  scheduledFor: NOW - 2 * H, createdAt: NOW - 2 * H, startedAt: NOW - 2 * H, finishedAt: NOW - 2 * H + 60_000, manual: false, status: "completed",
  ...extra,
} as RoutineRun);

const routineRuns = [
  ...(states ? [run("r-running", { status: "running", startedAt: NOW - 3 * 60_000, createdAt: NOW - 3 * 60_000, scheduledFor: NOW - 3 * 60_000, finishedAt: undefined })] : []),
  run("r-fine", { output: fr ? "Trois messages à lire, rien d'urgent." : "Three messages to read, nothing urgent." }),
  run("r-failed", { status: "failed", error: fr ? "Le connecteur n'a pas répondu." : "The connector did not answer.", finishedAt: NOW - 5 * H, startedAt: NOW - 5 * H, scheduledFor: NOW - 5 * H, createdAt: NOW - 5 * H }),
  run("r-problems", { problems: fr ? "Deux postes n'ont pas répondu." : "Two machines did not answer.", output: fr ? "Deux postes n'ont pas répondu." : "Two machines did not answer.", finishedAt: NOW - 14 * H, startedAt: NOW - 14 * H, scheduledFor: NOW - 14 * H, createdAt: NOW - 14 * H }),
];

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
window.fetch = ((input: RequestInfo | URL) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (/\/task-list/.test(url)) return json({ tasks: [] });
  if (/\/team-work/.test(url)) return Promise.resolve(new Response("{}", { status: 404, headers: { "content-type": "application/json" } }));
  if (/\/activity/.test(url)) return json({ items: [], subagents: [], launchedAgents: [] });
  if (/\/overview/.test(url)) return json({ setup: [] });
  if (/\/files/.test(url)) return json({ files: [] });
  if (url.includes("/api/artifacts")) return json({ artifacts: [] });
  if (url.includes("/api/pages")) return json({ pages: [] });
  return json({});
}) as typeof fetch;
(window as unknown as { EventSource: unknown }).EventSource = class { close() {} addEventListener() {} removeEventListener() {} onmessage = null; onerror = null; onopen = null; readyState = 0; };

function Gallery() {
  const store = {
    state: { ...initialState, bots: [bot], groups: [], routines, routineRuns, routinesLoadState: "ready", selectedId: "osprey", settingsOpen: true, config: null,
      instances: [{ instanceId: "x", displayName: "Fixture", engineId: "fixture", models: { options: [{ id: "x", label: "Fixture" }] }, snapshot: { authenticated: true, installed: true } }] },
    dispatch: () => {},
    flushBotPatches: () => Promise.resolve(bot),
  } as never;
  return (
    <BotEditorStore value={store}>
      <div data-gallery-sample="" className="relative flex h-[860px] bg-app text-ink" style={{ width }}>
        <div className="min-w-0 flex-1 bg-panel p-6 text-[13px] text-ink-secondary">{fr ? "Conversation (galerie)" : "Conversation (gallery)"}</div>
        <BotSettingsDialog bot={bot} />
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
