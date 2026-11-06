/** Isolated gallery for the bot panel's Tasks section (shared/bot-task-list.ts),
 * above the Routines section so the two can be compared. Neutral made-up
 * tasks and routines; it answers /api itself, so nothing reaches a server.
 * Not shipped in the app.
 * ?skin=<id>&lang=<code>&state=empty|tasks|open|detail|menu|done */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BotTaskSection } from "../components/bot-settings/BotTaskSection";
import { RoutinesSection } from "../components/bot-settings/RoutinesSection";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import type { Routine } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const state = params.get("state") ?? "tasks";

const bot = { id: "pepper", threadId: "t1", name: "Pepper", title: "Pepper", description: "", notifications: false, color: "green", unread: false, messages: [] } as unknown as Bot;
const H = 3_600_000;
const now = Date.now();
const tasks: Array<Record<string, unknown>> = state === "empty" ? [] : [
  { id: "task_aaaaaaaa1", botId: "pepper", title: "Draft the weekly team summary", state: "doing", history: [{ state: "doing", at: now - 3 * H, by: "bot" }], createdAt: now - 3 * H, updatedAt: now - H },
  { id: "task_aaaaaaaa2", botId: "pepper", threadId: "t1", title: "Choose between the two meeting times for Thursday afternoon with the whole team", state: "waiting", note: "Both rooms are free at 2 PM and 4 PM.\nThe 4 PM room has a screen for the demo.", history: [{ state: "doing", at: now - 5 * H, by: "bot" }, { state: "waiting", at: now - 2 * H, by: "bot" }], createdAt: now - 5 * H, updatedAt: now - 2 * H },
  { id: "task_aaaaaaaa3", botId: "pepper", title: "Renew the domain before it expires", state: "done", history: [{ state: "doing", at: now - 30 * H, by: "bot" }, { state: "done", at: now - 20 * H, by: "bot" }], createdAt: now - 30 * H, updatedAt: now - 20 * H },
  { id: "task_aaaaaaaa4", botId: "pepper", title: "Sort the shared inbox into folders", state: "done", history: [{ state: "doing", at: now - 50 * H, by: "bot" }, { state: "done", at: now - 40 * H, by: "person" }], createdAt: now - 50 * H, updatedAt: now - 40 * H },
];
const weekdays = (expression: string) => ({ type: "cron", expression, timeZone: "America/Toronto" });
const routines = ([
  ["Morning summary of the shared inbox", "30 8 * * 1-5"],
  ["Weekly numbers for the team meeting", "0 9 * * 1"],
  ["Check the backup drive space", "0 21 * * 0"],
] as const).map(([name, cron], index) => ({
  id: `r${index + 1}`, name, prompt: "Summarize what changed.", target: "bot", botId: "pepper", runOn: "maus", enabled: true,
  schedule: weekdays(cron), nextRunAt: now + (index + 1) * H, durationMinutes: 30, createdAt: index + 1, updatedAt: index + 1,
})) as unknown as Routine[];

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (path === "/api/bots/pepper/task-list") return json({ tasks });
  const move = path.match(/\/api\/bots\/pepper\/task-list\/([^/]+)\/complete$/);
  if (move && init?.method === "POST") {
    const task = tasks.find((item) => item.id === move[1]);
    if (task) { task.state = "done"; task.updatedAt = Date.now(); }
    return json({ task });
  }
  if (typeof path === "string" && path.startsWith("/api/routines")) return json({ routines, runs: [], folders: {} });
  if (path === "/api/bots") return json({ bots: [bot], groups: [], sections: [], computerControl: {} });
  return realFetch(input, init);
}) as typeof window.fetch;

function Ready({ children }: { children: React.ReactNode }) {
  const { dispatch } = useStore();
  useEffect(() => { dispatch({ type: "routinesHydrated", routines, runs: [], folders: {} } as never); }, [dispatch]);
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><Ready>
      <div data-gallery-card="" className="bg-app">
        <aside data-gallery-panel="" className="relative flex min-h-[640px] w-[380px] flex-col gap-6 bg-panel px-4 py-4 text-ink">
          <BotTaskSection botId={bot.id} />
          <section data-bot-settings-section="routines" className="flex flex-col gap-2">
            <RoutinesSection bot={bot} routines={routines} runs={[]} grouped />
          </section>
        </aside>
      </div>
    </Ready></StoreProvider>
  </StrictMode>,
);
