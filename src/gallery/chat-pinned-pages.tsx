/** Isolated gallery for headless screenshots of pinned pages in the chat
 * top bar and the page viewer's Pin control. Not shipped.
 * ?lang=<code>&skin=<id>&pinned=1 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { ChatHeaderBar } from "../components/ChatHeaderBar";
import { ChatPinnedPages } from "../components/ChatPinnedPages";
import { PageSurface } from "../components/PageViewer";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { setWebPanels } from "../lib/web-panel-preferences";
import { BotEditorStore, type useStore } from "../state/store";
import type { PublishedPageSummary } from "../../shared/published-pages";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.175", __BASE_VERSION__: "0.26.0" });
const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const showPinned = params.get("pinned") !== "0";

const pageId = "galleryPinPage01";
const title = lang === "fr" ? "Rapport mensuel" : "Monthly report";
const now = Date.UTC(2026, 9, 21, 15, 0);

if (showPinned) {
  setWebPanels([
    { id: "panel-1", name: title, page: { pageId, botId: "bot-gallery", threadId: "thread-gallery" } },
    {
      id: "panel-2",
      name: lang === "fr" ? "Carte des ventes" : "Sales map",
      page: { pageId: "galleryPinPage02", botId: "bot-gallery", threadId: "thread-gallery" },
    },
  ]);
} else {
  setWebPanels([]);
}

let page: PublishedPageSummary = {
  id: pageId,
  title,
  status: "published",
  access: "link",
  expiresAt: null,
  currentVersion: 1,
  botId: "bot-gallery",
  threadId: "thread-gallery",
  createdAt: now - 86_400_000,
  updatedAt: now,
  expired: false,
  versions: [
    { n: 1, kind: "html", title, createdAt: now - 3_600_000, state: "published", bytes: 1400, botId: "bot-gallery" },
  ],
  comments: 0,
  url: "https://sagax.example.com/pages/view/x",
  path: "/pages/view/x",
  reachable: true,
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const base = `/api/pages/${pageId}`;
  if (url.pathname === "/api/auth/session") return reply({});
  if (url.pathname === "/api/pages/policy") return reply({ linkSharing: true });
  if (!url.pathname.startsWith(base)) return realFetch(input, init);
  if (url.pathname === base) return reply({ page });
  if (/\/versions\/\d+$/.test(url.pathname)) {
    return reply({ version: { n: 1, kind: "html", title, state: "published", previewPath: `/pages/preview/${pageId}/1` } });
  }
  return reply({});
};

const store = {
  state: { config: null, inspectorOpen: false, bots: [] },
  dispatch: () => {},
} as unknown as ReturnType<typeof useStore>;

function Sample() {
  const [open, setOpen] = useState(true);
  return (
    <div data-gallery-sample className="flex h-screen w-screen flex-col bg-app text-ink">
      <div className="relative min-h-0 flex-1">
        <ChatHeaderBar
          align="center"
          start={showPinned ? <ChatPinnedPages /> : undefined}
          center={
            <span className="rounded-full border border-hairline/50 bg-raised px-3 py-1.5 text-[13px] font-medium shadow-sm">
              {lang === "fr" ? "Éclaireur" : "Scout"}
            </span>
          }
        >
          <div data-chathead-controls className="flex shrink-0 items-center gap-2">
            <span className="text-[12px] text-ink-secondary">{t("chat.pinnedPages.label")}</span>
          </div>
        </ChatHeaderBar>
        <div className="absolute inset-0 pt-[52px]">
          {open ? (
            <PageSurface pageId={pageId} initialTitle={title} onClose={() => setOpen(false)} />
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-ink-secondary">
              {lang === "fr" ? "Conversation" : "Conversation"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <Sample />
    </BotEditorStore>
  </StrictMode>,
);
