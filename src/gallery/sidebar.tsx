/** Isolated gallery for Playwright screenshots of the whole desktop sidebar
 * (bot rows, Primary Bot, sections, foot) beside the reference design's. Not shipped in
 * the app. It answers /api itself with a made-up team, so nothing reaches a
 * server. ?skin=<id>&lang=<code>&threads=one|header|sidebar&width=<px, 368>
 * &density=comfortable|compact&rooms=1 (a room and a person's conversation
 * beside the bots, for the row alignment check)
 * &sharing=1: an organization with bots shared by Ada and Bob (their faces on
 * the avatar), the viewer's own bot, working bots and two people with their
 * presence (the capture script serves /api/people/<id>/avatar).
 * &bulk=1: an organization where Atlas, Iris and Lina differ (model, works
 * on, Perspicax profiles) for Edit N bots; Lina's engine refuses a change
 * (scripts/capture/bulk-edit-bots.mjs). */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot, type Message, type Task } from "../state/store";
import { applyPresenceList } from "../lib/presence";
import { Sidebar } from "../components/Sidebar";
import { ConfirmProvider } from "../components/ConfirmProvider";
import { TaskPicker } from "../components/TaskPicker";
import { MASCOT_CHARACTERS, type MascotLook } from "../../shared/mascot-look";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
try {
  localStorage.setItem("sagax.interfaceMode.v1", "advanced");
  localStorage.setItem("sagax-sidebar-shortcuts", "1");
  localStorage.setItem("omb-sidebar-width-v2", params.get("width") ?? "368");
  if (params.get("rail") === "1") localStorage.setItem("openmausbot.sidebarDensity", "icons");
  localStorage.setItem("omb-threads-location", params.get("threads") === "sidebar" ? "sidebar" : "header");
  // Settings > Conversation threads: "one" is threads off
  localStorage.setItem("omb-show-threads", params.get("threads") === "one" ? "0" : "1");
  if (params.get("density") === "compact" || params.get("density") === "comfortable") localStorage.setItem("openmausbot.sidebarDensity", params.get("density")!);
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
    title: "Service Desk Ops", color: "pink", mascotBody: "squircle", section: "My team",
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

// ?unread=1: Iris and Lina have a reply waiting (the row's unread dot)
if (params.get("unread") === "1") {
  for (const name of ["iris", "lina"]) {
    const row = team.find((entry) => entry.id === name)!;
    row.unread = true;
    row.messages = [message(`${name}-u`, "Peux-tu vérifier ça?", minutes(20), "user"), message(`${name}-1`, "Oui, je regarde.", minutes(10)), ...row.messages.slice(-1)];
    row.tasks = [{ ...row.tasks![0]!, unread: true }];
  }
}

const sharing = params.get("sharing") === "1";
if (sharing) {
  team.length = 0;
  team.push(
    bot("atlas", "Atlas", { title: "Service Desk Ops", color: "pink", mascotBody: "squircle", ownerUserId: "pr_me", busy: true, tasks: [task("t-atlas", "Général", minutes(2), { busy: true })] }, "Je prépare le rapport mensuel.", minutes(2)),
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
if (params.get("rooms") === "1") dmGroups.push(
  { id: "room-ops", threadId: "room-ops-t", name: "Ops", memberIds: ["atlas", "iris"], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: minutes(700),
    messages: [message("r1", "Le plan de la semaine est prêt.", minutes(15))],
    tasks: [task("room-ops-t", "Général", minutes(15)), task("room-ops-2", "Suivi des billets", minutes(60))] } as never,
  { id: "dm-sam", threadId: "dm-sam-t", name: "Sam", memberIds: [], peopleDm: true, humanIds: ["pr_me", "pr_sam"], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: minutes(800),
    messages: [message("dm3", "Parfait, merci.", minutes(35))] } as never,
);

const bulk = params.get("bulk") === "1";
if (bulk) {
  const set = (id: string, extra: Partial<Bot>) => Object.assign(team.find((entry) => entry.id === id)!, { ownerUserId: "pr_me", ...extra });
  set("atlas", { computer: "local", modelSelection: { instanceId: "claude", model: "claude-sonnet" }, grants: [{ target: "user:pr_ada", level: "use", by: "pr_me", at: 0 }] });
  set("iris", { computer: "cloud", modelSelection: { instanceId: "claude", model: "claude-opus" }, grants: [{ target: "user:pr_ada", level: "use", by: "pr_me", at: 0 }] });
  set("lina", { modelSelection: { instanceId: "grok", model: "grok-4" }, grants: [{ target: "user:pr_ada", level: "use", by: "pr_me", at: 0 }, { target: "user:pr_bob", level: "edit", by: "pr_me", at: 0 }] });
  for (const member of team) member.ownerUserId ??= "pr_me";
}
// ?character=<id> dresses the whole team as that mascot (shape, frog...)
const characterParam = params.get("character");
if (characterParam && (MASCOT_CHARACTERS as readonly string[]).includes(characterParam)) {
  const look = { character: characterParam } as MascotLook;
  for (const member of team) member.mascotLook = look;
}

// ?threadlist=1: Atlas holds a long list of threads, some opened by a bot,
// for the thread menu over a scrolled list and the nested row indent
// (scripts/capture/sidebar-thread-list.mjs, 2026-11-04)
if (params.get("threadlist") === "1") {
  const atlas = team.find((entry) => entry.id === "atlas");
  const titles = ["Fetch Outlook messages for review", "Can you update this routine so it runs at noon", "Archive Outlook folders older than a year", "Mail client", "Fetch exact Outlook counts by folder", "Fetch exact Outlook senders", "Fetch exact Outlook threads", "Quarterly ticket report", "Printer queue cleanup", "License renewal summary", "Backup check for the file server", "Weekly status note"];
  if (atlas) atlas.tasks = [task("t-atlas", "Général", minutes(8)), ...titles.map((title, i) => task(`t-atlas-l${i}`, title, minutes(20 + i * 40),
    i % 3 === 1 ? {} : { openedBy: { botId: "atlas", name: "Atlas", at: minutes(20 + i * 40) } }))];
}

// ?flood=1: Atlas as a busy bot's record reads on a live server (unified
// chat, 2026-11-05): a few conversations of the person among dozens of
// threads it opened on itself, teammates' "@Iris · work" hand-offs, an AI
// client's send_prompt conversations and routine runs
// (scripts/capture/background-threads.mjs).
if (params.get("flood") === "1") {
  const atlas = team.find((entry) => entry.id === "atlas");
  const iris = team.find((entry) => entry.id === "iris");
  if (atlas && iris) {
    const own = ["Général", "Rapport mensuel des billets", "Migration Exchange"].map((title, i) => task(i ? `t-atlas-own${i}` : "t-atlas", title, minutes(8 + i * 90), i === 0 ? {} : { personWrote: true }));
    const selfOpened = ["Fetch exact Outlook webhook message", "Read Outlook webhook email", "Fetch Outlook webhook email", "Read webhook Outlook message", "Silent Outlook seat-upgrade check", "Facturation watch (read-only)", "Archive Outlook message", "Read-only Outlook rehearsal"]
      .flatMap((title, i) => [0, 1, 2].map((n) => task(`t-atlas-self${i}-${n}`, title, minutes(15 + (i * 3 + n) * 25), { openedBy: { botId: "atlas", name: "Atlas", at: minutes(15 + (i * 3 + n) * 25) } })));
    const work = Array.from({ length: 6 }, (_, i) => task(`t-atlas-work${i}`, "@Iris · work", minutes(12 + i * 55), { openedBy: { botId: "iris", name: "Iris", kind: "work", at: minutes(12 + i * 55) } }));
    const agent = Array.from({ length: 3 }, (_, i) => task(`t-atlas-agent${i}`, `Résumé Outlook ${i + 1}`, minutes(30 + i * 70), { openedBy: { botId: "agent:claude", name: "Claude", kind: "agent", at: minutes(30 + i * 70) } }));
    const runs = Array.from({ length: 10 }, (_, i) => task(`t-atlas-run${i}`, "Veille facturation", minutes(5 + i * 60), { routineRunId: `run-${i}` }));
    atlas.tasks = [...own, ...selfOpened, ...work, ...agent, ...runs];
    iris.tasks = [task("t-iris", "Général", minutes(42)), ...Array.from({ length: 5 }, (_, i) => task(`t-iris-work${i}`, "@Atlas · work", minutes(20 + i * 50), { openedBy: { botId: "atlas", name: "Atlas", kind: "work", at: minutes(20 + i * 50) } }))];
  }
}

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
  if (bulk) {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const one = /^\/api\/bots\/([\w-]+)(\/.*)?$/.exec(path);
    const target = one ? team.find((entry) => entry.id === one[1]) : undefined;
    if (path === "/api/org") return json({ org: { identity: { kind: "perspicax" }, name: "Organisation" } });
    if (path === "/api/org/directory") return json({ people: [
      { principalId: "pr_ada", name: "Ada Lovelace", login: "ada", role: "member", disabled: false },
      { principalId: "pr_bob", name: "Bob Martin", login: "bob", role: "member", disabled: false },
    ], teams: [] });
    if (path === "/api/instances") return json({ instances: [
      { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription", snapshot: { state: "available", authenticated: true }, models: { options: [{ id: "claude-sonnet", label: "Sonnet" }, { id: "claude-opus", label: "Opus" }] } },
      { instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", access: "subscription", snapshot: { state: "available", authenticated: true }, models: { options: [{ id: "grok-4", label: "Grok 4" }] } },
    ] });
    if (path === "/api/mcp/servers") return json({ servers: [{ name: "github", enabled: true }, { name: "filesystem", enabled: true }] });
    if (target && one![2] === undefined && method === "PATCH") {
      // Lina's engine is not available to take the change
      if (target.id === "lina" && body.computer !== undefined) return json({ error: "Grok n'est pas disponible pour ce Bot : reconnectez le moteur." }, 409);
      Object.assign(target, body);
      return json({ bot: target });
    }
    if (target && one![2]?.startsWith("/grants")) return json({ grants: target.grants ?? [], administer: { any: true, teamIds: [], maxLevel: "manage", canAdd: true } });
  }
  if (sharing && path === "/api/org") return json({ org: { identity: { kind: "perspicax" }, name: "GOX" } });
  if (sharing && path === "/api/org/directory") return json({ people: [
    { principalId: "pr_ada", name: "Ada Lovelace", login: "ada", role: "member", disabled: false, avatarUrl: "/api/people/pr_ada/avatar" },
    { principalId: "pr_bob", name: "Bob Martin", login: "bob", role: "member", disabled: false },
  ] });
  if (path === "/api/code/status") return json({ available: true });
  if (path === "/api/config") return json({ profile: { name: "Alex Gagnon" }, ...(sharing || bulk || params.get("org") === "1" ? { viewer: { principalId: "pr_me" } } : {}) });
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

function HeaderThreads() {
  const { state } = useStore();
  const atlas = state.bots.find((candidate) => candidate.id === "atlas");
  return atlas ? <TaskPicker bot={atlas} /> : null;
}

function Gallery() {
  return (
    <StoreProvider>
      <SelectAtlas />
      <div className="flex">
        <div data-gallery className={`flex h-[1015px] ${params.get("rail") === "1" ? "w-[80px]" : "w-[368px]"} overflow-hidden bg-app text-ink`}>
          <ConfirmProvider><Sidebar open onClose={() => {}} /></ConfirmProvider>
        </div>
        {/* the chat header's thread control, for the mode captures */}
        <div data-gallery-header className="flex h-[52px] w-[360px] items-center gap-2 border-b border-hairline/40 bg-app px-4 text-ink">
          <span className="text-[13px] font-medium">Atlas</span>
          <HeaderThreads />
        </div>
      </div>
    </StoreProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
