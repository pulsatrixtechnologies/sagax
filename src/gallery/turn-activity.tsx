/** Isolated gallery for headless screenshots of a bot's main chat seen from
 * its panel (2026-10-29): Details > Coding beside the sheet of the entry.
 * The list and the detail are what the server's activity route answered
 * for the scenario (scripts/capture/turn-activity.ts puts them on
 * window.__TURN_FIXTURE__ before the page loads), so a capture of the route
 * before and after a change compares the real output. Not shipped; every
 * request is answered here, nothing reaches a server.
 * ?skin=<id>&lang=<code>&view=panel|sheet */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ActivityDetailModal } from "../components/bot-settings/ActivityDetailModal";
import { PanelSections } from "../components/bot-settings/ActivitySection";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState } from "../state/store";
import type { BotActivityDetail, BotActivityList } from "../../shared/bot-activity";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.17", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
document.documentElement.lang = lang;
const view = params.get("view") ?? "panel";

const fixture = (window as unknown as { __TURN_FIXTURE__?: { list: BotActivityList; detail: BotActivityDetail; now: number } }).__TURN_FIXTURE__;
if (!fixture) throw new Error("no __TURN_FIXTURE__: run scripts/capture/turn-activity.ts");
const { list, detail, now } = fixture;
const entry = list.items.find((item) => item.id === detail.id) ?? detail;

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
window.fetch = ((input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/auth/session")) return json({ kind: "loopback", trust: "owner" });
  if (url.includes("/activity/item")) return json({ item: detail });
  if (/\/api\/threads\/[^/]+\/messages/.test(url)) return json({ messages: [], hasMore: false, activeLeafId: null });
  if (url.includes("/activity")) return json(list);
  return new Promise<Response>(() => {});
}) as typeof fetch;
(window as unknown as { EventSource: unknown }).EventSource = class { close() {} addEventListener() {} removeEventListener() {} onmessage = null; onerror = null; onopen = null; readyState = 0; };

const bots = [
  { id: "pepper", name: "Pepper", color: "green", threadId: "t-main", tasks: [{ threadId: "t-main", title: "hello", createdAt: now - 8 * 3_600_000 }], messages: [], hasMore: false, activeLeafId: null, busy: true, modelSelection: { instanceId: "claude", model: "claude-opus-5-5" }, approvalMode: "ask" },
  { id: "echo", name: "Echo", color: "violet", threadId: "e-main", tasks: [], messages: [], hasMore: false, activeLeafId: null, busy: true, approvalMode: "ask" },
];
const store = {
  state: { ...initialState, bots, selectedId: "pepper", instances: [{ instanceId: "claude", displayName: "Claude", engineId: "claude", models: { options: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }] }, snapshot: { authenticated: true, installed: true } }], config: null },
  dispatch: () => {},
  flushBotPatches: async () => null,
} as never;

function Panel() {
  return (
    <aside data-gallery-panel="" className="min-h-screen w-[380px] border-r border-hairline/40 bg-panel text-ink">
      <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
        <PanelSections list={list} actions={{ onOpen: () => {}, now }} onOpenHistory={() => {}} />
      </div>
    </aside>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <div className="min-h-screen bg-app" data-gallery="turn-activity" data-gallery-ready="">
        {view === "sheet" ? <ActivityDetailModal item={entry} onClose={() => {}} onChanged={() => {}} /> : <Panel />}
      </div>
    </BotEditorStore>
  </StrictMode>,
);
