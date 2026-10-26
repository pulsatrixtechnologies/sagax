/** Isolated gallery for Playwright screenshots of the whole desktop sidebar
 * (bot rows, Primary Bot, sections, foot) beside Grok Bot's. Not shipped in
 * the app. It answers /api itself with a made-up team, so nothing reaches a
 * server. ?skin=<id>&lang=<code>&threads=header|sidebar&width=<px, 368>
 * &sharing=1: an organization with bots shared by Ada and Bob (their faces on
 * the avatar), the viewer's own bot, working bots and two people with their
 * presence (the capture script serves /api/people/<id>/avatar). */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message, type Task } from "../state/store";
import { applyPresenceList } from "../lib/presence";
import { Sidebar } from "../components/Sidebar";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
try {
  localStorage.setItem("sagax.interfaceMode.v1", "advanced");
  localStorage.setItem("sagax-sidebar-shortcuts", "1");
  localStorage.setItem("omb-sidebar-width-v2", params.get("width") ?? "368");
  if (params.get("rail") === "1") localStorage.setItem("openmausbot.sidebarDensity", "icons");
  localStorage.setItem("omb-threads-location", params.get("threads") === "sidebar" ? "sidebar" : "header");
} catch {
  // the gallery still renders with the defaults
}

const now = Date.now();
const minutes = (n: number) => now - n * 60_000;
const message = (id: string, text: string, at: number, role: Message["role"] = "bot"): Message =>
  ({ id, role, kind: "text", text, at } as Message);
const task = (threadId: string, title: string, at: number, extra: Partial<Task> = {}): Task =>
  ({ threadId, title, createdAt: at, updatedAt: at, ...extra });

const bot = (id: string, name: string, extra: Partial<Bot>, last: string, at: number): Bot => ({
  id, threadId: `t-${id}`, name, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" },
  messages: [message(`m-${id}`, last, at)],
  tasks: [task(`t-${id}`, "Général", at)],
  ...extra,
} as Bot);

const team: Bot[] = [
  bot("nova", "Nova", { chiefOfStaff: true, title: "Chef de cabinet", color: "green", mascotBody: "squircle", pinned: true }, "Je coordonne la semaine avec l'équipe.", minutes(4)),
  bot("atlas", "Atlas", {
    title: "ConnectWise Ops & MS 365", color: "pink", mascotBody: "squircle", section: "My team",
    tasks: [
      task("t-atlas", "Général", minutes(8)),
      task("t-atlas-2", "Rapport mensuel des billets", minutes(30), { unread: true }),
      task("t-atlas-3", "Migration Exchange", minutes(95), { unread: true }),
    ],
  }, "J'ai supprimé le flux Power Automate « Nouveau courriel » comme demandé.", minutes(8)),
  bot("iris", "Iris", { title: "Full Stack, Dev Ops & ITSec", color: "orange", mascotBody: "drop", section: "My team" }, "J'ai fait le ménage de ma mémoire et gardé les règles actives.", minutes(42)),
  bot("milo", "Milo", {
    title: "Vérification", color: "teal", mascotBody: "blob", section: "My team",
    // two conversations waiting on the person: the Approvals count
    tasks: [
      task("t-milo", "Général", minutes(70), { activity: "waiting-on-you" } as Partial<Task>),
      task("t-milo-2", "Règle permanente", minutes(80), { activity: "waiting-on-you" } as Partial<Task>),
    ],
  }, "J'ai noté cette règle permanente. Une seule question avant de fermer.", minutes(70)),
  bot("lina", "Lina", { title: "Juridique et marketing", color: "purple", mascotBody: "circle", section: "My team" }, "Les deux sont supprimées, il ne me reste aucune routine.", minutes(130)),
  bot("forge", "Concepteur de bots", {
    color: "graphite", mascotBody: "capsule",
    installedPackage: { id: "designer", name: "Concepteur", release: "1.0.0", requiredApps: [], source: "org" },
  }, "J'ai envoyé la règle aux 7 bots et je l'ai aussi notée.", minutes(200)),
  bot("veille", "Veille", {
    title: "Veille technologique", color: "blue", mascotBody: "capsule",
    installedPackage: { id: "veille", name: "Veille", release: "1.0.0", requiredApps: [], source: "org" },
  }, "Trois avis de sécurité à lire ce matin.", minutes(320)),
];

const sharing = params.get("sharing") === "1";
if (sharing) {
  team.length = 0;
  team.push(
    bot("atlas", "Atlas", { title: "ConnectWise Ops", color: "pink", mascotBody: "squircle", ownerUserId: "pr_me", busy: true, tasks: [task("t-atlas", "Général", minutes(2), { busy: true })] }, "Je prépare le rapport mensuel.", minutes(2)),
    bot("iris", "Iris", { title: "Full Stack, Dev Ops & ITSec", color: "orange", mascotBody: "drop", ownerUserId: "pr_me" }, "Rien à signaler.", minutes(40)),
    bot("support", "Ada Support", { title: "Service desk", color: "blue", mascotBody: "circle", ownerUserId: "pr_ada" }, "Le billet 4821 est fermé.", minutes(12)),
    bot("reports", "Rapports financiers trimestriels de la direction", { title: "Finance", color: "purple", mascotBody: "capsule", ownerUserId: "pr_bob", busy: true, tasks: [task("t-reports", "Général", minutes(1), { busy: true })] }, "Je compile les chiffres du trimestre.", minutes(1)),
    bot("legal", "Juridique", { color: "teal", mascotBody: "blob", ownerUserId: "pr_ada", activity: "waiting-on-you", tasks: [task("t-legal", "Général", minutes(9), { activity: "waiting-on-you" } as Partial<Task>)] }, "Une question avant de continuer.", minutes(9)),
  );
}
const dmGroups = sharing ? [
  { id: "dm-ada", threadId: "dm-ada-t", name: "Ada", memberIds: [], peopleDm: true, humanIds: ["pr_me", "pr_ada"], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: minutes(500), messages: [message("dm1", "On se parle demain.", minutes(20))] },
  { id: "dm-bob", threadId: "dm-bob-t", name: "Bob", memberIds: [], peopleDm: true, humanIds: ["pr_me", "pr_bob"], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: minutes(600), messages: [message("dm2", "Merci!", minutes(90))] },
] : [];

// ?character=<id> dresses the whole team as that mascot (shape, frog...)
const characterParam = params.get("character");
if (characterParam) for (const member of team) (member as Bot & { mascotLook?: unknown }).mascotLook = { character: characterParam };

// ?many=N adds N pinned bots, to check the rail's vertical scroll
for (let i = 0; i < Number(params.get("many") ?? 0); i += 1) {
  team.push(bot(`extra${i}`, `Bot ${i + 1}`, { color: "blue", mascotBody: "circle", pinned: true }, "Bonjour.", minutes(400 + i)));
}

// Answer the app's /api calls here: the made-up team, a profile, and an
// empty answer for everything else.
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, location.href).pathname;
  if (!path.startsWith("/api/")) return realFetch(input, init);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (path === "/api/bots") return json({ bots: team, groups: dmGroups, sections: ["My team"], computerControl: {} });
  if (sharing && path === "/api/org") return json({ org: { identity: { kind: "perspicax" }, name: "GOX" } });
  if (sharing && path === "/api/org/directory") return json({ people: [
    { principalId: "pr_ada", name: "Ada Lovelace", login: "ada", role: "member", disabled: false, avatarUrl: "/api/people/pr_ada/avatar" },
    { principalId: "pr_bob", name: "Bob Martin", login: "bob", role: "member", disabled: false },
  ] });
  if (path === "/api/code/status") return json({ available: true });
  if (path === "/api/config") return json({ profile: { name: "Alex Gagnon" }, ...(sharing ? { viewer: { principalId: "pr_me" } } : {}) });
  // the avatar menu's Usage › (a made-up plan, this month's cost)
  if (path === "/api/plan-usage") return json({ providers: [{
    id: "claude", name: "Claude", driver: "claude", plan: "Max", ok: true, error: null, state: "windows", access: "subscription",
    weekly: { available: true, usedPercent: 64, remainingPercent: 36, resetsAt: new Date(Date.now() + 2.2 * 86_400_000).toISOString() },
    fiveHour: { available: true, usedPercent: 18, remainingPercent: 82, resetsAt: new Date(Date.now() + 3 * 3_600_000).toISOString() },
  }] });
  if (path === "/api/me/usage") return json({ groups: [], total: { key: "total", label: "Total", turns: 212, costUsd: 48.27 } });
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

if (sharing) applyPresenceList([
  { principalId: "pr_ada", state: "online", lastSeenAt: Date.now() },
  { principalId: "pr_bob", state: "away", lastSeenAt: Date.now() - 600_000 },
]);

function SelectAtlas() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    if (state.hydrated && state.selectedId !== "atlas") dispatch({ type: "select", id: "atlas" });
  }, [state.hydrated, state.selectedId, dispatch]);
  return null;
}

function Gallery() {
  return (
    <StoreProvider>
      <SelectAtlas />
      <div data-gallery className={`flex h-[1015px] ${params.get("rail") === "1" ? "w-[80px]" : "w-[368px]"} overflow-hidden bg-app text-ink`}>
        <Sidebar open onClose={() => {}} />
      </div>
    </StoreProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
