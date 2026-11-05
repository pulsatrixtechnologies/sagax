/**
 * OS fullscreen for any BrowserWindow that asked (#2043): setFullScreen on
 * the sender's own window, and push enter/leave-full-screen so the page label
 * can toggle Full screen / Exit full screen from the real state.
 */

/** Wire enter/leave-full-screen pushes to the window's page(s).
 * `contentsFor` may return every account page of the main window. */
export function attachFullscreenPush(win, contentsFor) {
  if (!win || typeof win.on !== "function") return;
  const push = () => {
    if (win.isDestroyed?.()) return;
    const fullscreen = win.isFullScreen?.() === true;
    const pages = typeof contentsFor === "function"
      ? contentsFor()
      : [win.webContents];
    for (const page of pages ?? []) {
      try {
        if (page && !page.isDestroyed?.()) page.send("window:fullscreen-changed", fullscreen);
      } catch {
        // the page is gone: nothing to push
      }
    }
  };
  win.on("enter-full-screen", push);
  win.on("leave-full-screen", push);
}

/** Enter or leave OS fullscreen on this window. */
export function setWindowFullScreen(win, on) {
  if (!win || win.isDestroyed?.()) return false;
  if (typeof win.setFullScreen !== "function") return false;
  win.setFullScreen(on === true);
  return true;
}

/** Current OS fullscreen state of this window. */
export function windowFullScreenState(win) {
  return { fullscreen: Boolean(win && !win.isDestroyed?.() && win.isFullScreen?.() === true) };
}
