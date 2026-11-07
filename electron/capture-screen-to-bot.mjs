import { capturePermission, captureThumbnailSize, pickCaptureSource } from "./screen-capture-hotkey.mjs";

/** The bots' screenshot chord: one picture of the screen under the pointer,
 * handed to the main page (moved out of main.mjs). */
export function createScreenCaptureToBot({ getWindow, getPage, screen, desktopCapturer, systemPreferences, platform, slog }) {
  return async function captureScreenToBot() {
    const win = getWindow();
    if (!win) return;
    let png = null;
    // macOS hands back the wallpaper alone when Screen Recording is refused: say so instead
    const refused = capturePermission(platform, () => systemPreferences.getMediaAccessStatus("screen")) === "denied";
    if (!refused) {
      try {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: captureThumbnailSize(display) });
        const image = pickCaptureSource(sources, display.id)?.thumbnail;
        if (image && !image.isEmpty()) png = image.toPNG();
      } catch (error) {
        slog(`capture hotkey: the screen could not be captured (${error?.name ?? "error"})`);
      }
    }
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    (getPage() ?? win.webContents).send("desktop:screen-capture", png
      ? { png: png.toString("base64") }
      : { error: refused ? "permission" : "unavailable", platform });
  };
}
