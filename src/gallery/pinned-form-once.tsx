/** Isolated gallery for headless captures of a bot's 1:1 chat while a form
 * waits on the person: the pending question is drawn once, on the pinned
 * card over the composer; the conversation keeps a compact history line.
 * ?case=widget (a routine run's widget form) | checklist (a question card
 * with checkbox rows and two actions) | settled (the checklist, answered).
 * Answers /api itself with made-up data; nothing reaches a server. Not
 * shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message } from "../state/store";
import { DesktopCapabilitiesProvider } from "../components/DesktopCapabilities";
import { ChatView } from "../components/ChatView";
import { parseWidgetInput } from "../../shared/widget";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const which = params.get("case") ?? "widget";

const from = { botId: "atlas", name: "Atlas", color: "pink" };
const at = Date.now() - 3_600_000;
const drafts = ["Reply to @alice about the release", "Reply to @bob on pricing", "Post: shipping notes for 2.4", "Post: weekly recap", "Reply to @carol", "Post: three tips for new users"];
const person = { id: "u1", role: "user", kind: "text", at, text: "Prepare tonight's drafts for the account." } as unknown as Message;
const words = { id: "b1", role: "bot", kind: "text", at: at + 1_000, from, text: "Six drafts are ready for tonight." } as unknown as Message;

const tree = parseWidgetInput({
  type: "Card", title: "Tonight on @handle", caption: "Six drafts are ready. Uncheck any you do not want posted.",
  children: drafts.map((label, index) => ({ type: "Checkbox", name: `d${index}`, label, defaultChecked: true })),
  confirm: { label: "Post selected", action: { type: "drafts.post" } },
  cancel: { label: "Skip tonight", action: { type: "drafts.skip" } },
});
if (!tree.ok) throw new Error(tree.error);
const widget = { id: "w1", role: "bot", kind: "widget", at: at + 2_000, from, text: "Tonight on @handle", widget: { v: 1, root: tree.value } } as unknown as Message;
const run = { id: "run1", role: "bot", kind: "routine.run", at: at + 2_001, from, text: "X daily post and reply drafts",
  routineRun: { runId: "r1", routineId: "rt1", routineName: "X daily post and reply drafts", status: "completed", executionThreadId: "x", summary: "Six drafts are ready.", widgetId: "w1" } } as unknown as Message;
const checklist = (settled: boolean) => ({
  id: "q1", role: "bot", kind: "options", at: at + 2_000, from, text: "",
  card: { title: "Tonight on @handle", subtitle: "Six drafts are ready.", options: [], requestId: "req-q1", requestType: "question", noHold: true,
    ...(settled ? { answered: "answer", answeredText: "Post selected: 5 of 6" } : {}),
    questionRequest: { version: 1, questions: [{ question: "Six drafts are ready. Uncheck any you do not want posted.", kind: "multi", multiSelect: true, options: drafts.map((label) => ({ label })), checked: drafts, actions: ["Post selected", "Skip tonight"] }] } },
}) as unknown as Message;

const messages: Message[] = which === "widget" ? [person, words, widget, run] : [person, words, checklist(which === "settled")];
const waiting = which === "widget"
  ? [{ id: "form:w1", kind: "form", botId: "atlas", botName: "Atlas", threadId: "t-atlas", messageId: "w1", at: widget.at, ageMs: 0, title: "Tonight on @handle", text: "Tonight on @handle", options: [], answerWith: "text", freeText: true, skippable: true, routineName: "X daily post and reply drafts", message: widget }]
  : which === "checklist"
    ? [{ id: "req-q1", kind: "question", botId: "atlas", botName: "Atlas", threadId: "t-atlas", messageId: "q1", at: at + 2_000, ageMs: 0, title: "", text: "", options: [], answerWith: "option", freeText: false, skippable: true, message: checklist(false) }]
    : [];

const team = [{ id: "atlas", threadId: "t-atlas", name: "Atlas", title: "Social", description: "", notifications: true, color: "pink", unread: false, modelSelection: { instanceId: "fake", model: "test" }, messages, tasks: [] }] as unknown as Bot[];

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  if (!path.startsWith("/api/")) return realFetch(input, init);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (path === "/api/bots") return json({ bots: team, groups: [], sections: [], computerControl: {} });
  if (path === "/api/approvals" && url.includes("waiting=1")) return json({ waiting });
  if (path === "/api/org") return json({ org: { identity: { kind: "perspicax" }, name: "Example" }, link: { state: "ok" }, viewerRole: "member", settings: {} });
  if (path === "/api/config") return json({ profile: { name: "Alex Gagnon", email: "alex@example.test" }, viewer: { principalId: "pr_me", role: "member" } });
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
  useEffect(() => {
    if (state.hydrated && state.selectedId !== "atlas") dispatch({ type: "select", id: "atlas" });
  }, [state.hydrated, state.selectedId, dispatch]);
  const one = state.bots.find((b) => b.id === "atlas");
  return <div className="flex h-dvh bg-app text-ink">{one && state.selectedId === "atlas" ? <ChatView bot={one} /> : null}</div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><DesktopCapabilitiesProvider><Chat /></DesktopCapabilitiesProvider></StoreProvider>
  </StrictMode>,
);
