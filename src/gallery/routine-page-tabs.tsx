/** Isolated gallery for a routine's page in the side panel (#4357): the real
 * RoutinesSection opened on one routine, its three tabs (Overview, Runs,
 * Settings). ?kind=schedule (weekdays at 8:15 PM, a mail tag and a watch),
 * ?kind=webhook, ?kind=webhook-missing (its webhook gone) or ?kind=webhook-view
 * (read-only); ?runs=<n> (default 9); ?tab=<overview|runs|settings>; ?width=<px> (default 400);
 * ?skin=<id>&lang=<code>. Not shipped in the app. Fictional names only. */
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

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;
const kind = params.get("kind") ?? "schedule";
const webhook = kind.startsWith("webhook");
const bot = { id: "pepper", threadId: "t1", name: "Pepper", title: "Pepper", description: "", notifications: false, color: "green", unread: false, messages: [], modelSelection: { instanceId: "local", model: "local" } } as unknown as Bot;
const prompt = "Read the shared inbox and the open requests board.\n\nPost the three items that need an answer today, each with who asked and by when. Skip anything already answered.\n\nEnd with one line on what changed since yesterday.";
const routine = {
  id: "r1", name: params.get("name") ?? (webhook ? "New order received" : "Evening wrap-up"), prompt, target: "bot", botId: "pepper", runOn: "maus", enabled: true,
  schedule: webhook ? { type: "webhook" } : { type: "cron", expression: "15 20 * * 1-5", timeZone: "America/Toronto" },
  ...(webhook ? {} : { mailAlias: "wrapup", precheck: { kind: "watch", source: { type: "files", path: "~/Inbox" } } }),
  nextRunAt: webhook ? null : NOW + 3 * HOUR, durationMinutes: 30, createdAt: 1, updatedAt: 1, canRun: true, postResults: true,
  ...(kind === "webhook-view" ? { canEdit: false, owner: { id: "pr_other", name: "Alex" } } : {}),
} as unknown as Routine;
const outputs = ["Three items need an answer today: the quote for the north office, the laptop return and the badge request.", "Nothing new since yesterday.", "Two requests answered, one waits on the vendor.", "The board did not answer in time."];
function historyFixture(mode: string): RoutineRun[] {
  const start = new Date(NOW).setHours(8, 0, 0, 0);
  const sample = Array.from({ length: 115 }, (_, i): RoutineRun => {
    const at = start + i * 4 * 60_000;
    const base: RoutineRun = { id: `sample-${i}`, routineId: routine.id, routineName: routine.name, botId: bot.id, target: "bot", runOn: "maus", createdAt: at, scheduledFor: at, startedAt: at, finishedAt: at + 800, manual: false, status: "nothing_to_report" };
    if (mode === "quiet") return base;
    if (i === 114 && mode === "running") return { ...base, status: "running", finishedAt: undefined };
    if ([62, 77, 89].includes(i)) return { ...base, status: "failed", error: "La lecture des billets a été interrompue.", finishedAt: at + 470_000 };
    if (i === 95) return { ...base, status: "completed", completionNotes: "- Read failed 7 times: timeout", finishedAt: at + 960_000 };
    if (i === 98) return { ...base, status: "completed", quiet: true, finishedAt: at + 57 * 60_000 };
    if (i === 76 || i === 34) return { ...base, status: "completed", output: JSON.stringify(i === 76 ? { placed: 1, cards: 1 } : { placed: 2, cards: 3, pending: 10 }), finishedAt: at + (i === 76 ? 41 : 21) * 60_000 };
    return base;
  });
  return sample;
}
const scenario = params.get("history");
const runs = scenario ? historyFixture(scenario) : Array.from({ length: Number(params.get("runs") ?? 9) }, (_, index) => {
  const at = NOW - 20 * HOUR - Math.floor(index / 2) * DAY - (index % 2) * 5 * HOUR;
  const failed = index === 3;
  return { id: `run-${index}`, routineId: "r1", routineName: routine.name, botId: "pepper", target: "bot", runOn: "maus", manual: index === 5, scheduledFor: at, startedAt: at, finishedAt: at + (4 + index) * 60_000, status: failed ? "failed" : "completed", ...(failed ? { error: outputs[3] } : { output: outputs[index % 3] }), ...(index === 2 ? { cost: 0.14 } : {}) };
}) as unknown as RoutineRun[];

function Ready({ children }: { children: React.ReactNode }) {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "hydrate", bots: [bot], groups: [], sections: [], computerControl: {} } as never);
    dispatch({ type: "routinesHydrated", routines: [routine], runs });
    if (webhook) dispatch({ type: "webhooksHydrated", webhooks: kind === "webhook-missing" ? [] : [{ id: "w1", endpointId: "ord-7f3a", routineId: "r1", botId: "pepper", name: routine.name, enabled: true, deliveryCount: 12, lastReceivedAt: NOW - 2 * HOUR, tokenLast4: "9c2e", createdAt: 1, updatedAt: 1 }], attempts: [], ingress: { available: true, baseUrl: "https://hooks.example.test" } } as never);
    dispatch({ type: "openRoutine", botId: "pepper", routineId: "r1" });
  }, [dispatch]);
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><Ready>
      <aside data-gallery-panel="" style={{ width: Number(params.get("width") ?? 400) }} className="relative h-[760px] border border-hairline/40 bg-panel text-ink">
        <RoutinesSection bot={bot} routines={[routine]} runs={runs} grouped />
      </aside>
    </Ready></StoreProvider>
  </StrictMode>,
);
