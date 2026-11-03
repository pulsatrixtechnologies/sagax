/** Headless gallery for Tools > Memory (2026-11-02, the Perspicax console's shape). Synthetic data only.
 * ?skin=<id>&lang=<code>&view=notes|preview|map|columns|tags|quality|note|folder|collections|trash&width=&height=
 * notes: All notes; preview: a row clicked (the preview panel); note: a row
 * double-clicked (the note's page); folder: a Perspicax folder in Manual order;
 * map: the radial brain; columns: the column map;
 * map, tags, quality: those views; trash: the Perspicax trash.
 * links: a folder no bot is linked to (perf-test-061, a temporary agent's), its
 * "Not linked" hint; linked-menu / unlinked-menu: their ⋯ menus; delete: the
 * confirmation of Delete folder…; import / import-bot: the import window with
 * the preview of a vault (.zip), into My memory or into a bot's memory.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { MemoryManagerPanel } from "../components/memory-manager/MemoryManagerPanel";
import { ConfirmProvider } from "../components/ConfirmProvider";
import { PanelSlotProvider } from "../components/panel-slot";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState } from "../state/store";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.34", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const view = params.get("view") ?? "notes";
const width = Number(params.get("width") ?? 1440);
const height = Number(params.get("height") ?? 900);

const H = 3600_000;
const D = 24 * H;
const now = Date.now();
const iso = (ms: number) => new Date(now - ms).toISOString();

// Atlas and Nova: two bots, their topics, a log, the bodies with [[links]].
const BOT_FILES: Record<string, Record<string, { text: string; age: number }>> = {
  atlas: {
    "MEMORY.md": { text: "# MEMORY\n\n- [[Dining]] preferences\n- [[Travel]] plans\n- [[Procedures]] for the lab\n", age: 2 * H },
    "memory/dining.md": { text: "# Dining\n\nPrefers short tables near a window. See [[Travel]] for trips.\n\n```json\n{\n  \"likes\": [\"pasta\", \"bread\"],\n  \"avoids\": {\"olives\": true}\n}\n```\n", age: 9 * H },
    "memory/travel.md": { text: "# Travel\n\nTrains over planes when under five hours. Booked with [[Dining]] in mind.\n", age: 2 * D },
    "memory/procedures.md": { text: "# Procedures\n\nBack up the lab NAS every Friday, then check the [[Weekly briefing]].\n", age: 5 * D },
    "memory/contacts.md": { text: "{\n  \"front desk\": \"ext 100\",\n  \"lab\": \"ext 214\",\n  \"after hours\": \"ext 999\"\n}\n", age: 12 * D },
    "memory/logs/run-1.md": { text: "# Run 1\n\nTidied three topics.\n", age: 1 * D },
  },
  // a temporary agent's memory (create_agent): no current bot is linked to it
  perf: {
    "memory/probe.md": { text: "# Probe\n\nLatency probe left by a test run.\n", age: 14 * D },
  },
  nova: {
    "MEMORY.md": { text: "# MEMORY\n\nIndex for Nova: [[Release checklist]].\n", age: 3 * H },
    "memory/release-checklist.md": { text: "# Release checklist\n\n- [ ] Notes written\n- [x] Tests green\n\nLinked from the [[Weekly briefing]].\n", age: 20 * H },
    "memory/style.md": { text: "# Style\n\nShort sentences, plain words, no jargon.\n", age: 40 * D },
  },
};

function overview(botId: string) {
  const files = BOT_FILES[botId] ?? {};
  const entry = (path: string) => ({ path, name: path.split("/").pop()!, bytes: files[path]!.text.length, modifiedAt: now - files[path]!.age });
  return {
    botId,
    workspacePath: `/tmp/${botId}`,
    index: { lines: 4, bytes: files["MEMORY.md"] ? 80 : 0, maxLines: 200, maxBytes: 24000, loadedLines: 4, loadedBytes: 80, truncated: false, hash: "idx" },
    topics: Object.keys(files).filter((path) => path.startsWith("memory/") && !path.includes("/logs/")).map(entry),
    logs: Object.keys(files).filter((path) => path.includes("/logs/")).map(entry),
  };
}

function journal(botId: string) {
  const files = BOT_FILES[botId] ?? {};
  const rows: unknown[] = [];
  let n = 0;
  for (const [path, file] of Object.entries(files)) {
    const created = file.age + 20 * D + (n % 5) * 7 * D;
    rows.push({ id: `${botId}-${n++}`, at: now - created, botId, path, actor: "bot", via: "turn", kind: "created", beforeHash: null, afterHash: "a", diff: "", added: 6, removed: 0, canRevert: true });
    rows.push({ id: `${botId}-${n++}`, at: now - file.age, botId, path, actor: n % 3 === 0 ? "person" : "bot", via: "turn", threadTitle: "Planning", kind: "edited", beforeHash: "a", afterHash: "b", diff: "", added: 2, removed: 1, canRevert: true });
  }
  return { entries: rows };
}

const PX = {
  own: "user:demo",
  tiers: [
    {
      scope: "me", kind: "me", name: "Personal", may_write: true, may_manage: true, trashed: 1, archived: 1, edit_mode: "direct",
      topics: [
        { topic: "notes", count: 2, entries: [
          { id: "n1", title: "Weekly briefing", topic: "notes", tags: ["work", "area:planning"], updated: iso(4 * H), created: iso(60 * D), excerpt: "Keep every claim with its source.", author_name: "Dana Reyes", links: 2 },
          { id: "n2", title: "Reading list", topic: "notes", tags: ["reading"], updated: iso(3 * D), created: iso(30 * D), excerpt: "Three books on systems thinking.", author_name: "Dana Reyes", links: 0 },
        ] },
        { topic: "field-notes", count: 1, entries: [
          { id: "f1", title: "Existing", topic: "field-notes", tags: [], updated: iso(8 * D), created: iso(8 * D), excerpt: "Written by hand last week.", author_name: "Dana Reyes" },
        ] },
        { topic: "templates", count: 1, entries: [
          { id: "t1", title: "Meeting notes", topic: "templates", tags: [], updated: iso(20 * D), created: iso(90 * D), excerpt: "Attendees, decisions, actions.", author_name: "Dana Reyes" },
        ] },
      ],
    },
    {
      scope: "org", kind: "org", name: "Organization", may_write: true, may_manage: false, trashed: 0, archived: 0, edit_mode: "review",
      topics: [
        { topic: "network", count: 3, entries: [
          { id: "o1", title: "Core switch layout", topic: "network", tags: ["tech:switch", "area:network"], updated: iso(9 * H), created: iso(120 * D), excerpt: "VLAN 10 users, VLAN 20 servers.", author_name: "Sam Okafor", links: 3 },
          { id: "o2", title: "Firewall rules", topic: "network", tags: ["tech:firewall", "area:network"], updated: iso(2 * D), created: iso(100 * D), excerpt: "Default deny inbound.", author_name: "Sam Okafor", links: 1 },
          { id: "o3", title: "DNS zones", topic: "network", tags: ["tech:dns"], updated: iso(200 * D), created: iso(210 * D), excerpt: "{\"zone\":\"corp.example.test\",\"ttl\":300,\"records\":12}", author_name: "Lee Park" },
        ] },
        { topic: "backup", count: 1, entries: [
          { id: "o4", title: "Backup policy", topic: "backup", tags: ["tech:backup", "area:backup"], updated: iso(6 * D), created: iso(80 * D), excerpt: "Nightly incremental, weekly full.", author_name: "Lee Park", links: 2 },
        ] },
      ],
    },
    {
      scope: "team:ops", kind: "team", name: "Ops", may_write: true, may_manage: true, trashed: 0, archived: 0, edit_mode: "direct", pending: [{}],
      topics: [
        { topic: "runbooks", count: 1, entries: [
          { id: "p1", title: "Restore drill", topic: "runbooks", tags: ["area:backup"], updated: iso(1 * D), created: iso(45 * D), excerpt: "Restore one VM each month.", author_name: "Sam Okafor", links: 1 },
        ] },
      ],
    },
  ],
};

function pxEntry(scope: string, id: string) {
  for (const tier of PX.tiers) {
    if (tier.scope !== scope) continue;
    for (const topic of tier.topics) {
      const entry = topic.entries.find((row) => row.id === id);
      if (!entry) continue;
      const body = entry.excerpt.startsWith("{") ? entry.excerpt : `# ${entry.title}\n\n${entry.excerpt}\n\nSee [[Backup policy]] and [[Weekly briefing]].\n`;
      return {
        id, scope, topic: entry.topic, title: entry.title, body, tags: entry.tags, may_edit: tier.may_write, version: 3,
        author_name: entry.author_name, created: entry.created, updated: entry.updated, source: "humain",
        provenance: [{ kind: "console", reference: "" }], versions: tier.kind === "me" ? null : 4, edit_mode: tier.edit_mode,
        links_out: [{ scope: "org", id: "o4", title: "Backup policy" }],
        backlinks: [{ scope: "team:ops", id: "p1", title: "Restore drill", context: "Before a drill, read the Backup policy." }],
      };
    }
  }
  return { id, scope, topic: "notes", title: id, body: "", tags: [], may_edit: false };
}

/** A vault as a stored (uncompressed) .zip, the way the import window reads one. */
function vaultZip(): File {
  const text = new TextEncoder();
  const key = `${"sk-"}ant-api03-${"a".repeat(28)}`;
  const files: Array<[string, string]> = [
    ["Field Notes/Welcome.md", "---\ntitle: Welcome\ntags: [inbox, start]\n---\n# Welcome\n\nStart at [[Alpha plan]] and meet [[Jane Doe|Jane]]. #getting-started\n"],
    ["Field Notes/Projects/Alpha/Alpha plan.md", "---\ntags:\n  - project/alpha\nstatus: active\n---\nThe plan for Alpha. Owner: [[People/Jane Doe]].\n\n![[diagram.png]]\n\nSee [[Missing note]] later. #roadmap\n"],
    ["Field Notes/Projects/Beta/Beta brief.md", "Beta follows [[Alpha plan]]. #project/beta\n"],
    ["Field Notes/People/Jane Doe.md", "Jane leads [[Alpha plan#Owners]]. #person\n"],
    ["Field Notes/People/Sam Lee.md", "Sam reviews the [[Beta brief]]. #person\n"],
    ["Field Notes/Existing.md", "A note whose name is already in the destination.\n"],
    ["Field Notes/Leaked key.md", `The deploy key is ${key}.\n`],
    ["Field Notes/assets/diagram.png", "png"],
    ["Field Notes/.obsidian/app.json", "{}"],
    ["Field Notes/.obsidian/workspace.json", "{}"],
    ["Field Notes/.trash/Old.md", "deleted note"],
    ["Field Notes/.env", "API_TOKEN=x"],
  ];
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const header = (size: number) => { const buf = new Uint8Array(size); return { buf, view: new DataView(buf.buffer) }; };
  for (const [name, body] of files) {
    const nameBytes = text.encode(name);
    const data = text.encode(body);
    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, nameBytes.length, true);
    parts.push(local.buf, nameBytes, data);
    const dir = header(46);
    dir.view.setUint32(0, 0x02014b50, true);
    dir.view.setUint32(20, data.length, true);
    dir.view.setUint32(24, data.length, true);
    dir.view.setUint16(28, nameBytes.length, true);
    dir.view.setUint32(42, offset, true);
    central.push(dir.buf, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dirSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, dirSize, true);
  end.view.setUint32(16, offset, true);
  return new File([...parts, ...central, end.buf] as BlobPart[], "Field Notes.zip", { type: "application/zip" });
}

const originalFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  const query = new URL(url, location.href).searchParams;
  if (url.includes("/api/memory-manager/sources")) {
    return json({
      sources: [
        { id: "bot:atlas", kind: "bot", name: "Atlas", detail: "Bot memory", mayWrite: true, botId: "atlas", linked: true },
        { id: "bot:nova", kind: "bot", name: "Nova", detail: "Bot memory", mayWrite: true, botId: "nova", linked: true },
        { id: "bot:perf", kind: "bot", name: "perf-test-061", detail: "Bot memory", mayWrite: true, botId: "perf", linked: false },
        { id: "team:general", kind: "team", name: "General", detail: "Team notes", mayWrite: true, section: "" },
        // a sidebar section without team notes: no tier of its own
        { id: "team:dr-eggbot", kind: "team", name: "dr eggbot", detail: "0 team notes", mayWrite: true, section: "dr-eggbot" },
        { id: "perspicax", kind: "perspicax", name: "Perspicax", detail: "Personal, team and organization notes", mayWrite: true, mayManage: true, scope: "me" },
      ],
      perspicax: { available: true },
    });
  }
  const bot = /\/api\/bots\/([^/]+)\/memory/.exec(url)?.[1];
  if (bot && url.includes("/memory/journal")) return json(journal(bot));
  if (bot && url.includes("/memory/file")) {
    const path = query.get("path") ?? "MEMORY.md";
    return json({ path, text: BOT_FILES[bot]?.[path]?.text ?? "", hash: `h-${path}`, exists: true });
  }
  if (bot) return json(overview(bot));
  if (url.includes("/api/team-memory") && url.includes("section=dr-eggbot")) return json({ section: "dr-eggbot", label: "dr eggbot", entries: [] });
  if (url.includes("/api/team-memory")) {
    return json({
      section: "",
      label: "General",
      entries: [
        { id: "tm1", kind: "term", name: "OMB", detail: "Open MAUS Bot, the old name of the app.", aliases: [], status: "accepted", source: { botId: "atlas", botName: "Atlas", threadId: "t", at: now - 50 * D }, updatedAt: now - 10 * D },
        { id: "tm2", kind: "place", name: "Lab", detail: "The shared lab on the second floor.", aliases: [], status: "accepted", source: { botId: "nova", botName: "Nova", threadId: "t", at: now - 70 * D }, updatedAt: now - 30 * D },
        { id: "tm3", kind: "decision", name: "Friday backups", detail: "Back up every Friday at 18:00.", aliases: [], status: "proposed", source: { botId: "atlas", botName: "Atlas", threadId: "t", at: now - 2 * D }, updatedAt: now - 2 * D },
        { id: "tm4", kind: "person", name: "Front desk", detail: "Answers ext 100 on weekdays.", aliases: [], status: "accepted", source: { botId: "nova", botName: "Nova", threadId: "t", at: now - 15 * D }, updatedAt: now - 15 * D },
      ],
    });
  }
  if (url.includes("/api/me/memory/tree")) return json(PX);
  if (url.includes("/api/me/memory/tags")) {
    return json({ namespaces: [
      { id: "tech", label_en: "Technology", controlled: true, required: false, tags: [{ tag: "tech:switch" }, { tag: "tech:firewall" }, { tag: "tech:dns" }] },
      { id: "area", label_en: "Area", controlled: false, required: true, tags: [{ tag: "area:network" }, { tag: "area:backup" }] },
    ] });
  }
  if (url.includes("/api/me/memory/archived")) {
    return json({ notes: [{ scope: "me", id: "a1", title: "Old onboarding", topic: "notes", tags: ["work"], archived_at: iso(40 * D), author_name: "Dana Reyes", may_restore: true }] });
  }
  if (/\/api\/me\/memory\/collections\/[^/?]+/.test(url)) {
    return json({ id: "c1", scope: "me", title: "Onboarding book", description: "Read in this order on day one", item_count: 3, may_edit: true, items: [
      { note_scope: "org", note_id: "o4", rank: 0, title: "Backup policy", topic: "backup", readable: true },
      { note_scope: "org", note_id: "o1", rank: 1, title: "Core switch layout", topic: "network", readable: true },
      { note_scope: "team:ops", note_id: "p1", rank: 2, title: "Restore drill", topic: "runbooks", readable: true },
    ] });
  }
  if (url.includes("/api/me/memory/collections")) {
    return json({ collections: [
      { id: "c1", scope: "me", title: "Onboarding book", description: "Read in this order on day one", author_name: "Dana Reyes", updated_at: iso(3 * D), item_count: 3, may_edit: true },
      { id: "c2", scope: "org", title: "Network basics", description: "Switches, firewall, DNS", author_name: "Sam Okafor", updated_at: iso(12 * D), item_count: 3, may_edit: false },
    ] });
  }
  if (url.includes("/api/me/memory/entry")) return json(pxEntry(query.get("scope") ?? "me", query.get("id") ?? "n1"));
  if (url.includes("/api/me/memory/trash")) {
    return json({ notes: [{ id: "old", title: "Old draft", scope: "me", topic: "notes", tags: [], may_manage: true, deleted_at: iso(2 * D), author_name: "Dana Reyes" }], days: 30 });
  }
  return originalFetch(input, init);
}) as typeof fetch;
(window as unknown as { EventSource: unknown }).EventSource = class { close() {} addEventListener() {} removeEventListener() {} onmessage = null; onerror = null; onopen = null; readyState = 0; };

const store = {
  state: {
    ...initialState,
    activeView: "memory" as const,
    memoryManagerOpen: true,
    bots: [{
      id: "atlas", threadId: "main", name: "Atlas", title: "Research", description: "",
      notifications: true, color: "blue", unread: false,
      modelSelection: { instanceId: "x", model: "x" }, messages: [], tasks: [],
    }, {
      id: "nova", threadId: "main-nova", name: "Nova", title: "Releases", description: "",
      notifications: true, color: "purple", unread: false,
      modelSelection: { instanceId: "x", model: "x" }, messages: [], tasks: [],
    }],
    routines: [{ id: "r1", name: "Morning digest", botId: "atlas" }, { id: "r2", name: "Friday backup check", botId: "atlas" }],
  },
  dispatch: () => {},
};

function Shell() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const waitFor = async (selector: string, ms = 8_000) => {
      const start = Date.now();
      while (!cancelled && Date.now() - start < ms) {
        if (document.querySelector(selector)) return true;
        await new Promise((done) => setTimeout(done, 50));
      }
      return false;
    };
    const click = (selector: string) => document.querySelector<HTMLElement>(selector)?.click();
    const segment = (label: RegExp) => [...document.querySelectorAll<HTMLButtonElement>("[data-memory-views] button")].find((button) => label.test(button.getAttribute("title") ?? button.textContent ?? ""))?.click();
    void (async () => {
      await waitFor("[data-memory-tiers]");
      await waitFor('[data-memory-note-row="o1"]');
      // let the bodies arrive (excerpts, links)
      await new Promise((done) => setTimeout(done, 700));
      if (view === "map" || view === "columns") {
        segment(/Map|Carte/);
        await waitFor("[data-memory-map]");
        if (view === "columns") [...document.querySelectorAll<HTMLButtonElement>("[data-memory-map-layout-switch] button")].find((button) => /Columns|Colonnes/.test(button.textContent ?? ""))?.click();
        await new Promise((done) => setTimeout(done, 900));
      }
      if (view === "collections") { click('[data-memory-nav="collections"]'); await waitFor("[data-memory-collection-row]"); click("[data-memory-collection-row]"); await waitFor("[data-memory-collection-items]"); }
      if (view === "tags") { segment(/Tags|Étiquettes/); await waitFor("[data-memory-tags-view]"); }
      if (view === "quality") { segment(/Quality|Qualité/); await waitFor("[data-memory-quality-view]"); }
      if (view === "trash") { click('[data-memory-nav="trash"]'); await waitFor("[data-memory-trash]"); }
      // StrictMode runs this effect twice: only the live run drives the page (a second click would close a menu)
      if (cancelled) return;
      const folderRow = (selector: string) => document.querySelector(selector)?.closest("[data-memory-folder-link]");
      if (view === "links") document.querySelector<HTMLElement>('[data-memory-source="bot:perf"]')?.focus();
      if (view === "linked-menu" || view === "unlinked-menu" || view === "delete") {
        const row = folderRow(view === "linked-menu" ? '[data-memory-source="bot:atlas"]' : '[data-memory-source="bot:perf"]');
        row?.querySelector<HTMLElement>("button")?.focus();
        row?.querySelector<HTMLElement>('[data-memory-row-action="menu"]')?.click();
        await waitFor("[data-memory-folder-menu]");
        if (view === "delete") {
          row?.querySelector<HTMLElement>('[data-memory-folder-menu-item="delete"]')?.click();
          await waitFor('[role="alertdialog"]');
        }
      }
      if (view === "import" || view === "import-bot") {
        click('[data-memory-nav="import"]');
        await waitFor("[data-memory-import]");
        const input = document.querySelector<HTMLInputElement>("[data-memory-import-zip]")!;
        const transfer = new DataTransfer();
        transfer.items.add(vaultZip());
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await waitFor("[data-memory-import-preview]");
        if (view === "import-bot") {
          const select = document.querySelector<HTMLSelectElement>("[data-memory-import-destination]")!;
          const option = [...select.options].find((entry) => entry.textContent?.includes("Atlas"));
          if (option) {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
            setter.call(select, option.value);
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        await new Promise((done) => setTimeout(done, 300));
      }
      if (view === "folder") {
        click('[data-memory-folder="org/network"]');
        await new Promise((done) => setTimeout(done, 200));
        [...document.querySelectorAll<HTMLButtonElement>("[data-memory-list-sort] button")].find((button) => /Manual|Manuel/.test(button.textContent ?? ""))?.click();
      }
      if (view === "preview") {
        click('[data-memory-row-key="perspicax|org/o1"] [data-memory-row-open]');
        await waitFor("[data-memory-preview]");
        await new Promise((done) => setTimeout(done, 300));
      }
      if (view === "note") {
        document.querySelector('[data-memory-row-key="perspicax|org/o1"] [data-memory-row-open]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        await waitFor("[data-memory-note]");
        await new Promise((done) => setTimeout(done, 300));
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex h-full bg-app" data-gallery-ready={ready ? "1" : "0"} style={{ width, height }}>
      <BotEditorStore value={store as never}>
        <ConfirmProvider>
        <PanelSlotProvider slot={null}>
          {/* the app's content frame, as automations-header.tsx draws it, so the card and its gutters match the app */}
          <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
            <MemoryManagerPanel />
          </div>
        </PanelSlotProvider>
        </ConfirmProvider>
      </BotEditorStore>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
