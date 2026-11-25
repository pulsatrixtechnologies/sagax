/** Isolated gallery for the bot panel's Routines list with folders
 * (2026-10-28, shared/routine-folders.ts), beside a sidebar section header
 * so the alignment can be compared. Neutral made-up routines; it answers
 * /api itself, so nothing reaches a server. Not shipped in the app.
 * ?skin=<id>&lang=<code>&state=prefixed|filed|collapsed|running
 * &server=0.8.7 answers as that release does (2026-10-28): no feature list,
 * no `folders` in the listing, and 404 "no route" for the folder route.
 * &upcoming=1 draws the bot panel's flat Upcoming card, &empty=1 adds an
 * empty folder ("Clients"); a move or a new folder is answered here (#5376). */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RoutinesSection } from "../components/bot-settings/RoutinesSection";
import { SidebarSectionHeader } from "../components/SidebarSectionHeader";
import { ChatErrorBanner } from "../components/ChatErrorBanner";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import type { Routine } from "../lib/routines";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const state = params.get("state") ?? "prefixed";
const oldServer = params.get("server") === "0.8.7";
try {
  localStorage.removeItem("sagax.routineFolders.collapsed.v1");
  localStorage.removeItem("sagax.routineFolders.prefixOffer.v1");
  if (state === "collapsed") localStorage.setItem("sagax.routineFolders.collapsed.v1", JSON.stringify({ pepper: ["Team"] }));
} catch {
  // the gallery still renders with the defaults
}

const bot = { id: "pepper", threadId: "t1", name: "Pepper", title: "Pepper", description: "", notifications: false, color: "green", unread: false, messages: [] } as unknown as Bot;
const H = 3_600_000;
const weekdays = (expression: string) => ({ type: "cron", expression, timeZone: "America/Toronto" });
const rows: Array<[string, string, Record<string, unknown>, boolean?]> = [
  ["Reports", "Morning summary of the shared inbox", weekdays("30 8 * * 1-5")],
  ["Reports", "Weekly numbers for the team meeting", weekdays("0 9 * * 1")],
  ["Reports", "Month-end usage report with the top ten changes", weekdays("0 7 1 * *")],
  ["Team", "Remind everyone about the stand-up notes", weekdays("45 9 * * 1-5")],
  ["Team", "Friday wins and lessons learned", weekdays("0 16 * * 5")],
  ["Team", "Check the shared calendar for conflicts", weekdays("0 18 * * 0"), false],
  ["Build", "Nightly test run of the main branch", weekdays("0 2 * * *")],
  ["Build", "Dependency updates waiting for review", weekdays("0 10 * * 2")],
  ["Build", "Clean up branches merged last week", weekdays("0 11 * * 6")],
  ["House", "Plant watering reminder", weekdays("0 19 * * 3")],
  ["House", "Recycling goes out tomorrow", weekdays("0 20 * * 1")],
  ["House", "Check the backup drive space", weekdays("0 21 * * 0")],
  ["Learning", "Pick one article to read today", weekdays("15 12 * * 1-5")],
  ["Learning", "Practice vocabulary for ten minutes", weekdays("30 20 * * *"), false],
  ["", "Water filter replacement", { type: "daily", time: "07:48", weekdays: [1, 2, 3, 4, 5], timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 }],
  ["", "Renew the parking permit", { type: "once", at: Date.now() + 72 * H }],
];
const filed = state !== "prefixed" && !oldServer;
let routines = rows.map(([folder, name, schedule, enabled = true], index) => ({
  id: `r${index + 1}`,
  name: !filed && folder ? `[${folder}] ${name}` : name,
  ...(filed && folder ? { folder } : {}),
  prompt: "Summarize what changed.",
  target: "bot",
  botId: "pepper",
  runOn: "maus",
  enabled,
  schedule,
  nextRunAt: enabled ? Date.now() + (index + 1) * H : null,
  durationMinutes: 30,
  createdAt: index + 1,
  updatedAt: index + 1,
})) as unknown as Routine[];
const folders: Record<string, string[]> = filed ? { pepper: ["Reports", "Team", "Build", "House", "Learning", ...(params.get("empty") === "1" ? ["Clients"] : [])] } : {};
// live=1: one routine runs right now (the quiet "Running" word).
const runs = params.get("live") === "1" ? [{ id: "run-live", routineId: routines[1]!.id, routineName: routines[1]!.name, status: "running", scheduledFor: Date.now(), manual: false, botId: routines[1]!.botId }] : [];

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (oldServer) {
    if (path === "/.well-known/sagax/environment") return json({ environmentId: "00000000-0000-4000-8000-000000000000", label: "server", platform: "linux", version: "0.1.107", capabilities: { remoteSessions: true, selfUpdate: "operator", emailSignIn: false, signInPreview: true } });
    if (path === "/api/routines") return json({ routines, runs, scope: "mine" });
    if (path === "/api/routines/folders") return new Response(JSON.stringify({ error: `no route: ${init?.method ?? "GET"} ${path}` }), { status: 404, headers: { "content-type": "application/json" } });
  }
  if (path === "/api/routines") return json({ routines, runs, folders });
  if (path === "/api/routines/folders" && init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as { action: string; name?: string; routineIds?: string[]; folder?: string | null };
    // kept here, as a server would: the next listing answers the same
    const known = folders.pepper ?? [];
    if (body.action === "create" && body.name) {
      folders.pepper = [...known, body.name];
      return json({ folders: folders.pepper, routines: [] });
    }
    if (body.action === "move") {
      const moves = (routine: Routine) => Boolean(body.routineIds?.includes(routine.id));
      routines = routines.map((routine) => {
        if (!moves(routine)) return routine;
        const { folder: _old, ...rest } = routine;
        return (body.folder ? { ...rest, folder: body.folder } : rest) as Routine;
      });
      if (body.folder && !known.includes(body.folder)) folders.pepper = [...known, body.folder];
      return json({ folders: folders.pepper ?? [], routines: routines.filter(moves) });
    }
  }
  if (path === "/api/webhooks") return json({ webhooks: [], attempts: [], ingress: null });
  if (path === "/api/bots") return json({ bots: [bot], groups: [], sections: [], computerControl: {} });
  return realFetch(input, init);
}) as typeof window.fetch;

function Ready({ children }: { children: React.ReactNode }) {
  const { dispatch } = useStore();
  useEffect(() => { dispatch({ type: "routinesHydrated", routines, runs, ...(oldServer ? {} : { folders }) } as never); }, [dispatch]);
  return <>{children}</>;
}

/** The app's error banner, as the chat shows it above the panel. */
function Banner() {
  const { state: app, dispatch } = useStore();
  return <ChatErrorBanner message={app.error} onDismiss={() => dispatch({ type: "error", message: null })} />;
}

/** The panel's list, from the store once hydrated, so a move shows where the routine went. */
function Panel() {
  const { state: app } = useStore();
  return <RoutinesSection bot={bot} routines={app.routines?.length ? app.routines : routines} runs={runs as never} grouped upcoming={params.get("upcoming") === "1"} />;
}

const sidebarRow = (name: string) => <div className="flex h-9 items-center gap-2.5 rounded-lg px-2 text-[13px] text-sidebar-ink"><span className="size-6 rounded-full bg-accent/30" />{name}</div>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><Ready>
      <div data-gallery-card="" className="flex items-start gap-0 bg-app">
        <aside data-gallery-sidebar="" className="w-[300px] self-stretch border-r border-hairline/40 bg-sidebar px-2 py-4 text-sidebar-ink">
          <SidebarSectionHeader name="My Team" collapsed={false} reorderable={false} dragging={false} onToggle={() => {}} />
          <div className="flex flex-col gap-1">{sidebarRow("Atlas")}{sidebarRow("Iris")}</div>
          <div className="pt-2.5"><SidebarSectionHeader name="Unassigned" collapsed reorderable={false} dragging={false} onToggle={() => {}} /></div>
        </aside>
        <aside data-gallery-panel="" className="w-[380px] border-r border-hairline/40 bg-panel px-4 py-4 text-ink">
          <div className="-mx-5"><Banner /></div>
          <section data-bot-settings-section="routines" className="flex flex-col gap-2">
            <Panel />
          </section>
        </aside>
      </div>
    </Ready></StoreProvider>
  </StrictMode>,
);
