/** Isolated gallery for headless screenshots of the conversation cost notices
 * and the JSON tree viewer. Not shipped in the app.
 * ?lang=<code>&skin=<id>&view=notices|json&used=<weekly percent> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GroupCostNotice, WeeklyLimitNotice } from "../components/ChatUsageNotices";
import { JsonViewer } from "../components/JsonViewer";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const used = Number(params.get("used") ?? "86");

const SAMPLE = { name: "Sagax", version: "0.6.0", engines: [{ id: "claude", weekly: 0.86, models: ["opus", "sonnet"] }, { id: "grok", weekly: null }], nested: { a: { b: { c: [1, 2, 3] } } }, empty: {}, list: [] };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/plan-usage")) {
    return json({ providers: [{ id: "claude", name: "Claude", driver: "claude", ok: true, error: null, state: "windows", access: "subscription", weekly: { available: true, usedPercent: used, remainingPercent: 100 - used, resetsAt: "2026-10-25T00:00:00Z" } }] });
  }
  if (url.includes("sample.json")) return new Response(JSON.stringify(SAMPLE, null, 2));
  if (url.includes("/api/message-file") || url.includes("/file")) return new Response(JSON.stringify(SAMPLE, null, 2));
  return realFetch(input, init);
};

const store = {
  state: {},
  dispatch: (action: unknown) => { (window as unknown as { __actions: unknown[] }).__actions.push(action); },
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;
(window as unknown as { __actions: unknown[] }).__actions = [];

function Gallery() {
  if (params.get("view") === "json") {
    return <JsonViewer path="/w/sample.json" name="sample.json" message={{ threadId: "t", messageId: "m" }} onClose={() => {}} returnFocus={null} />;
  }
  return (
    <div className="min-h-screen bg-canvas p-6 text-ink">
      <div className="mx-auto max-w-[760px]">
        <GroupCostNotice group={{ memberIds: ["a", "b"] }} />
        <WeeklyLimitNotice />
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
