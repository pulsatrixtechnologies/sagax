/** Isolated gallery for headless captures of a group chat whose header pill
 * floats over the transcript (Grok Bot style): the messages scroll under the
 * pill, and a long group name ends in an ellipsis with the chevron kept.
 * Answers /api itself with made-up people and bots; nothing reaches a
 * server. Not shipped in the app. ?skin=<id>&lang=<code>&long=1 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import { DesktopCapabilitiesProvider } from "../components/DesktopCapabilities";
import { GroupView } from "../components/GroupView";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const owner = true;
const longName = params.get("long") === "1";

const bot = (id: string, name: string, color: string, ownerUserId: string, title = ""): Bot =>
  ({ id, threadId: `t-${id}`, name, title, description: "", notifications: true, color, unread: false, ownerUserId, modelSelection: { instanceId: "fake", model: "test" }, messages: [], tasks: [] }) as unknown as Bot;

const team: Bot[] = [
  bot("atlas", "Atlas", "pink", "pr_me", "Service desk"),
  bot("iris", "Iris", "orange", "pr_me", "Dev Ops"),
  bot("milo", "Milo", "teal", "pr_me", "Vérification"),
  bot("support", "Ada Support", "blue", "pr_ada", "Service desk"),
  bot("legal", "Juridique", "purple", "pr_ada"),
];
const at = Date.UTC(2026, 10, 6, 13, 0);
const roomMessages = Array.from({ length: 12 }, (_, i) => [
  { id: `u${i}`, role: "user", kind: "text", text: `Question ${i + 1} : où en est le suivi des billets ouverts cette semaine ?`, at: at + i * 120_000 },
  { id: `b${i}`, role: "bot", kind: "text", from: { botId: i % 2 ? "atlas" : "support", name: i % 2 ? "Atlas" : "Ada Support" }, text: `Réponse ${i + 1} : ${i + 3} billets restent ouverts, dont un en attente du client. Le reste est planifié pour demain matin.`, at: at + i * 120_000 + 60_000 },
]).flat();
const group = {
  id: "ops", threadId: "t-ops", name: longName ? "Ada Lovelace, Bob Martin, Cléo Tremblay et Atlas" : "Opérations", bulletin: "Chacun répond à son tour.", unread: false, createdAt: Date.now(),
  memberIds: ["support", "atlas"], humanIds: owner ? ["pr_me", "pr_ada"] : ["pr_ada", "pr_me"], ownerId: owner ? "pr_me" : "pr_ada",
  defaultResponder: { kind: "auto" }, messages: roomMessages, tasks: [],
};

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  if (!path.startsWith("/api/")) return realFetch(input, init);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (path === "/api/bots") return json({ bots: team, groups: [group], sections: [], computerControl: {} });
  if (path === "/api/org") return json({ org: { identity: { kind: "perspicax" }, name: "Example" }, link: { state: "ok" }, viewerRole: "member", settings: {} });
  if (path === "/api/org/directory") return json({ people: [
    { principalId: "pr_me", name: "Alex Gagnon", login: "alex", role: "member", disabled: false },
    { principalId: "pr_ada", name: "Ada Lovelace", login: "ada", role: "member", disabled: false },
    { principalId: "pr_bob", name: "Bob Martin", login: "bob", role: "member", disabled: false },
    { principalId: "pr_cleo", name: "Cléo Tremblay", login: "cleo", role: "member", disabled: false },
  ], teams: [] });
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

function Room() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    if (state.hydrated && state.selectedId !== "ops") dispatch({ type: "select", id: "ops" });
  }, [state.hydrated, state.selectedId, dispatch]);
  const room = state.groups.find((g) => g.id === "ops");
  return <div className="flex h-dvh bg-app text-ink">{room ? <GroupView group={room} /> : null}</div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider><DesktopCapabilitiesProvider><Room /></DesktopCapabilitiesProvider></StoreProvider>
  </StrictMode>,
);
