/** Headless gallery for Tools > Memory > Map > Graph (2026-11-03). Synthetic data only.
 * ?skin=<id>&lang=<code>&n=<notes>&width=&height=&settings=1
 * teams=<N> adds N data-built teams; rail=1 puts the Memory explorer's right rail beside the map (from 1280px, as the app does); side=<px> is the app sidebar's width.
 * n: how many notes (the perf check uses 1200); settings=1 opens the Graph
 * settings card with every section unfolded.
 */
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";

import { RightRailPanel } from "../components/RightRail";
import { MemoryMapView } from "../components/memory-manager/MemoryMapView";
import { loadLocale } from "../lib/i18n";
import { seededRandom } from "../lib/memory-graph";
import { DEFAULT_GRAPH_SETTINGS, MEMORY_GRAPH_PREF_KEY } from "../lib/memory-graph-settings";
import type { MemoryManagerSource } from "../lib/memory-manager";
import { tierColor, type PageRow, type PageTier } from "../lib/memory-page";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.34", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const total = Math.max(1, Number(params.get("n") ?? 360));
const width = Number(params.get("width") ?? 1440);
const height = Number(params.get("height") ?? 900);
try {
  localStorage.setItem(MEMORY_GRAPH_PREF_KEY, JSON.stringify({ local: {
    ...DEFAULT_GRAPH_SETTINGS,
    open: params.get("settings") === "1",
    sections: params.get("settings") === "1" ? { filters: true, groups: true, display: true, forces: true } : DEFAULT_GRAPH_SETTINGS.sections,
    groups: params.get("settings") === "1" ? [{ query: "tag:#urgent", color: "#e5484d" }] : [],
  } }));
} catch { /* storage refused: defaults */ }

const teamCount = Number(params.get("teams") ?? 0);
const tiers: PageTier[] = teamCount > 0 ? [
  { key: "mine", name: "My memory", kind: "mine", color: tierColor("mine") },
  { key: "team:general", name: "Facts my bots learned", kind: "team", fixed: true, color: tierColor("team", 9) },
  { key: "org", name: "Organization", kind: "org", color: tierColor("org") },
  ...Array.from({ length: teamCount }, (_, i) => ({ key: `team:t${i}`, name: `Team ${["Network", "Backup", "Billing", "Support", "Security"][i % 5]} ${i + 1}`, kind: "team" as const, color: tierColor("team", i) })),
] : [
  { key: "mine", name: "My memory", kind: "mine", color: tierColor("mine") },
  { key: "org", name: "Organization", kind: "org", color: tierColor("org") },
  { key: "bot:atlas", name: "Atlas", kind: "team", color: tierColor("team", 0) },
  { key: "bot:nova", name: "Nova", kind: "team", color: tierColor("team", 1) },
  { key: "team:ops", name: "Operations", kind: "team", color: tierColor("team", 2) },
];
const FOLDERS: Record<string, string[]> = new Proxy<Record<string, string[]>>({
  mine: ["notes", "notes / reading", "journal", "projects"],
  org: ["network", "backup", "policies", "clients", "clients / onboarding"],
  "bot:atlas": ["Atlas / Topics", "Atlas / Logs", "Atlas / People"],
  "bot:nova": ["Nova / Topics", "Nova / Logs"],
  "team:ops": ["runbooks", "incidents", "decisions"],
}, { get: (target, key: string) => target[key] ?? ["notes", "runbooks"] });
const WORDS = ["Backup", "Firewall", "Switch", "VLAN", "Onboarding", "Policy", "Weekly", "Briefing", "Restore", "Drill", "DNS", "Zone", "Travel", "Dining", "Release", "Checklist", "Style", "Reading", "Systems", "Meeting", "Decision", "Incident", "Printer", "Laptop", "Licence", "Renewal", "Vendor", "Contract", "Budget", "Roadmap", "Audit", "Password", "Rotation", "Mailbox", "Calendar", "Archive"];
const TAGS = ["work", "urgent", "area:network", "area:backup", "reading", "client", "review", "tech:dns", "tech:switch"];

function rowsOf(n: number): { rows: PageRow[]; bodies: Record<string, string> } {
  const rnd = seededRandom(42);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)]!;
  const rows: PageRow[] = [];
  const now = Date.now();
  const titles = new Set<string>();
  for (let i = 0; i < n; i++) {
    const tier = tiers[Math.floor(Math.pow(rnd(), 1.3) * tiers.length)]!;
    const folder = pick(FOLDERS[tier.key]!);
    let title = `${pick(WORDS)} ${pick(WORDS).toLowerCase()}`;
    while (titles.has(title)) title = `${title} ${titles.size % 97}`;
    titles.add(title);
    const source = { id: tier.key, kind: tier.kind === "team" ? "bot" : "perspicax", name: tier.name, mayWrite: true } as MemoryManagerSource;
    const tags = rnd() < 0.5 ? [pick(TAGS)] : rnd() < 0.3 ? [pick(TAGS), pick(TAGS)] : [];
    rows.push({
      key: `${tier.key}|${i}`,
      source,
      tier: tier.key,
      folderKey: `${tier.key}/${folder}`,
      folderPath: folder,
      row: { id: String(i), title, folder, tags: [...new Set(tags)], createdAt: now - (n - i) * 3_600_000 * 6, updatedAt: now - Math.floor(rnd() * 30) * 86_400_000 },
    });
  }
  // [[links]]: most notes link one or two others, a few hubs gather many.
  const hubs = rows.filter((_, i) => i % 23 === 0);
  const bodies: Record<string, string> = {};
  for (const entry of rows) {
    const links: string[] = [];
    const count = rnd() < 0.25 ? 0 : 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < count; k++) {
      const sameTier = rows.filter((other) => other.tier === entry.tier);
      const target = rnd() < 0.45 ? pick(hubs) : pick(sameTier);
      if (target.key !== entry.key) links.push(target.row.title);
    }
    if (rnd() < 0.05) links.push("Not written yet");
    bodies[entry.key] = `# ${entry.row.title}\n\n${links.map((title) => `See [[${title}]].`).join("\n")}\n${rnd() < 0.06 ? "![[diagram.png]]\n" : ""}`;
  }
  return { rows, bodies };
}

function Shell() {
  const { rows, bodies } = useMemo(() => rowsOf(total), []);
  const side = Number(params.get("side") ?? 0);
  const rail = params.get("rail") === "1" && width >= 1280;
  return (
    <div className="flex h-full bg-app" style={{ width, height }} data-gallery-ready="1">
      {side > 0 && <div className="shrink-0 border-r border-hairline/40 bg-panel" style={{ width: side }} />}
      <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
        <MemoryMapView rows={rows} tiers={tiers} bodies={bodies} review={3} onOpen={() => {}} />
      </div>
      {rail && (
        <RightRailPanel label="Explorer" onCollapse={() => {}} hideLabel="Hide" lead={<button type="button" className="flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-hairline/60 bg-app px-2.5 text-left text-[13px] text-ink-secondary"><span className="min-w-0 flex-1 truncate">{params.get("lang") === "fr" ? "Ouvrir une note" : "Open a note"}</span><kbd className="rounded border border-hairline/60 px-1 text-[11px]">⌘O</kbd></button>}>
          <p className="p-3 text-[12px] text-ink-secondary">Lists</p>
        </RightRailPanel>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
