/** Isolated gallery for headless screenshots of the conversation cost notices,
 * the engine limit banner, and the JSON tree viewer. Not shipped in the app.
 * ?lang=<code>&skin=<id>&view=notices|json|engine-limit|bot-pill&used=<weekly percent> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GroupCostNotice, WeeklyLimitNotice } from "../components/ChatUsageNotices";
import { EngineLimitNotice } from "../components/LimitResetContinue";
import { ComposerSendBlock } from "../components/ComposerSendBlock";
import { BotChatHeader, BotHeaderPill } from "../components/BotHeaderPill";
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
  if (view === "bot-pill") {
    // The bot chat's header pill: the name with the title stacked under it
    // (JC 2026-11-06), then a long title that ends in an ellipsis.
    const mascot = <span className="flex size-[22px] items-center justify-center rounded-full bg-raised text-[11px]">M</span>;
    return (
      <div data-gallery-bot-pill="" className="flex min-h-screen flex-col gap-6 bg-app p-8 text-ink">
        {[["Chief of Staff", 760], ["Chief of Staff for every client of the managed services desk", 520]].map(([label, width]) => (
          <div key={String(label)} className="@container/chathead relative flex min-h-[52px] items-center justify-end px-5 py-2.5" style={{ width: Number(width) }}>
            <div className="absolute left-1/2 top-1/2 flex max-w-[60%] -translate-x-1/2 -translate-y-1/2 items-center gap-2">
              <BotChatHeader name="Orla" label={String(label)} panelOpen={false} onToggle={() => {}} avatar={mascot} />
            </div>
          </div>
        ))}
      </div>
    );
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
          {/* At the limit the top banner is gone (JC 2026-11-06): the line above
              the composer says it and carries "Continue at <reset>". */}
          <div className="mt-auto px-5 pb-4" data-gallery-composer-line>
            <ComposerSendBlock
              block={{ reason: "engine_limit", message: "", action: { kind: "switch_engine" }, name: "Grok", limit: { cause: "usage_limit", resetsAt: resetAt } }}
              botId="scout"
              threadId="t-scout"
              onConnect={() => {}}
              onRetry={() => {}}
              onSwitchEngine={() => {}}
            />
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
