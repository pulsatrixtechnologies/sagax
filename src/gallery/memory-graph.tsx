/** Headless gallery for Tools > Memory > Map > Graph (2026-11-03). Synthetic data only.
 * ?skin=<id>&lang=<code>&n=<notes>&width=&height=&settings=1
 * n: how many notes (the perf check uses 1200); settings=1 opens the Graph
 * settings card with every section unfolded.
 */
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";

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

const tiers: PageTier[] = [
  { key: "mine", name: "My memory", kind: "mine", color: tierColor("mine") },
  { key: "org", name: "Organization", kind: "org", color: tierColor("org") },
  { key: "bot:atlas", name: "Atlas", kind: "team", color: tierColor("team", 0) },
  { key: "bot:nova", name: "Nova", kind: "team", color: tierColor("team", 1) },
  { key: "team:ops", name: "Operations", kind: "team", color: tierColor("team", 2) },
];
const FOLDERS: Record<string, string[]> = {
  mine: ["notes", "notes / reading", "journal", "projects"],
  org: ["network", "backup", "policies", "clients", "clients / onboarding"],
  "bot:atlas": ["Atlas / Topics", "Atlas / Logs", "Atlas / People"],
  "bot:nova": ["Nova / Topics", "Nova / Logs"],
  "team:ops": ["runbooks", "incidents", "decisions"],
};
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
  return (
    <div className="flex h-full flex-col bg-app" style={{ width, height }} data-gallery-ready="1">
      <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
        <MemoryMapView rows={rows} tiers={tiers} bodies={bodies} review={3} onOpen={() => {}} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
