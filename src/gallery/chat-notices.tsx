/** Isolated gallery for headless screenshots of the conversation cost notices,
 * the engine limit banner, and the JSON tree viewer. Not shipped in the app.
 * ?lang=<code>&skin=<id>&view=notices|json|engine-limit&used=<weekly percent> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GroupCostNotice, WeeklyLimitNotice } from "../components/ChatUsageNotices";
import { EngineLimitNotice } from "../components/LimitResetContinue";
import { BotHeaderPill } from "../components/BotHeaderPill";
import { JsonViewer } from "../components/JsonViewer";
import { rememberLimits } from "../lib/limit-resets";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const used = Number(params.get("used") ?? "86");
const resetAt = Date.parse(params.get("reset") ?? "2026-10-21T16:50:00Z");

const SAMPLE = { name: "Sagax", version: "0.6.0", engines: [{ id: "claude", weekly: 0.86, models: ["opus", "sonnet"] }, { id: "grok", weekly: null }], nested: { a: { b: { c: [1, 2, 3] } } }, empty: {}, list: [] };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/plan-usage")) {
    return json({ providers: [{ id: "claude", name: "Claude", driver: "claude", ok: true, error: null, state: "windows", access: "subscription", weekly: { available: true, usedPercent: used, remainingPercent: 100 - used, resetsAt: "2026-10-25T00:00:00Z" } }] });
  }
  if (url.includes("/api/limit-resets")) {
    return json({
      checkedAt: Date.now(),
      engines: [{
        engine: "grok",
        name: "Grok",
        driver: "grok",
        window: "5-hour",
        usedPercent: 100,
        resetsAt: resetAt,
        blocked: true,
      }],
    });
  }
  if (url.includes("sample.json")) return new Response(JSON.stringify(SAMPLE, null, 2));
  if (url.includes("/api/message-file") || url.includes("/file")) return new Response(JSON.stringify(SAMPLE, null, 2));
  return realFetch(input, init);
};

rememberLimits({
  checkedAt: Date.now(),
  engines: [{
    engine: "grok",
    name: "Grok",
    driver: "grok",
    window: "5-hour",
    usedPercent: 100,
    resetsAt: resetAt,
    blocked: true,
  }],
});

const store = {
  state: { routines: [] },
  dispatch: (action: unknown) => { (window as unknown as { __actions: unknown[] }).__actions.push(action); },
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;
(window as unknown as { __actions: unknown[] }).__actions = [];

function Gallery() {
  const view = params.get("view") ?? "notices";
  if (view === "json") {
    return <JsonViewer path="/w/sample.json" name="sample.json" message={{ threadId: "t", messageId: "m" }} onClose={() => {}} returnFocus={null} />;
  }
  if (view === "engine-limit") {
    return (
      <div data-gallery className="min-h-screen bg-app text-ink">
        <div className="relative mx-auto flex min-h-[320px] max-w-[760px] flex-col">
          <div className="@container/chathead relative flex min-h-[52px] items-center justify-end px-5 py-2.5">
            <div className="absolute left-1/2 top-1/2 flex max-w-[50%] -translate-x-1/2 -translate-y-1/2 items-center gap-2">
              <BotHeaderPill
                name="Scout"
                panelOpen={false}
                onToggle={() => {}}
                avatar={<span className="flex size-6 items-center justify-center rounded-full bg-raised text-[11px]">S</span>}
              />
            </div>
          </div>
          <div className="chat-banners pt-[52px]">
            <EngineLimitNotice engine="grok" botId="scout" threadId="t-scout" />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div data-gallery className="min-h-screen bg-canvas p-6 text-ink">
      <div className="mx-auto max-w-[760px]">
        <GroupCostNotice group={{ memberIds: ["a", "b"] }} />
        <WeeklyLimitNotice />
        <EngineLimitNotice engine="grok" botId="scout" threadId="t-scout" />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <Gallery />
    </BotEditorStore>
  </StrictMode>,
);
