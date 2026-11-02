/** Headless gallery for Tools > Memory page (2026-11-02). Synthetic data only.
 * ?skin=<id>&lang=<code>&view=sources|browse|note|map|trash|folder|hover&dense=1
 * sources: All notes; browse/note/map: Atlas's memory; folder: a Perspicax
 * folder; hover: waits on the folder row (the capture hovers it); trash: Trash.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { MemoryManagerPanel } from "../components/memory-manager/MemoryManagerPanel";
import { PanelSlotProvider } from "../components/panel-slot";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState } from "../state/store";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.24", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const view = params.get("view") ?? "sources";
const dense = params.get("dense") === "1";
const width = Number(params.get("width") ?? 1280);
const height = Number(params.get("height") ?? 800);

const DENSE_FOLDERS = ["alpha", "beta", "gamma", "delta"] as const;
const denseTopics = Array.from({ length: 40 }, (_, index) => {
  const folder = DENSE_FOLDERS[index % DENSE_FOLDERS.length]!;
  const n = index + 1;
  return {
    path: `memory/${folder}/note-${n}.md`,
    name: `Note ${n}.md`,
    bytes: 40 + n,
    modifiedAt: Date.now() - n * 3600_000,
  };
});

function denseNoteBody(path: string): string {
  const match = /note-(\d+)\.md$/.exec(path);
  const n = match ? Number(match[1]) : 1;
  const next = (n % 40) + 1;
  const jump = ((n + 6) % 40) + 1;
  return `# Note ${n}\n\nSee [[Note ${next}]] and [[Note ${jump}]].\n`;
}

const originalFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  if (url.includes("/api/memory-manager/sources")) {
    return json({
      sources: [
        { id: "bot:atlas", kind: "bot", name: "Atlas", detail: "Bot memory", mayWrite: true, botId: "atlas" },
        { id: "team:general", kind: "team", name: "General", detail: "2 team notes", mayWrite: true, section: "" },
        { id: "perspicax", kind: "perspicax", name: "Perspicax", detail: "Personal, team and organization notes", mayWrite: true, mayManage: true, scope: "me" },
      ],
      perspicax: { available: true },
    });
  }
  if (url.includes("/api/bots/atlas/memory/file")) {
    if (dense) {
      const pathMatch = /path=([^&]+)/.exec(url);
      const path = pathMatch ? decodeURIComponent(pathMatch[1]) : "memory/alpha/note-1.md";
      return json({
        path,
        text: path === "MEMORY.md" ? "# MEMORY\n\nIndex for Atlas.\n" : denseNoteBody(path),
        hash: `h-${path}`,
        exists: true,
      });
    }
    const travel = url.includes("travel");
    return json({
      path: travel ? "memory/travel.md" : "memory/dining.md",
      text: travel
        ? "# Travel\n\nTrips with [[Dining]].\n"
        : "# Dining\n\nPrefers short tables. See [[Travel]].\n\n```json\n{\n  \"likes\": [\"pasta\", \"bread\"],\n  \"avoids\": {\"olives\": true}\n}\n```\n",
      hash: travel ? "trv" : "abc123",
      exists: true,
    });
  }
  if (url.includes("/api/bots/atlas/memory")) {
    if (dense) {
      return json({
        botId: "atlas",
        workspacePath: "/tmp/atlas",
        index: { lines: 40, bytes: 800, maxLines: 200, maxBytes: 24000, loadedLines: 40, loadedBytes: 800, truncated: false, hash: "idx-dense" },
        topics: denseTopics,
        logs: [
          { path: "memory/logs/run-1.md", name: "run-1.md", bytes: 20, modifiedAt: Date.now() - 1000 },
          { path: "memory/logs/run-2.md", name: "run-2.md", bytes: 20, modifiedAt: Date.now() - 2000 },
        ],
      });
    }
    return json({
      botId: "atlas",
      workspacePath: "/tmp/atlas",
      index: { lines: 4, bytes: 80, maxLines: 200, maxBytes: 24000, loadedLines: 4, loadedBytes: 80, truncated: false, hash: "idx" },
      topics: [
        { path: "memory/dining.md", name: "dining.md", bytes: 120, modifiedAt: Date.now() - 3600_000 },
        { path: "memory/travel.md", name: "travel.md", bytes: 40, modifiedAt: Date.now() - 86400_000 },
      ],
      logs: [],
    });
  }
  if (url.includes("/api/team-memory")) {
    return json({
      section: "",
      label: "General",
      entries: [
        { id: "tm1", kind: "term", name: "OMB", detail: "Open MAUS Bot", aliases: [], status: "accepted", source: { botId: "atlas", botName: "Atlas", threadId: "t", at: 1 }, updatedAt: 1 },
        { id: "tm2", kind: "place", name: "Lab", detail: "The shared lab", aliases: [], status: "accepted", source: { botId: "atlas", botName: "Atlas", threadId: "t", at: 1 }, updatedAt: 2 },
      ],
    });
  }
  if (url.includes("/api/me/memory/tree")) {
    if (dense) {
      const topics = DENSE_FOLDERS.map((topic, topicIndex) => {
        const entries = Array.from({ length: 10 }, (_, entryIndex) => {
          const n = topicIndex * 10 + entryIndex + 1;
          return {
            id: `n${n}`,
            title: `Note ${n}`,
            topic,
            tags: n % 3 === 0 ? ["shared", topic] : [topic],
            updated: new Date(Date.now() - n * 3600_000).toISOString(),
            excerpt: `Excerpt ${n}`,
          };
        });
        return { topic, count: entries.length, entries };
      });
      return json({
        own: "user:demo",
        tiers: [{
          scope: "me",
          kind: "me",
          name: "Personal",
          may_write: true,
          may_manage: true,
          trashed: 0,
          topics,
        }],
      });
    }
    return json({
      own: "user:demo",
      tiers: [{
        scope: "me",
        kind: "me",
        name: "Personal",
        may_write: true,
        may_manage: true,
        trashed: 1,
        topics: [{
          topic: "notes",
          count: 1,
          entries: [{ id: "n1", title: "Weekly briefing", topic: "notes", tags: ["work"], updated: new Date().toISOString(), excerpt: "Keep sources" }],
        }],
      }],
    });
  }
  if (url.includes("/api/me/memory/entry")) {
    if (dense) {
      const idMatch = /[?&]id=([^&]+)/.exec(url);
      const id = idMatch ? decodeURIComponent(idMatch[1]) : "n1";
      const n = Number((/^n(\d+)$/.exec(id) ?? [])[1] ?? 1);
      const topic = DENSE_FOLDERS[(n - 1) % DENSE_FOLDERS.length]!;
      const next = (n % 40) + 1;
      const jump = ((n + 6) % 40) + 1;
      return json({
        id,
        scope: "me",
        topic,
        title: `Note ${n}`,
        body: `# Note ${n}\n\nSee [[Note ${next}]] and [[Note ${jump}]].\n`,
        tags: n % 3 === 0 ? ["shared", topic] : [topic],
        may_edit: true,
        version: 1,
      });
    }
    return json({
      id: "n1", scope: "me", topic: "notes", title: "Weekly briefing",
      body: "# Weekly briefing\n\nKeep every claim with its source.\n",
      tags: ["work"], may_edit: true, version: 1,
    });
  }
  if (url.includes("/api/me/memory/trash")) {
    return json({ notes: [{ id: "old", title: "Old draft", scope: "me", may_manage: true }], days: 30 });
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
    }],
  },
  dispatch: () => {},
};

function Shell() {
  const [ready, setReady] = useState(view === "sources");
  useEffect(() => {
    if (view === "sources") return;
    let cancelled = false;
    const waitFor = async (selector: string, ms = 8_000) => {
      const start = Date.now();
      while (!cancelled && Date.now() - start < ms) {
        if (document.querySelector(selector)) return true;
        await new Promise((done) => setTimeout(done, 50));
      }
      return false;
    };
    void (async () => {
      await new Promise((done) => setTimeout(done, 200));
      if (cancelled) return;
      await waitFor("[data-memory-tiers]");
      if (view === "trash") {
        document.querySelector<HTMLButtonElement>('[data-memory-nav="trash"]')?.click();
        await waitFor("[data-memory-trash]");
        if (!cancelled) setReady(true);
        return;
      }
      if (view === "folder" || view === "hover") {
        const folder = dense ? "me/alpha" : "me/notes";
        await waitFor(`[data-memory-folder="${folder}"]`);
        const row = document.querySelector<HTMLButtonElement>(`[data-memory-folder="${folder}"]`);
        if (view === "folder") {
          row?.click();
          await waitFor("[data-memory-browse]");
        }
        if (!cancelled) setReady(true);
        return;
      }
      const sourceKey = dense ? "me/alpha" : "bot:atlas";
      document.querySelector<HTMLButtonElement>(dense ? `[data-memory-folder="${sourceKey}"]` : `[data-memory-source="${sourceKey}"]`)?.click();
      if (view === "browse" || view === "map") {
        await waitFor("[data-memory-browse], [data-memory-map]");
        if (view === "map") {
          const mapToggle = [...document.querySelectorAll("button")].find((button) => /Map|Carte/i.test(button.textContent || "") && button.getAttribute("aria-pressed") !== null);
          mapToggle?.click();
          await waitFor("[data-memory-map]");
          if (dense) {
            await waitFor('[data-memory-map-node="note"]');
            // Dense maps prefetch many bodies; give the graph a beat to settle.
            await new Promise((done) => setTimeout(done, 400));
          }
        }
        if (!cancelled) setReady(true);
        return;
      }
      if (view === "note") {
        await waitFor('[data-memory-browse] [data-memory-note-row="memory/dining.md"]');
        if (cancelled) return;
        document.querySelector<HTMLButtonElement>('[data-memory-browse] [data-memory-note-row="memory/dining.md"] button')?.click();
        await waitFor("[data-memory-read-body], [data-memory-json-tree]");
        if (!cancelled) setReady(true);
        return;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex h-full bg-app" data-gallery-ready={ready ? "1" : "0"} style={{ width, height }}>
      <BotEditorStore value={store as never}>
        <PanelSlotProvider slot={null}>
          <MemoryManagerPanel />
        </PanelSlotProvider>
      </BotEditorStore>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
