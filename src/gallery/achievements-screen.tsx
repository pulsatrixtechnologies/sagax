/** Isolated gallery for headless screenshots of the Achievements page
 * (AchievementsScreen.tsx, one column since 2026-10-28) next to Settings
 * (SettingsModal.tsx), so the two can be compared. The
 * snapshot is answered here; the capture script
 * (scripts/capture/achievements-screen.mjs) answers the other /api calls.
 * Fictional data only. Not shipped in the app.
 * ?view=achievements|settings &category=<id> &skin=<id> &lang=<code> */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ACHIEVEMENTS } from "../../shared/achievements-catalog";
import { levelFor, type AchievementSnapshot } from "../../shared/achievements";
import { AchievementsScreen, type AchievementsScreenCategory } from "../components/achievements/AchievementsScreen";
import { SettingsModal } from "../components/SettingsModal";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const unlocked = new Set(ACHIEVEMENTS.filter((item) => !item.hidden).slice(0, 40).map((item) => item.id));
const points = ACHIEVEMENTS.filter((item) => unlocked.has(item.id)).reduce((sum, item) => sum + item.points, 0);
const snapshot: AchievementSnapshot = {
  points,
  maxPoints: ACHIEVEMENTS.reduce((sum, item) => sum + item.points, 0),
  level: levelFor(points),
  unlockedCount: unlocked.size,
  count: ACHIEVEMENTS.length,
  streak: 6,
  rewards: [],
  recent: [...unlocked].slice(-4),
  items: ACHIEVEMENTS.map((item) => ({ id: item.id, current: unlocked.has(item.id) ? 1 : 0, target: 1, ...(unlocked.has(item.id) ? { unlockedAt: Date.UTC(2026, 9, 20) } : {}) })),
  settings: { showPoints: true, showTitle: true, toasts: true, native: false, public: false },
};

const original = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  if (url.endsWith("/api/me/achievements")) return new Response(JSON.stringify(snapshot), { headers: { "content-type": "application/json" } });
  if (url.includes("/api/me/achievements/")) return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  return original(input, init);
};

function OpenSettings() {
  const { dispatch } = useStore();
  useEffect(() => { dispatch({ type: "toggleAppSettings", open: true, section: "appearance" }); }, [dispatch]);
  return null;
}

const view = params.get("view") ?? "achievements";
const category = (params.get("category") ?? "all") as AchievementsScreenCategory;

/** The page opens from a button, as from the account menu: a click (or
 * Enter) moves focus first, so the page's own focus handling is what shows. */
function Gallery() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button type="button" data-gallery-open="" onClick={() => setOpen(true)} className="m-6 rounded-lg border border-border px-3 py-2 text-[13px]">Open</button>;
  }
  return view === "settings" ? <><OpenSettings /><SettingsModal /></> : <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col"><AchievementsScreen initialCategory={category} /></div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="flex h-screen bg-app text-ink" data-gallery-achievements="">
        <Gallery />
      </div>
    </StoreProvider>
  </StrictMode>,
);
