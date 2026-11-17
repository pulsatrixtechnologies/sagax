/** Isolated gallery for a routine's page action bar, the real RoutinesSection
 * opened on one routine, in a panel of ?width=<px> (default 380).
 * Not shipped in the app. ?skin=<id>&lang=<code>&running=1 (a run in flight,
 * #4436: the bar keeps the same buttons in the same places). */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RoutinesSection } from "../components/bot-settings/RoutinesSection";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import type { Routine, RoutineRun } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const bot = { id: "pepper", threadId: "t1", name: "Pepper", title: "Pepper", description: "", notifications: false, color: "green", unread: false, messages: [], modelSelection: {} } as unknown as Bot;
const routines = [{ id: "r1", name: "Morning summary", prompt: "Summarize the shared inbox and post the three items that need an answer today.", target: "bot", botId: "pepper", runOn: "maus", enabled: true, schedule: { type: "cron", expression: "30 8 * * 1-5", timeZone: "America/Toronto" }, nextRunAt: Date.now() + 3_600_000, durationMinutes: 30, createdAt: 1, updatedAt: 1, canRun: true }] as unknown as Routine[];

const runs = params.get("running") === "1"
  ? [{ id: "x1", routineId: "r1", routineName: "Morning summary", prompt: "", target: "bot", botId: "pepper", runOn: "maus", scheduledFor: Date.now() - 60_000, createdAt: Date.now() - 60_000, status: "running", manual: true }] as unknown as RoutineRun[]
  : [];

function Ready({ children }: { children: React.ReactNode }) {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines, runs });
    dispatch({ type: "openRoutine", botId: "pepper", routineId: "r1" });
  }, [dispatch]);
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><Ready>
      <aside data-gallery-panel="" style={{ width: Number(params.get("width") ?? 380) }} className="relative h-[420px] border border-hairline/40 bg-panel text-ink">
        <RoutinesSection bot={bot} routines={routines} runs={runs} grouped />
      </aside>
    </Ready></StoreProvider>
  </StrictMode>,
);
