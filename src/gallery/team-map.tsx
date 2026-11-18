/** Isolated gallery for headless screenshots of the Team map page (the org
 * chart). Neutral fictional bots and teams; a mocked fetch answers the page's
 * reads so nothing connects. Not shipped in the app.
 * ?width=<px>&height=<px>&lang=<code>&skin=<id>&bots=24|60&dialog=computers */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { TeamMapPage } from "../components/TeamMapPage";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type AppState, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const width = Number(params.get("width") ?? 1480);
const height = Number(params.get("height") ?? 900);
const count = Number(params.get("bots") ?? 24);

const COLORS = ["blue", "green", "purple", "orange", "teal", "red", "cyan", "pink", "amber", "coral", "yellow"];
const bot = (id: string, name: string, title: string, section: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title, description: "", color: COLORS[(name.charCodeAt(0) + name.length) % COLORS.length], notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: ["Sonnet 5.5", "Haiku 4.5", "Opus 4", "GPT-5"][name.length % 4] }, tasks: [{ threadId: `${id}-thread`, title: "Chat", createdAt: 1 }], section, ...extra,
} as unknown as Bot);

// 24 bots: a lead and five teams, plus a few unassigned.
const small: Bot[] = [
  bot("atlas", "Atlas", "Chief of staff", "My team", { chiefOfStaff: true }),
  bot("boreas", "Boreas", "Dispatch", "My team", { activity: "working", busy: true }), bot("cirrus", "Cirrus", "Projects", "My team"), bot("delta", "Delta", "Security", "My team", { activity: "waiting-on-you" }),
  bot("echo", "Echo", "Triage", "Service desk", { activity: "working", busy: true }), bot("fjord", "Fjord", "Escalations", "Service desk", { activity: "waiting-on-you" }), bot("gale", "Gale", "Knowledge base", "Service desk"),
  bot("harbor", "Harbor", "Onboarding", "Service desk"), bot("iris", "Iris", "Reporting", "Service desk"),
  bot("juno", "Juno", "Billing", "Finance", { activity: "working", busy: true }), bot("kestrel", "Kestrel", "Collections", "Finance"), bot("lumen", "Lumen", "Contracts", "Finance", { activity: "waiting-on-you" }), bot("mica", "Mica", "Renewals", "Finance"),
  bot("nova", "Nova", "Scheduling", "Field ops", { activity: "working", busy: true }), bot("pike", "Pike", "Site visits", "Field ops"), bot("onyx", "Onyx", "Inventory", "Field ops"),
  bot("quill", "Quill", "Documentation", "Research and docs"), bot("rune", "Rune", "Research", "Research and docs"), bot("sage", "Sage", "Newsletter", "Research and docs"),
  bot("tide", "Tide", "Backups", ""), bot("umber", "Umber", "Licenses", ""), bot("vega", "Vega", "Alerts", "", { activity: "working", busy: true }), bot("wren", "Wren", "Procurement", ""), bot("xeno", "Xeno", "Experiments", ""),
];
const smallPairs: Array<[string, string, number, boolean, string?]> = [
  ["atlas", "boreas", 12, false], ["atlas", "cirrus", 8, false], ["atlas", "juno", 5, false], ["atlas", "nova", 4, false], ["boreas", "echo", 9, false], ["echo", "fjord", 6, false],
  ["fjord", "gale", 4, true], ["delta", "cirrus", 3, true], ["juno", "kestrel", 14, false], ["lumen", "mica", 5, false], ["nova", "pike", 7, false],
];

// 60 bots: a lead and eleven teams of about five, with a web of handoffs.
const TEAM_NAMES = ["My team", "Service desk", "Finance", "Field ops", "Projects office", "Security", "Sales", "Procurement", "People", "Legal", "Data", "Marketing"];
const ROLES = ["Triage", "Billing", "Reports", "Planning", "Review", "Intake", "Follow-up", "Audit", "Research", "Quotes", "Support", "Docs"];
const NAMES = ["Aria", "Bram", "Cleo", "Dax", "Elio", "Faye", "Gus", "Hana", "Ivo", "Jade", "Kai", "Lena", "Milo", "Nina", "Otto", "Pia", "Quin", "Remy", "Sol", "Tess", "Uma", "Vik", "Wes", "Xia", "Yan", "Zed", "Abel", "Bea", "Cyrus", "Dina", "Emil", "Fern", "Gia", "Hugo", "Isla", "Jun", "Kira", "Leo", "Maya", "Noor", "Owen", "Pria", "Rhea", "Seth", "Tara", "Ugo", "Vera", "Wade", "Yara", "Zoe", "Ansel", "Brie", "Cato", "Dara", "Ezra", "Flo", "Gwen", "Hale", "Ines"];
function large(): { bots: Bot[]; pairs: Array<[string, string, number, boolean]> } {
  const bots: Bot[] = [bot("lead", "Atlas", "Chief of staff", "My team", { chiefOfStaff: true })];
  const pairs: Array<[string, string, number, boolean]> = [];
  let n = 0;
  const teamBots: string[][] = TEAM_NAMES.map(() => []);
  while (bots.length < 54) {
    const team = n % 11;
    const id = `b${n}`;
    const activity = n % 7 === 0 ? "working" : n % 11 === 0 ? "waiting-on-you" : undefined;
    bots.push(bot(id, NAMES[n % NAMES.length], ROLES[(n * 5) % ROLES.length], TEAM_NAMES[team], activity ? { activity: activity as never, busy: activity === "working" } : {}));
    teamBots[team].push(id);
    n += 1;
  }
  for (let i = 0; i < 6; i += 1) bots.push(bot(`u${i}`, NAMES[(54 + i) % NAMES.length], ROLES[(i * 3) % ROLES.length], ""));
  teamBots[0].push("lead");
  const first = (team: number, k = 0) => teamBots[team][Math.min(k, teamBots[team].length - 1)];
  [1, 2, 3, 4, 0].forEach((team, i) => pairs.push(["lead", first(team, i), 20 - i * 3, false]));
  pairs.push(["lead", first(5), 6, false], ["lead", first(6), 4, false]);
  [[1, 7, 9], [2, 8, 7], [3, 9, 5], [4, 10, 6], [5, 10, 3], [6, 7, 4]].forEach(([from, to, c]) => pairs.push([first(from, 1), first(to, 0), c, false]));
  for (const team of [1, 2, 3, 4, 5]) for (let k = 0; k + 1 < Math.min(4, teamBots[team].length); k += 1) pairs.push([first(team, k), first(team, k + 1), 3 + ((team + k) % 9), k === 2]);
  return { bots, pairs };
}

const data = count > 30 ? large() : { bots: small, pairs: smallPairs };
const sections = [...new Set(data.bots.map((item) => item.section ?? "").filter(Boolean))];
const state: AppState = { ...initialState, bots: data.bots, sections } as AppState;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
const NOW = Date.now();
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/team-map")) {
    return json({
      handoffs: data.pairs.map(([from, to, countOf, review], index) => ({ sourceBotId: from, targetBotId: to, count: countOf, kind: review ? "reviews" : "delegates", lastAt: NOW - (index === 0 ? 120_000 : index === 4 ? 60_000 : index * 1_700_000) })),
      collaborations: [], queued: [{ sourceBotId: "echo", targetBotId: "fjord", reason: "Escalate the backup failure" }],
      running: [{ sourceBotId: "atlas", targetBotId: "boreas", threadId: "boreas-thread" }, { sourceBotId: "boreas", targetBotId: "echo", threadId: "echo-thread" }, { sourceBotId: "juno", targetBotId: "kestrel", threadId: "kestrel-thread" }],
    });
  }
  if (url.includes("/api/auth/session")) return json({ kind: "session", id: "s", label: "Mac", scopes: ["client", "admin"], expiresAt: 1 });
  if (url.includes("/api/remote-hosts")) return json({ available: true, hosts: [] });
  if (url.includes("/api/team-computers")) return json({ computers: [] });
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};

function OpenComputers() {
  useEffect(() => {
    if (params.get("dialog") !== "computers") return;
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>("[data-team-map-computers]")?.click(), 300);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
const mobile = width < 640;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={value}>
      <div data-gallery-sample="team-map" className="flex overflow-hidden bg-app text-ink" style={{ width, height }}>
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
          <TeamMapPage /><OpenComputers />
        </div>
      </div>
    </BotEditorStore>
    {mobile && null}
  </StrictMode>,
);
