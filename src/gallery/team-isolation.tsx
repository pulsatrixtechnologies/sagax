/** #2045: each person sees their own teams only. The real Sidebar beside the
 * real TeamMapPage for one of two people on an organization server. Anne
 * (first admin) has Ops; Benoit created Finance and filed a shared room in it.
 * ?person=anne|benoit&before=1 (before=1: the team list the server used to
 * send the first admin, other people's teams included). Synthetic names only.
 * Captured by scripts/capture/team-isolation.mjs. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Sidebar } from "../components/Sidebar";
import { TeamMapPage } from "../components/TeamMapPage";
import { loadLocale } from "../lib/i18n";
import { applySkin } from "../lib/skins";
import { BotEditorStore, initialState, type AppState, type Bot, type Group } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
applySkin("pulsatrix");
await loadLocale(params.get("lang") ?? "en");
const person = params.get("person") === "benoit" ? "benoit" : "anne";
const before = params.get("before") === "1";
try {
  localStorage.setItem("sagax.interfaceMode.v1", "advanced");
  localStorage.setItem("omb-sidebar-width-v2", "300");
} catch {
  // the defaults still render
}

const bot = (id: string, name: string, color: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", color, notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" }, tasks: [{ threadId: `${id}-thread`, title: "Chat", createdAt: 1 }], ...extra,
} as unknown as Bot);
const room = (id: string, name: string, section: string, ownerId: string): Group => ({
  id, threadId: `t-${id}`, name, memberIds: [], defaultResponder: { kind: "everyone" },
  bulletin: "", unread: false, createdAt: 1, messages: [], section, ownerId,
} as Group);

const views: Record<string, { bots: Bot[]; groups: Group[]; sections: string[]; leaked: string[] }> = {
  anne: {
    bots: [bot("atlas", "Atlas", "blue", { title: "Dispatch", section: "Ops" }), bot("cirrus", "Cirrus", "purple", { title: "Projects", section: "Ops" })],
    groups: [room("crew", "Month end", "Finance", "pr_benoit")],
    sections: ["Ops"],
    leaked: ["Finance", "Agents personels"],
  },
  benoit: {
    bots: [bot("boreas", "Boreas", "green", { title: "Billing", section: "Finance" })],
    groups: [room("crew", "Month end", "Finance", "pr_benoit")],
    sections: ["Finance"],
    leaked: ["Agents personels"],
  },
};
const view = views[person];
const state: AppState = { ...initialState, bots: view.bots, groups: view.groups, sections: before ? [...view.sections, ...view.leaked] : view.sections };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/team-map")) return json({ collaborations: [], queued: [], running: [] });
  if (url.includes("/api/team-computers")) return json({ computers: [] });
  if (url.includes("/api/config")) return json({ profile: { name: person === "anne" ? "Anne" : "Benoit" } });
  if (url.includes("/api/")) return json({});
  return realFetch(input, init);
};
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

const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={value}>
      <div data-gallery-sample="team-isolation" className="flex overflow-hidden bg-app text-ink" style={{ width: 1480, height: 860 }}>
        <Sidebar open onClose={() => {}} />
        <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
          <TeamMapPage />
        </div>
      </div>
    </BotEditorStore>
  </StrictMode>,
);
