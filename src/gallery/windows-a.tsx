/** Isolated gallery for Playwright screenshots of the windows drawn like
 * Settings (2026-10-16, lot A): About, What's new, Update ready,
 * a confirmation, the keyboard shortcuts and Achievements. Not shipped.
 * ?skin=<id>&lang=<code>&view=about|notes|browse|update|confirm|shortcuts|achievements */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AboutDialog } from "../components/AboutDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { KeyboardShortcutsModal } from "../components/KeyboardShortcutsModal";
import { ReleaseNotesPrompt } from "../components/ReleaseNotesPrompt";
import { UpdateBanner } from "../components/UpdateBanner";
import { AchievementsScreen } from "../components/achievements/AchievementsScreen";
import { ACHIEVEMENTS } from "../../shared/achievements-catalog";
import { resetAchievementsForTests } from "../lib/achievements";
import { loadLocale } from "../lib/i18n";
import { requestReleaseNotes } from "../lib/release-notes-ui";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore } from "../state/store";
import "../styles.css";

// The build stamps these; the gallery names a real release.
Object.assign(globalThis, { __APP_VERSION__: "0.5.7", __BASE_VERSION__: "0.26.0", __BUILD_DATE__: "2026-11-12" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const view = params.get("view") ?? "about";

// No server here: loads never answer, so the fixtures stay.
window.fetch = () => new Promise<Response>(() => {});
const updaterState = {
  status: "downloaded" as const,
  version: "0.5.8",
  notes: "## Réglages\n\n* **Fenêtres façon Réglages** : À propos, notes de version et succès.\n\n## English\n\n## Settings\n\n* **Windows like Settings**.",
};
(window as unknown as { ogb: unknown }).ogb = {
  platform: "darwin",
  updater: { onState: (cb: (s: unknown) => void) => { cb(updaterState); return () => {}; }, install: () => {}, check: () => {} },
};

const unlocked = ACHIEVEMENTS.slice(0, 5).map((item) => item.id);
resetAchievementsForTests({
  status: "ready",
  snapshot: {
    points: 1240,
    maxPoints: 9000,
    level: { level: 7, from: 1050, to: 1400 },
    unlockedCount: unlocked.length,
    count: ACHIEVEMENTS.length,
    streak: 4,
    recent: unlocked.slice(0, 3),
    rewards: [],
    settings: { showPoints: true, showTitle: true, toasts: true, native: false, public: false, title: null },
    items: ACHIEVEMENTS.map((item, index) => ({
      id: item.id,
      unlockedAt: unlocked.includes(item.id) ? "2026-10-15T12:00:00Z" : undefined,
      current: index % 3,
      target: 3,
    })),
  } as never,
});

const store = { state: { config: null, selectedId: null, achievementsFocus: { category: "all", nonce: 0 } }, dispatch: () => {} } as never;
let requested = false;

function Gallery() {
  useEffect(() => {
    if (requested) return;
    requested = true;
    if (view === "notes") requestReleaseNotes("current");
    if (view === "browse") requestReleaseNotes("browse");
  }, []);
  return (
    <BotEditorStore value={store}>
      <div className="min-h-screen bg-app" data-gallery={view}>
        {view === "about" && <AboutDialog open onClose={() => {}} />}
        {(view === "notes" || view === "browse") && <ReleaseNotesPrompt />}
        {view === "update" && <UpdateBanner />}
        {view === "confirm" && (
          <ConfirmDialog
            open
            title="Supprimer Pepper?"
            body="Ses conversations et ses routines seront supprimées. Cette action est définitive."
            confirmLabel="Supprimer"
            onCancel={() => {}}
            onConfirm={() => {}}
          />
        )}
        {view === "shortcuts" && <KeyboardShortcutsModal open onClose={() => {}} />}
        {view === "achievements" && <div className="flex h-screen"><AchievementsScreen /></div>}
      </div>
    </BotEditorStore>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
