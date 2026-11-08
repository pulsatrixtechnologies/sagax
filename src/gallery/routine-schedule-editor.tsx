/** Isolated gallery for headless screenshots of the routine editor's
 * schedule (2026-10-29): a routine on weekdays at three times, Toronto
 * time, opened in the editor. Mocked API; no server. Not shipped in the app.
 * ?lang=<code>&skin=<id>&cron=<expression>&zone=<IANA>&trigger=github|webhook */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RoutineEditor } from "../components/RoutineCalendarPage";
import { loadLocale } from "../lib/i18n";
import type { Routine } from "../lib/routines";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/")) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const bot = { id: "bot-ember", name: "Ember", color: "violet", tasks: [], modelSelection: { instanceId: "claude", model: "claude-sonnet" }, threadId: "thread-ember" } as unknown as Bot;
const routine = {
  id: "routine-1", name: "Suivi des billets", prompt: "Passe en revue les billets ouverts et résume ce qui a changé.",
  target: "bot", botId: bot.id, runOn: "maus", enabled: true,
  schedule: params.get("trigger") === "github"
    ? { type: "event", source: "github", events: ["issue.opened", "pr.opened"], filters: { repo: ["pulsatrixtechnologies/sagax"] } }
    : params.get("trigger") === "webhook"
      ? { type: "webhook" }
      : { type: "cron", expression: params.get("cron") ?? "30 8,12,16 * * 1-5", timeZone: params.get("zone") ?? "America/Toronto" },
  durationMinutes: 30, nextRunAt: Date.now() + 3_600_000, createdAt: Date.now(), updatedAt: Date.now(),
} as unknown as Routine;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <RoutineEditor routine={routine} bots={[bot]} lockedBotId={bot.id} onClose={() => {}} />
    </StoreProvider>
  </StrictMode>,
);
