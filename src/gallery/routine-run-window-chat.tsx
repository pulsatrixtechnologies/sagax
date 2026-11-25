/** Isolated gallery for headless captures of a routine run's window opened
 * over the real chat (ChatView), message bar included [M-20261125-040]: the
 * run's sheet with its header pill, its lines and its footer row.
 * case=done: a finished run with its report. case=live: a run whose turn is
 * still going (two texts and three steps so far).
 * Neutral fictional bot and routine; a mocked fetch answers /api, nothing
 * reaches a server. Not shipped in the app.
 * ?lang=fr|en&skin=<id>&case=done|live */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Routine, RoutineRun } from "../lib/routines";
import { openRoutineRun, StoreProvider, useStore, type Bot, type Message } from "../state/store";
import { DesktopCapabilitiesProvider } from "../components/DesktopCapabilities";
import { ChatView } from "../components/ChatView";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const say = (en: string, french: string) => (lang === "fr" ? french : en);
const live = params.get("case") === "live";

const M = 60_000;
const NOW = Date.now();
const start = NOW - (live ? 3 : 14) * M;
const NAME = say("Evening dispatch", "Répartition du soir");
const REPORT = say(
  "Evening pass done.\n\n- Ticket 4815 waits for its part.\n- Tickets 4812 and 4821 are assigned.\n\nNothing needs you tonight.",
  "Passe du soir faite.\n\n- Le billet 4815 attend sa pièce.\n- Les billets 4812 et 4821 sont assignés.\n\nRien ne t'attend ce soir.",
);
const SAID = [
  say("I'm reading the four tickets waiting on the evening board.", "Je lis les quatre billets qui attendent sur le tableau du soir."),
  say("Two of them have no technician. I'm checking who is free tonight.", "Deux d'entre eux n'ont pas de technicien. Je vérifie qui est libre ce soir."),
];

const routine = { id: "r-evening", botId: "atlas", name: NAME, prompt: say("Go through every board, reassign what waits, and tell me what needs a decision.", "Passe chaque tableau, réassigne ce qui attend et dis-moi ce qui demande une décision."),
  target: "bot", runOn: "maus", createdAt: 1, updatedAt: 1, enabled: true, schedule: { type: "cron", expression: "0 18 * * *", timeZone: "UTC" } } as unknown as Routine;
const run = { id: "run-evening", routineId: "r-evening", routineName: NAME, botId: "atlas", target: "bot", runOn: "maus", status: live ? "running" : "completed", manual: false,
  scheduledFor: start, createdAt: start, startedAt: start, ...(live ? {} : { finishedAt: start + 3 * M }), output: live ? SAID[1] : REPORT, threadId: "atlas-run", resultsThreadId: "t-atlas" } as unknown as RoutineRun;
const detail = { id: "run:run-evening", kind: "routine", botId: "atlas", title: NAME, status: live ? "running" : "finished", startedAt: start, updatedAt: NOW,
  ...(live ? {} : { endedAt: start + 3 * M }),
  steps: [
    { id: "s1", name: "Read", input: JSON.stringify({ file_path: "/srv/board/evening.json" }), ok: true, at: start + 8_000 },
    { id: "s2", name: "Bash", input: JSON.stringify({ command: "jq '.members[] | select(.free)' schedule.json" }), ok: true, at: start + 30_000 },
    { id: "s3", name: "Grep", input: JSON.stringify({ pattern: "4815", path: "parts" }), ok: true, at: start + 70_000 },
  ],
  stepsTruncated: false,
  said: [
    { id: "t1", text: SAID[0], at: start + 4_000 },
    { id: "t2", text: SAID[1], at: start + 50_000 },
    ...(live ? [] : [{ id: "t3", text: REPORT, at: start + 3 * M, final: true }]),
  ],
  files: [], children: [] };

const messages: Message[] = [
  { id: "m1", role: "user", kind: "text", at: NOW - 60 * M, text: say("Run the evening pass every weekday at six.", "Lance la passe du soir chaque jour de semaine à six heures.") },
  { id: "m2", role: "bot", kind: "text", at: NOW - 59 * M, text: say("Done: the routine runs every weekday at six.", "C'est fait : la routine roule chaque jour de semaine à six heures.") },
  { id: "m3", role: "bot", kind: "routine.run", at: start, text: NAME,
    routineRun: { runId: "run-evening", routineId: "r-evening", routineName: NAME, status: live ? "running" : "completed", executionThreadId: "atlas-run", startedAt: start, ...(live ? {} : { summary: REPORT, brief: REPORT }) } },
] as unknown as Message[];
const atlas = { id: "atlas", threadId: "t-atlas", mainThreadId: "t-atlas", name: "Atlas", title: say("Operations lead", "Chef des opérations"), description: "", notifications: true, color: "pink", unread: false,
  ownerUserId: "pr_me", modelSelection: { instanceId: "fake", model: "test" }, messages, tasks: [] } as unknown as Bot;

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const parsed = new URL(url, location.href);
  if (!parsed.pathname.startsWith("/api/")) return realFetch(input, init);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (parsed.pathname === "/api/bots") return json({ bots: [atlas], groups: [], sections: [], computerControl: {} });
  if (parsed.pathname === "/api/approvals") return json({ waiting: [] });
  if (parsed.pathname.endsWith("/activity/item")) return json({ item: detail });
  if (parsed.pathname === "/api/routines") return json({ routines: [routine], runs: [run] });
  if (parsed.pathname === "/api/config") return json({ profile: { name: "Alex", email: "alex@example.test" }, viewer: { principalId: "pr_me", role: "member" } });
  return json({ error: "gallery" }, 404);
}) as typeof window.fetch;
class SilentEventSource {
  onmessage = null;
  onerror = null;
  onopen = null;
  readyState = 0;
  constructor(readonly url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
(window as unknown as { EventSource: unknown }).EventSource = SilentEventSource;

function Chat() {
  const { state, dispatch } = useStore();
  const ready = state.hydrated && state.selectedId === "atlas";
  useEffect(() => {
    if (state.hydrated && state.selectedId !== "atlas") dispatch({ type: "select", id: "atlas" });
  }, [state.hydrated, state.selectedId, dispatch]);
  useEffect(() => {
    if (!ready) return;
    dispatch({ type: "routinesHydrated", routines: [routine], runs: [run] });
    // once the chat has drawn its lines, as a click on the run's card would
    const timer = window.setTimeout(() => openRoutineRun(dispatch, { runId: "run-evening", routineId: "r-evening" }), 600);
    return () => window.clearTimeout(timer);
  }, [ready, dispatch]);
  const one = state.bots.find((candidate) => candidate.id === "atlas");
  return (
    <div data-shot="chat" className="flex h-dvh bg-app text-ink">
      {one && ready ? <ChatView bot={one} /> : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><DesktopCapabilitiesProvider><Chat /></DesktopCapabilitiesProvider></StoreProvider>
  </StrictMode>,
);
