/** Isolated gallery for headless screenshots of the inspector's line total
 * (#3666): the real InspectorPanel twice, side by side, with a fake store and
 * its events route answered here. Left, a log whose total is known; right, a
 * long log still being counted, whose total is only a lower bound. Not
 * shipped in the app. ?lang=<code>&skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { InspectorPanel } from "../components/InspectorPanel";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type useStore } from "../state/store";
import type { InspectorPage } from "../../shared/inspector";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const bot = (id: string, threadId: string) => ({ id, name: id, color: "violet", threadId, messages: [], tasks: [] }) as unknown as Bot;
const bots = [bot("bot-known", "t-known"), bot("bot-counting", "t-counting")];

const at = (n: number) => new Date(Date.UTC(2026, 10, 11, 9, 0, 0) + n * 1_000).toISOString();
const entries = (count: number): InspectorPage["entries"] =>
  Array.from({ length: count }, (_, n) => ({
    kind: "runtime" as const,
    at: at(n),
    data: { eventId: `e${n}`, provider: "claude", threadId: "t", createdAt: at(n), type: n % 2 ? "turn.completed" : "turn.started", ...(n % 2 ? { ok: true } : {}) } as never,
  }));
const pages: Record<string, InspectorPage> = {
  "t-known": { entries: entries(300), total: { runtime: 1687, native: 0 } },
  "t-counting": { entries: entries(300), total: { runtime: 300, native: 0 }, totalPartial: { runtime: true, native: false } },
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/auth/session")) return json({});
  const thread = /\/api\/threads\/([\w-]+)\/events/.exec(url)?.[1];
  if (thread && pages[thread]) return json(pages[thread]);
  return realFetch(input, init);
};

const store = { state: { bots, groups: [] }, dispatch: () => {}, flushBotPatches: async () => null } as unknown as ReturnType<typeof useStore>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <div className="flex h-screen bg-app">
        {bots.map((item) => (
          <div key={item.id} data-gallery-inspector={item.id} className="relative flex h-full w-1/2 border-r-[0.5px] border-hairline-weak">
            <InspectorPanel bot={item} />
          </div>
        ))}
      </div>
    </BotEditorStore>
  </StrictMode>,
);
