/** Isolated gallery for Playwright screenshots of a person's right panel,
 * Achievements tab (AchievementsPanel.tsx), at the docked panel's width:
 * a colleague with about twenty achievements unlocked and the rest locked.
 * The capture script (scripts/capture/person-achievements.mjs) answers /api
 * itself. Fictional names only. Not shipped in the app.
 * ?skin=<id>&lang=<code>&points=0 (a card without points) */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ACHIEVEMENTS } from "../../shared/achievements-catalog";
import { levelFor } from "../../shared/achievements";
import { PersonPanel } from "../components/PersonPanel";
import { resetPublicAchievementsForTests } from "../lib/public-achievements";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 24, 15);
// twenty of the catalog's visible achievements, plus one secret found
const picked = [...ACHIEVEMENTS.filter((item) => !item.hidden && item.points <= 50).slice(0, 20), ACHIEVEMENTS.find((item) => item.hidden)!];
const unlocked = picked.map((item, index) => ({ id: item.id, points: item.points, unlockedAt: NOW - (picked.length - index) * 3 * DAY }));
const points = unlocked.reduce((sum, item) => sum + item.points, 0);
const withPoints = params.get("points") !== "0";
resetPublicAchievementsForTests({
  pr_camille: {
    ...(withPoints ? { points, level: levelFor(points).level } : {}),
    title: "collector",
    unlocked,
  },
});

const directory = {
  people: [{ principalId: "pr_camille", name: "Camille Rivard", login: "camille", email: "camille@example.test", role: "member" as const, disabled: false, teams: [{ id: "t1", manager: false }] }],
  teams: [{ id: "t1", name: "Support", managers: [], members: [] }],
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div data-gallery-panel="" className="flex h-screen w-[400px] bg-app text-ink [&_.app-docked-panel]:!w-[400px]">
        <PersonPanel personId="pr_camille" directory={directory as never} />
      </div>
    </StoreProvider>
  </StrictMode>,
);
