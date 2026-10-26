/** Isolated gallery for headless screenshots of the routine task view and
 * the Automations list rows, showing a cron schedule in words.
 * ?lang=<code>&skin=<id>&cron=<expression>. Not shipped in the app. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EventDetails } from "../components/RoutineCalendarPage";
import { RoutineList } from "../components/routines/RoutineList";
import { setLocale } from "../lib/i18n";
import type { Routine } from "../lib/routines";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/")) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const expression = params.get("cron") ?? "0,17,20,40 8-18 * * 1-5";
const bot = { id: "bot-katarina", name: "Katarina", color: "violet" } as unknown as Bot;
const routine = {
  id: "routine-1", name: "Suivi des billets", prompt: "Passe en revue les billets ouverts.", target: "bot", botId: bot.id,
  runOn: "local", enabled: true, schedule: { type: "cron", expression, timeZone: "America/Toronto" },
  durationMinutes: 15, nextRunAt: Date.now() + 3_600_000, createdAt: Date.now(), updatedAt: Date.now(),
} as unknown as Routine;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div style={{ width: 760, padding: 16 }} data-gallery-card>
        <div style={{ marginBottom: 16 }}>
          <RoutineList routines={[routine]} runs={[]} onOpen={() => {}} />
        </div>
        <EventDetails item={{ kind: "routine", id: "r1", at: Date.now() + 3_600_000, durationMinutes: 15, routine, run: null }}
          bots={[bot]} onClose={() => {}} onEdit={() => {}} onCallChanged={() => {}} onOpenRoom={() => {}} />
      </div>
    </StoreProvider>
  </StrictMode>,
);
