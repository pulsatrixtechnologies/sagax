/** Headless gallery for Tools > Memory (2026-11-02). Synthetic data only.
 * ?skin=<id>&lang=<code>&view=sources|browse|note|trash
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
const width = Number(params.get("width") ?? 1280);
const height = Number(params.get("height") ?? 800);

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
    return json({
      path: "memory/dining.md",
      text: "# Dining\n\nPrefers short tables.\n\n```json\n{\n  \"likes\": [\"pasta\", \"bread\"],\n  \"avoids\": {\"olives\": true}\n}\n```\n",
      hash: "abc123",
      exists: true,
    });
  }
  if (url.includes("/api/bots/atlas/memory")) {
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
      const sourceKey = view === "trash" ? "perspicax" : "bot:atlas";
      document.querySelector<HTMLButtonElement>(`[data-memory-source="${sourceKey}"]`)?.click();
      if (view === "browse") {
        await waitFor("[data-memory-browse]");
        if (!cancelled) setReady(true);
        return;
      }
      if (view === "note") {
        await waitFor('[data-memory-note-row="memory/dining.md"]');
        if (cancelled) return;
        document.querySelector<HTMLButtonElement>('[data-memory-note-row="memory/dining.md"] button')?.click();
        await waitFor("[data-memory-read-body], [data-memory-json-tree]");
        if (!cancelled) setReady(true);
        return;
      }
      if (view === "trash") {
        await waitFor("[data-memory-browse], [data-memory-manager-panel]");
        if (cancelled) return;
        const trash = [...document.querySelectorAll("button")].find((button) => /Trash|Corbeille/i.test(button.textContent || ""));
        trash?.click();
        await waitFor("[data-memory-trash]");
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex h-full bg-app" data-gallery-ready={ready ? "1" : "0"} style={{ width, height }}>
      <div className="flex min-w-0 flex-1 flex-col border-r border-hairline/40 bg-panel px-6 py-5">
        <div className="text-[13px] font-medium text-ink">Conversation</div>
        <p className="mt-2 text-[12.5px] text-ink-secondary">Synthetic chat stays visible beside the memory panel.</p>
      </div>
      <div className="relative flex h-full" style={{ width: 480 }}>
        <BotEditorStore value={store as never}>
          <PanelSlotProvider slot={null}>
            <MemoryManagerPanel />
          </PanelSlotProvider>
        </BotEditorStore>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
