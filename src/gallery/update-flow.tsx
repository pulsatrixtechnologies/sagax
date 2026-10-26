/** Isolated gallery for Playwright screenshots of the update dialog through
 * a check the person asked for (2026-10-19): checking, available (the
 * download under way), downloading, ready, installing, up to date, error.
 * Not shipped. ?view=<state>&skin=<id>&lang=<code>&platform=win32|darwin */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { UpdateCheckDialog, UpdateNotesDialog, UpdateProblemDialog } from "../components/UpdateBanner";
import type { UpdaterState } from "../lib/updater";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.5.23", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const view = params.get("view") ?? "ready";
(window as unknown as { ogb: unknown }).ogb = { platform: params.get("platform") ?? "win32", updater: {} };

const notes = "## Mises à jour\n\n* **Rechercher des mises à jour** ouvre une fenêtre qui suit la vérification.\n* Windows : l'installateur affiche sa progression, puis Sagax se rouvre.\n\n## English\n\n## Updates\n\n* **Check for updates** opens a window that follows the check.";
const STATES: Record<string, UpdaterState> = {
  available: { status: "downloading", version: "0.5.24", notes },
  downloading: { status: "downloading", version: "0.5.24", percent: 62, notes },
  ready: { status: "downloaded", version: "0.5.24", notes },
  installing: { status: "installing", version: "0.5.24", notes },
  error: { status: "error", message: "net::ERR_INTERNET_DISCONNECTED" },
};
const noop = () => {};

function Gallery() {
  return (
    <div className="min-h-screen bg-app" data-gallery={view}>
      {view === "checking" && <UpdateCheckDialog checking onDismiss={noop} />}
      {view === "up-to-date" && <UpdateCheckDialog checking={false} onDismiss={noop} />}
      {view === "error" && <UpdateProblemDialog state={STATES.error} pending={null} onDismiss={noop} onRetry={noop} />}
      {STATES[view] && view !== "error" && (
        <UpdateNotesDialog state={STATES[view]} pending={view === "installing" ? "install" : null} onDismiss={noop} onUpdate={noop} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
