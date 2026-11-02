/** Isolated gallery for lot 3 (2026-11-01): pushed pages in the bot panel
 * (instructions, activity history, skill review shell). Synthetic data only.
 * ?skin=<id>&lang=<code>&view=panel|instructions|activity|history&width=&height=
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BotInstructionsDialog } from "../components/BotInstructionsDialog";
import { ActivityDetailModal } from "../components/bot-settings/ActivityDetailModal";
import { ActivityListModal } from "../components/bot-settings/ActivityListModal";
import { PanelPage } from "../components/bot-settings/PanelPage";
import { SkillReviewDialog } from "../components/bot-settings/SkillsSection";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type Bot } from "../state/store";
import type { BotActivityDetail, BotActivityItem } from "../../shared/bot-activity";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.24", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const view = params.get("view") ?? "panel";
const width = Number(params.get("width") ?? 1280);
const height = Number(params.get("height") ?? 800);

const NOW = Date.now();
const bot = {
  id: "atlas",
  threadId: "main",
  name: "Atlas",
  title: "Research",
  description: "Research every claim and preserve its source URL.\n- Separate facts from inference.\n- Call out uncertainty plainly.",
  notifications: true,
  color: "blue",
  unread: false,
  modelSelection: { instanceId: "x", model: "x" },
  messages: [],
  tasks: [],
} as unknown as Bot;

const task: BotActivityItem = {
  id: "thread:t1", kind: "session", botId: "atlas", botName: "Atlas", title: "Draft the weekly briefing",
  status: "running", startedAt: NOW - 95_000, updatedAt: NOW, threadId: "t1",
  startedBy: { kind: "person", name: "Alex" }, coding: true, childCount: 0,
};
const detail: BotActivityDetail = {
  ...task,
  canStop: true,
  steps: [
    { id: "s1", name: "Read", summary: "docs/briefing.md", ok: true, at: NOW - 80_000, where: "server" },
    { id: "s2", name: "Edit", summary: "docs/briefing.md", ok: true, at: NOW - 40_000, where: "server" },
  ],
  stepsTruncated: false,
  children: [],
  files: [],
  via: undefined,
  engine: { instanceId: "x", model: "x" },
};

const originalFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  if (url.includes("/api/bots/") && url.includes("/activity/") && !url.includes("/activity?")) {
    return json({ item: detail });
  }
  if (url.includes("/api/bots/") && url.includes("/activity")) {
    return json({ items: [task, { ...task, id: "thread:t2", title: "Archive last month", status: "finished", endedAt: NOW - 3_600_000 }], subagents: [] });
  }
  if (url.includes("/api/threads/")) return json({ messages: [], hasMore: false, activeLeafId: null });
  return originalFetch(input, init);
}) as typeof fetch;
(window as unknown as { EventSource: unknown }).EventSource = class { close() {} addEventListener() {} removeEventListener() {} onmessage = null; onerror = null; onopen = null; readyState = 0; };

const store = {
  state: {
    ...initialState,
    bots: [bot],
    selectedId: "atlas",
    settingsOpen: true,
    instances: [{ instanceId: "x", displayName: "Fixture", engineId: "fixture", models: { options: [{ id: "x", label: "Fixture" }] }, snapshot: { authenticated: true, installed: true } }],
    config: null,
  },
  dispatch: () => {},
} as never;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-gallery-sample=""
      data-gallery-view={view}
      className="flex bg-app text-ink"
      style={{ width, height }}
    >
      <div className="min-w-0 flex-1 border-r border-hairline/40 bg-panel p-6 text-[13px] text-ink-secondary">
        Conversation (gallery)
      </div>
      <aside
        data-panel-bot="atlas"
        className="relative flex h-full w-[380px] shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-app"
      >
        <div className="flex h-12 shrink-0 items-center justify-end px-3 text-[12px] text-ink-secondary">Bot panel</div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="flex flex-col items-center px-4 pb-3 pt-2">
            <div className="size-16 rounded-full bg-elevated" />
            <div className="mt-2 text-[17px] font-medium text-ink">{bot.name}</div>
            <div className="text-[12.5px] text-ink-secondary">{bot.title}</div>
          </div>
          {children}
        </div>
      </aside>
    </div>
  );
}

function Gallery() {
  const [open, setOpen] = useState(true);
  if (!open) return <Shell><p className="px-4 text-[13px] text-ink-secondary">Closed</p></Shell>;

  if (view === "instructions") {
    return <Shell><BotInstructionsDialog bot={bot} onClose={() => setOpen(false)} /></Shell>;
  }
  if (view === "activity") {
    return <Shell><ActivityDetailModal item={task} onClose={() => setOpen(false)} onChanged={() => {}} /></Shell>;
  }
  if (view === "history") {
    return <Shell><ActivityListModal botId="atlas" filter="coding" onFilter={() => {}} onClose={() => setOpen(false)} onStop={() => {}} stopping={new Set()} /></Shell>;
  }
  if (view === "skill") {
    return (
      <Shell>
        <SkillReviewDialog
          skill={{ name: "order-audit", description: "Audit orders", enabled: false, source: "library/order-audit", warnings: [] }}
          text={"# Order audit\n\nCheck every order against the ledger."}
          error=""
          working={false}
          onCancel={() => setOpen(false)}
          onEnable={() => setOpen(false)}
        />
      </Shell>
    );
  }
  return (
    <Shell>
      <PanelPage name="Sample page" onBack={() => setOpen(false)} onClose={() => setOpen(false)} bodyClassName="px-4 py-4">
        <p className="text-[13px] text-ink">A pushed page in the bot panel.</p>
      </PanelPage>
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <Gallery />
    </BotEditorStore>
  </StrictMode>,
);
