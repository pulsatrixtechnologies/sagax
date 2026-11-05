/**
 * An artifact in a window of its own, outside the app's frame (#1140).
 *
 * Since 2026-10-28 this is the only way an artifact opens in the desktop app
 * (src/components/artifacts/artifact-windows.ts): a real desktop window that
 * can be moved beside the app, resized and put on another monitor, never a
 * panel drawn inside Sagax's window. One window per artifact: asking again
 * brings it forward. Page windows reuse this bridge with an `artifactId` of
 * `page:<pageId>`; the renderer keeps those apart (isPageWindowId).
 *
 *   main renderer  --artifact-window:open {botId, artifactId, title, width?, height?}-->  main
 *                  -->  BrowserWindow(<page origin>/artifact-window#bot=…&artifact=…)
 *   person closes it  -->  main  --artifact-window:closed {artifactId}-->  main renderer (docks it)
 *
 * The window draws the app's own page (same origin, build and Content Security
 * Policy as the main window) on its `/artifact-window` route, in the default
 * session so the person's sign-in applies as it does in the main window. It
 * gets a narrow preload (`artifact-window-preload.cjs`) that exposes
 * always-on-top (`window.artifactWindowSelf`, #2046), OS fullscreen
 * (`window.ogb.windowFullscreen`, #2043), and fit-to-content for page
 * windows (`artifactWindowSelf.fitContent`, #2051): no file, no network,
 * no other window. contextIsolation, a sandbox and no Node stay on. It may
 * only navigate within its own route; any other link goes to the system
 * browser. Only the main window's own page may ask for one (open/close);
 * the window itself may toggle always-on-top and OS fullscreen, and a page
 * window may ask to fit to its content.
 *
 * Each artifact's window keeps its place: its bounds (whether it was
 * maximized, and whether always-on-top was on) are saved per artifact id
 * through `boundsStore` and put back the next time it opens. A place on a
 * screen that is gone comes back on the primary screen (window-state.cjs). A
 * request may name a screen point (`x`, `y`) to open at. The windows go with
 * the main window: they are driven by its page, so none is left behind to keep
 * the app from quitting. `onChange` tells main the list changed, so the Window
 * menu names them.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { attachFullscreenPush } from "./window-fullscreen.mjs";

const require = createRequire(import.meta.url);
const { resolveWindowState } = require("./window-state.cjs");

/** Narrow preload: always-on-top (#2046), OS fullscreen (#2043), fit-to-content (#2051). Overridable in tests. */
export const ARTIFACT_WINDOW_PRELOAD = fileURLToPath(new URL("./artifact-window-preload.cjs", import.meta.url));

export const ARTIFACT_WINDOW_PATH = "/artifact-window";
export const ARTIFACT_WINDOW_SIZE = Object.freeze({ width: 960, height: 720 });
export const ARTIFACT_WINDOW_MIN = Object.freeze({ width: 320, height: 240 });
/** First-open width for a page window that still auto-fits (#2051). */
export const PAGE_WINDOW_FIT_DEFAULT_WIDTH = 720;
/** Wait this long for a content measure before showing a page window anyway. */
export const PAGE_WINDOW_FIT_SHOW_MS = 2_000;
/** More artifact windows than this at once is a mistake, not a desk. */
export const MAX_ARTIFACT_WINDOWS = 24;
/** Places remembered: the most recently used artifacts. */
export const MAX_REMEMBERED_PLACES = 100;
const SCREEN_LIMIT = 100_000;
const TITLE_MAX = 120;
const PAGE_WINDOW_PREFIX = "page:";

const ID_RE = /^[a-zA-Z0-9:_-]{1,128}$/;

const isString = (value) => Object.prototype.toString.call(value) === "[object String]";

/** Whether this desktop window id is a published page (`page:<pageId>`). */
export function isPageWindowArtifactId(artifactId) {
  return isString(artifactId) && artifactId.startsWith(PAGE_WINDOW_PREFIX);
}
const clampSize = (value, fallback, min) =>
  Number.isFinite(value) ? Math.min(4000, Math.max(min, Math.round(value))) : fallback;
const screenCoordinate = (value) =>
  Number.isFinite(value) && Math.abs(value) <= SCREEN_LIMIT ? Math.round(value) : null;

/** The request as the renderer sent it, or null: the bot and artifact ids, a
 * short plain title, an optional size, an optional screen point to open at
 * (`x`, `y`), `focus` (false: open or keep it without taking the focus, as when
 * the app restores its windows) and optional `alwaysOnTop` (#2046). */
export function sanitizeArtifactWindowRequest(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { botId, artifactId } = raw;
  if (!isString(botId) || !ID_RE.test(botId) || !isString(artifactId) || !ID_RE.test(artifactId)) return null;
  // eslint-disable-next-line no-control-regex
  const title = isString(raw.title) ? raw.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, TITLE_MAX) : "";
  const x = screenCoordinate(raw.x);
  const y = screenCoordinate(raw.y);
  return {
    botId,
    artifactId,
    title: title || "Artifact",
    width: clampSize(raw.width, ARTIFACT_WINDOW_SIZE.width, ARTIFACT_WINDOW_MIN.width),
    height: clampSize(raw.height, ARTIFACT_WINDOW_SIZE.height, ARTIFACT_WINDOW_MIN.height),
    ...(x !== null && y !== null ? { at: { x, y } } : {}),
    focus: raw.focus !== false,
    ...(typeof raw.alwaysOnTop === "boolean" ? { alwaysOnTop: raw.alwaysOnTop } : {}),
  };
}

const integerRect = (value) =>
  value && typeof value === "object" &&
  [value.x, value.y, value.width, value.height].every((n) => Number.isInteger(n) && Math.abs(n) <= SCREEN_LIMIT) &&
  value.width > 0 && value.height > 0;

/** The saved places, artifact id -> { bounds, maximized, alwaysOnTop, personSized? },
 * oldest first. Anything malformed is dropped. `personSized` means the person
 * chose the size and auto-fit must stop for that page (#2051). */
export function parseArtifactWindowPlaces(raw) {
  const places = new Map();
  const value = raw && typeof raw === "object" ? raw.windows : null;
  if (!value || typeof value !== "object") return places;
  for (const [artifactId, place] of Object.entries(value)) {
    if (!ID_RE.test(artifactId) || !place || typeof place !== "object" || !integerRect(place.bounds)) continue;
    const { x, y, width, height } = place.bounds;
    places.set(artifactId, {
      bounds: { x, y, width, height },
      maximized: place.maximized === true,
      alwaysOnTop: place.alwaysOnTop === true,
      ...(place.personSized === true ? { personSized: true } : {}),
    });
  }
  while (places.size > MAX_REMEMBERED_PLACES) places.delete(places.keys().next().value);
  return places;
}

/** Apply always-on-top the way floating bots do (level "floating" when on). */
export function applyArtifactWindowOnTop(win, on) {
  if (!win || win.isDestroyed?.()) return false;
  try {
    if (on) win.setAlwaysOnTop(true, "floating");
    else win.setAlwaysOnTop(false);
    return true;
  } catch {
    return false;
  }
}

export function serializeArtifactWindowPlaces(places) {
  return { version: 1, windows: Object.fromEntries(places) };
}

const contains = (area, point) =>
  point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height;
const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

/** Clamp a fitted page size into the work area and keep the top-left on screen. */
export function fitPageWindowBounds(current, size, workArea) {
  if (!integerRect(workArea) || !size || typeof size !== "object") return null;
  const width = Math.min(Math.max(ARTIFACT_WINDOW_MIN.width, Math.round(size.width)), workArea.width);
  const height = Math.min(Math.max(ARTIFACT_WINDOW_MIN.height, Math.round(size.height)), workArea.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const x0 = Number.isFinite(current?.x) ? Math.round(current.x) : workArea.x;
  const y0 = Number.isFinite(current?.y) ? Math.round(current.y) : workArea.y;
  return {
    x: clamp(x0, workArea.x, workArea.x + workArea.width - width),
    y: clamp(y0, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  };
}

/**
 * Where an artifact's window opens. `workAreas` puts the primary screen first;
 * `home` is the work area of the screen the app is on.
 * - Let go at a screen point: there, its title bar under the pointer, on that
 *   point's screen (its remembered size, else the asked one).
 * - A remembered place: back there, kept on a screen that still exists, else
 *   on the primary screen.
 * - Else: the asked size, centered on the app's screen.
 */
export function resolveArtifactWindowBounds({ place, workAreas, home, request }) {
  const areas = (workAreas ?? []).filter(integerRect);
  const size = {
    width: place?.bounds.width ?? request.width,
    height: place?.bounds.height ?? request.height,
  };
  if (request.at && areas.length > 0) {
    const area = areas.find((candidate) => contains(candidate, request.at)) ?? areas[0];
    const width = Math.min(Math.max(size.width, ARTIFACT_WINDOW_MIN.width), area.width);
    const height = Math.min(Math.max(size.height, ARTIFACT_WINDOW_MIN.height), area.height);
    return {
      bounds: {
        x: clamp(request.at.x - Math.round(width / 2), area.x, area.x + area.width - width),
        y: clamp(request.at.y - 16, area.y, area.y + area.height - height),
        width,
        height,
      },
      maximized: false,
    };
  }
  if (place) return resolveWindowState(place, areas, request, ARTIFACT_WINDOW_MIN);
  const area = integerRect(home) ? home : areas[0];
  if (!area) return { bounds: { width: request.width, height: request.height }, maximized: false };
  const width = Math.min(request.width, area.width);
  const height = Math.min(request.height, area.height);
  return {
    bounds: {
      x: area.x + Math.round((area.width - width) / 2),
      y: area.y + Math.round((area.height - height) / 2),
      width,
      height,
    },
    maximized: false,
  };
}

/** The window's page: the asking page's own origin, on the artifact route. */
export function artifactWindowUrl(origin, botId, artifactId) {
  const params = new URLSearchParams({ bot: botId, artifact: artifactId });
  return `${origin}${ARTIFACT_WINDOW_PATH}#${params}`;
}

/** Whether `url` stays on the artifact route of `origin` (a hash change does). */
export function artifactWindowNavigationAllowed(url, origin) {
  try {
    const target = new URL(url);
    return target.origin === origin && target.pathname === ARTIFACT_WINDOW_PATH;
  } catch {
    return false;
  }
}

/**
 * A claude.ai artifact (#2018) in a window of its own: the claude.ai page
 * itself, in a persistent session of its own so the person's claude.ai
 * sign-in stays from one opening to the next. It never shares the app's
 * session, gets no preload, and may only navigate on claude.ai and the hosts
 * its sign-in goes through; any other link goes to the system browser.
 */
export const CLAUDE_AI_PARTITION = "persist:claude-ai";
const CLAUDE_AI_PATH_RE = /^\/(code\/)?artifact\/([A-Za-z0-9-]{8,64})\/?$/;
/** claude.ai and the sign-in hosts it sends the person through. */
const CLAUDE_AI_HOSTS = ["claude.ai", "claude.com", "anthropic.com"];
const CLAUDE_AI_AUTH_HOSTS = new Set(["accounts.google.com", "appleid.apple.com"]);

/** The canonical https://claude.ai/[code/]artifact/<id> URL of `raw`, or null. */
export function claudeAiArtifactUrl(raw) {
  if (!isString(raw)) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.hostname !== "claude.ai" && url.hostname !== "www.claude.ai") return null;
  const match = CLAUDE_AI_PATH_RE.exec(url.pathname);
  if (!match) return null;
  return `https://claude.ai/${match[1] ?? ""}artifact/${match[2]}`;
}

/** Whether the claude.ai window may go to `url`: https on claude.ai (and its
 * subdomains, claude.com, anthropic.com) or a sign-in host. */
export function claudeAiNavigationAllowed(url) {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password) return false;
    const host = target.hostname.toLowerCase();
    if (CLAUDE_AI_AUTH_HOSTS.has(host)) return true;
    return CLAUDE_AI_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

/** What a claude.ai page may ask of its session: copy to the clipboard and
 * full screen, nothing else (no camera, microphone, location, notifications). */
export function claudeAiPermissionAllowed(permission) {
  return permission === "clipboard-sanitized-write" || permission === "fullscreen";
}

function pageOrigin(event) {
  const url = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
  try {
    const origin = new URL(url).origin;
    return origin && origin !== "null" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} deps
 * @param {typeof import("electron").BrowserWindow} deps.BrowserWindow
 * @param {import("electron").IpcMain} deps.ipcMain
 * @param {() => import("electron").BrowserWindow | null} deps.getMainWindow
 * @param {(event: import("electron").IpcMainInvokeEvent) => boolean} deps.isTrustedMain
 * @param {(url: string) => void} [deps.openExternal] a link out of the window (validated by the caller)
 * @param {() => unknown} [deps.icon]
 * @param {(line: string) => void} [deps.log]
 * @param {Pick<import("electron").Screen, "getPrimaryDisplay" | "getAllDisplays" | "getDisplayMatching">} [deps.screen]
 * @param {{ read(): unknown, write(value: unknown): void }} [deps.boundsStore] where each artifact's place is kept
 * @param {() => void} [deps.onChange] the open windows or their titles changed (the Window menu)
 * @param {Pick<typeof import("electron").session, "fromPartition">} [deps.session] the claude.ai window's persistent session
 * @param {string} [deps.preload] absolute path of artifact-window-preload.cjs (#2046, #2043, #2051)
 */
export function createArtifactWindows(deps) {
  const { BrowserWindow, ipcMain, getMainWindow, isTrustedMain } = deps;
  const preload = typeof deps.preload === "string" && deps.preload ? deps.preload : ARTIFACT_WINDOW_PRELOAD;
  const log = deps.log ?? (() => {});
  const changed = () => {
    try {
      deps.onChange?.();
    } catch (error) {
      log(`artifact window: the menu did not update (${error?.message ?? error})`);
    }
  };
  /** artifactId -> { win, origin, botId, title, quiet, onTop, personSized, applyingFit, revealed, autoFit } */
  const windows = new Map();
  let places = null;
  const readPlaces = () => {
    if (places) return places;
    try {
      places = parseArtifactWindowPlaces(deps.boundsStore?.read());
    } catch {
      places = new Map();
    }
    return places;
  };
  const writePlaces = () => {
    try {
      deps.boundsStore?.write(serializeArtifactWindowPlaces(readPlaces()));
    } catch (error) {
      log(`artifact window: its place was not saved (${error?.message ?? error})`);
    }
  };
  const remember = (artifactId, win, { onTop = false, personSized = false } = {}) => {
    if (win.isDestroyed()) return;
    // A full-screen window keeps the place it had before.
    if (win.isFullScreen?.()) return;
    const bounds = win.getNormalBounds?.() ?? win.getBounds?.();
    if (!integerRect(bounds)) return;
    const all = readPlaces();
    const prior = all.get(artifactId);
    all.delete(artifactId); // re-inserted last: the most recent are kept
    all.set(artifactId, {
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      maximized: win.isMaximized?.() === true,
      alwaysOnTop: onTop === true,
      ...((personSized || prior?.personSized === true) ? { personSized: true } : {}),
    });
    while (all.size > MAX_REMEMBERED_PLACES) all.delete(all.keys().next().value);
    writePlaces();
  };
  const entryForSender = (event) => {
    const sender = event?.sender;
    if (!sender) return null;
    for (const artifactId of windows.keys()) {
      const liveEntry = live(artifactId);
      if (liveEntry && liveEntry.win.webContents === sender) return { artifactId, entry: liveEntry };
    }
    return null;
  };
  const setOnTop = (entry, artifactId, on) => {
    if (!entry) return false;
    const next = on === true;
    if (!applyArtifactWindowOnTop(entry.win, next)) return false;
    entry.onTop = next;
    remember(artifactId, entry.win, { onTop: next, personSized: entry.personSized === true });
    return true;
  };
  const screenAreas = () => {
    try {
      const primary = deps.screen?.getPrimaryDisplay();
      if (!primary) return [];
      const others = deps.screen.getAllDisplays().filter((display) => display.id !== primary.id);
      return [primary, ...others].map((display) => display.workArea);
    } catch {
      return [];
    }
  };
  const homeArea = () => {
    try {
      const main = getMainWindow();
      if (!main || main.isDestroyed() || !deps.screen?.getDisplayMatching) return null;
      return deps.screen.getDisplayMatching(main.getBounds()).workArea;
    } catch {
      return null;
    }
  };

  const live = (artifactId) => {
    const entry = windows.get(artifactId);
    if (!entry) return null;
    if (entry.win.isDestroyed()) {
      windows.delete(artifactId);
      return null;
    }
    return entry;
  };

  const bringForward = (win) => {
    if (win.isMinimized?.()) win.restore?.();
    win.show?.();
    win.focus?.();
  };

  const fromMainWindow = (event) => {
    if (!isTrustedMain(event)) return false;
    const main = getMainWindow();
    return Boolean(main && !main.isDestroyed() && event?.sender === main.webContents);
  };

  const closeQuietly = (artifactId) => {
    const entry = windows.get(artifactId);
    if (!entry) return;
    windows.delete(artifactId);
    entry.quiet = true;
    if (!entry.win.isDestroyed()) entry.win.close();
  };

  /** "created" or "focused", or "refused" (not the main window's page, a bad
   * request, too many windows). */
  function open(event, raw) {
    if (!fromMainWindow(event)) return "refused";
    const request = sanitizeArtifactWindowRequest(raw);
    const origin = pageOrigin(event);
    if (!request || !origin) return "refused";

    const existing = live(request.artifactId);
    if (existing && existing.origin === origin) {
      if (existing.title !== request.title) {
        existing.win.setTitle?.(request.title);
        existing.title = request.title;
        changed();
      }
      if (typeof request.alwaysOnTop === "boolean" && existing.onTop !== request.alwaysOnTop) {
        setOnTop(existing, request.artifactId, request.alwaysOnTop);
      }
      if (request.focus) bringForward(existing.win);
      return "focused";
    }
    // Another server's window for this artifact id: it is not this artifact's.
    if (existing) closeQuietly(request.artifactId);
    if (windows.size >= MAX_ARTIFACT_WINDOWS) return "refused";

    const pageWindow = isPageWindowArtifactId(request.artifactId);
    const place = readPlaces().get(request.artifactId);
    const personSized = pageWindow && place?.personSized === true;
    const autoFit = pageWindow && !personSized;
    const openRequest = autoFit
      ? { ...request, width: PAGE_WINDOW_FIT_DEFAULT_WIDTH, height: Math.max(ARTIFACT_WINDOW_MIN.height, Math.min(request.height, 480)) }
      : request;
    const placed = resolveArtifactWindowBounds({
      place,
      workAreas: screenAreas(),
      home: homeArea(),
      request: openRequest,
    });
    const onTop = typeof request.alwaysOnTop === "boolean" ? request.alwaysOnTop : place?.alwaysOnTop === true;
    const win = new BrowserWindow({
      ...placed.bounds,
      minWidth: ARTIFACT_WINDOW_MIN.width,
      minHeight: ARTIFACT_WINDOW_MIN.height,
      resizable: true,
      movable: true,
      minimizable: true,
      maximizable: true,
      // macOS: its own Space in full screen, from the green button or the menu
      fullscreenable: true,
      show: false,
      title: request.title,
      alwaysOnTop: onTop,
      ...(deps.icon ? { icon: deps.icon() } : {}),
      backgroundColor: "#070707",
      autoHideMenuBar: true,
      webPreferences: {
        // Narrow preload: always-on-top (#2046), OS fullscreen (#2043), fit (#2051).
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const entry = {
      win,
      origin,
      botId: request.botId,
      title: request.title,
      quiet: false,
      onTop,
      personSized,
      applyingFit: false,
      revealed: false,
      autoFit,
      focusOnReveal: request.focus !== false,
      showTimer: null,
      reveal: null,
    };
    entry.reveal = () => {
      if (entry.revealed || win.isDestroyed()) return;
      entry.revealed = true;
      if (entry.showTimer) {
        clearTimeout(entry.showTimer);
        entry.showTimer = null;
      }
      if (!entry.focusOnReveal && win.showInactive) {
        win.showInactive();
        return;
      }
      win.show();
      win.focus();
    };
    windows.set(request.artifactId, entry);
    if (onTop) applyArtifactWindowOnTop(win, true);
    if (placed.maximized) win.maximize?.();
    attachFullscreenPush(win);

    win.once("ready-to-show", () => {
      if (win.isDestroyed()) return;
      if (entry.autoFit) {
        // Fit before show: wait for the page to measure, else show on timeout.
        entry.showTimer = setTimeout(() => entry.reveal?.(), PAGE_WINDOW_FIT_SHOW_MS);
        entry.showTimer.unref?.();
        return;
      }
      entry.reveal?.();
    });
    // Its place is kept as the person moves and sizes it, and when it closes.
    let saveTimer = null;
    const saveSoon = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        remember(request.artifactId, win, { onTop: entry.onTop, personSized: entry.personSized === true });
      }, 400);
      saveTimer.unref?.();
    };
    win.on("move", saveSoon);
    win.on("maximize", saveSoon);
    win.on("unmaximize", saveSoon);
    win.on("resize", () => {
      if (entry.applyingFit) {
        saveSoon();
        return;
      }
      if (entry.autoFit) {
        entry.personSized = true;
        entry.autoFit = false;
      }
      saveSoon();
    });
    win.on("close", () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      if (entry.showTimer) {
        clearTimeout(entry.showTimer);
        entry.showTimer = null;
      }
      remember(request.artifactId, win, { onTop: entry.onTop, personSized: entry.personSized === true });
    });
    win.on("closed", () => {
      if (saveTimer) clearTimeout(saveTimer);
      if (entry.showTimer) {
        clearTimeout(entry.showTimer);
        entry.showTimer = null;
      }
      if (windows.get(request.artifactId)?.win === win) windows.delete(request.artifactId);
      changed();
      if (entry.quiet) return;
      // The person closed it: the page docks the artifact, as closing its
      // floating window does.
      const main = getMainWindow();
      if (main && !main.isDestroyed()) {
        main.webContents.send("artifact-window:closed", { botId: request.botId, artifactId: request.artifactId });
      }
    });
    // The window keeps the title main gave it.
    win.on("page-title-updated", (titleEvent) => {
      titleEvent.preventDefault();
      if (!win.isDestroyed()) win.setTitle(entry.title);
    });
    const leave = (url) => {
      try {
        const target = new URL(url);
        // The app's own other pages stay in the app; the web goes out.
        if (target.origin === origin) return;
        if (target.protocol === "http:" || target.protocol === "https:") deps.openExternal?.(target.toString());
      } catch {
        // not a web link: nothing to open
      }
    };
    win.webContents.setWindowOpenHandler(({ url }) => {
      leave(url);
      return { action: "deny" };
    });
    const guard = (navigationEvent, url) => {
      if (artifactWindowNavigationAllowed(url, origin)) return;
      navigationEvent.preventDefault();
      leave(url);
    };
    win.webContents.on("will-navigate", guard);
    win.webContents.on("will-redirect", guard);
    // A published page is framed here too (PageSurface): its frame is
    // guarded and noted for the bundled UI handler like in every other
    // window, by electron/page-frames.mjs (installed once by main), so
    // nothing about page frames is done here.

    void Promise.resolve(win.loadURL(artifactWindowUrl(origin, request.botId, request.artifactId))).catch((error) => {
      log(`artifact window: the page did not load (${error?.message ?? error})`);
    });
    changed();
    return "created";
  }

  /** claude.ai windows, canonical url -> BrowserWindow. */
  const claudeWindows = new Map();
  let claudeSessionReady = false;
  const claudeSession = () => {
    if (claudeSessionReady) return;
    claudeSessionReady = true;
    try {
      const shared = deps.session?.fromPartition?.(CLAUDE_AI_PARTITION);
      shared?.setPermissionCheckHandler?.((_webContents, permission) => claudeAiPermissionAllowed(permission));
      shared?.setPermissionRequestHandler?.((_webContents, permission, callback) => callback(claudeAiPermissionAllowed(permission)));
    } catch (error) {
      log(`claude.ai window: its session was not set up (${error?.message ?? error})`);
    }
  };

  /** "created" or "focused", or "refused" (not the main window's page, not a
   * claude.ai artifact, too many windows). */
  function openClaudeAi(event, raw) {
    if (!fromMainWindow(event)) return "refused";
    const url = claudeAiArtifactUrl(raw && typeof raw === "object" ? raw.url : undefined);
    if (!url) return "refused";
    const existing = claudeWindows.get(url);
    if (existing && !existing.isDestroyed()) {
      bringForward(existing);
      return "focused";
    }
    claudeWindows.delete(url);
    if (claudeWindows.size + windows.size >= MAX_ARTIFACT_WINDOWS) return "refused";
    claudeSession();
    const placed = resolveArtifactWindowBounds({
      place: undefined,
      workAreas: screenAreas(),
      home: homeArea(),
      request: { width: ARTIFACT_WINDOW_SIZE.width, height: ARTIFACT_WINDOW_SIZE.height },
    });
    const win = new BrowserWindow({
      ...placed.bounds,
      minWidth: ARTIFACT_WINDOW_MIN.width,
      minHeight: ARTIFACT_WINDOW_MIN.height,
      resizable: true,
      movable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: true,
      show: false,
      title: "Claude",
      ...(deps.icon ? { icon: deps.icon() } : {}),
      autoHideMenuBar: true,
      webPreferences: {
        // The person's claude.ai sign-in lives in this session, apart from the app's.
        partition: CLAUDE_AI_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    claudeWindows.set(url, win);
    win.once("ready-to-show", () => {
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
    });
    win.on("closed", () => {
      if (claudeWindows.get(url) === win) claudeWindows.delete(url);
    });
    const leave = (target) => {
      try {
        const parsed = new URL(target);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") deps.openExternal?.(parsed.toString());
      } catch {
        // not a web link: nothing to open
      }
    };
    // A sign-in popup on an allowed host opens in this session; any other
    // link goes to the system browser.
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (claudeAiNavigationAllowed(target)) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: { partition: CLAUDE_AI_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
          },
        };
      }
      leave(target);
      return { action: "deny" };
    });
    const guard = (navigationEvent, target) => {
      if (claudeAiNavigationAllowed(target)) return;
      navigationEvent.preventDefault();
      leave(target);
    };
    win.webContents.on("will-navigate", guard);
    win.webContents.on("will-redirect", guard);
    void Promise.resolve(win.loadURL(url)).catch((error) => {
      log(`claude.ai window: the page did not load (${error?.message ?? error})`);
    });
    return "created";
  }

  const closeClaudeWindows = () => {
    for (const win of claudeWindows.values()) {
      if (!win.isDestroyed()) win.close();
    }
    claudeWindows.clear();
  };

  /** The page docked or deleted the artifact: its window goes, without
   * telling the page it was closed. */
  function close(event, raw) {
    if (!fromMainWindow(event)) return false;
    const artifactId = raw && typeof raw === "object" ? raw.artifactId : undefined;
    if (!isString(artifactId) || !ID_RE.test(artifactId)) return false;
    closeQuietly(artifactId);
    return true;
  }

  /** Always-on-top for this window (#2046). The window itself may toggle (no
   * artifactId: sender must be that window). The main window may name an
   * artifactId. */
  function setTop(event, raw) {
    const on = raw && typeof raw === "object" ? raw.on === true : false;
    const named = raw && typeof raw === "object" && isString(raw.artifactId) && ID_RE.test(raw.artifactId) ? raw.artifactId : null;
    if (named) {
      if (!fromMainWindow(event)) return false;
      return setOnTop(live(named), named, on);
    }
    const found = entryForSender(event);
    if (!found) return false;
    return setOnTop(found.entry, found.artifactId, on);
  }

  function getTop(event, raw) {
    const named = raw && typeof raw === "object" && isString(raw.artifactId) && ID_RE.test(raw.artifactId) ? raw.artifactId : null;
    if (named) {
      if (!fromMainWindow(event)) return false;
      return live(named)?.onTop === true;
    }
    return entryForSender(event)?.entry.onTop === true;
  }

  /** The page window that sent this event, or null. */
  const senderPageWindow = (event) => {
    if (!event?.sender) return null;
    for (const artifactId of windows.keys()) {
      if (!isPageWindowArtifactId(artifactId)) continue;
      const liveEntry = live(artifactId);
      if (liveEntry && liveEntry.win.webContents === event.sender) return { artifactId, entry: liveEntry };
    }
    return null;
  };

  /** Size a page window to its content (#2051). Only that window may ask, and
   * only while auto-fit is still on (the person has not resized by hand).
   * Skip while fullscreen or maximized so auto-fit never fights OS fullscreen. */
  function fitContent(event, raw) {
    const found = senderPageWindow(event);
    if (!found || !raw || typeof raw !== "object") return null;
    const { entry } = found;
    if (!entry.autoFit || entry.personSized || entry.win.isDestroyed()) return null;
    if (entry.win.isMaximized?.() || entry.win.isFullScreen?.()) return null;
    const areas = screenAreas();
    const bounds = entry.win.getBounds?.() ?? entry.win.getNormalBounds?.();
    const area = (() => {
      try {
        if (deps.screen?.getDisplayMatching && bounds) return deps.screen.getDisplayMatching(bounds).workArea;
      } catch {
        // fall through to the primary work area
      }
      return areas[0];
    })();
    if (!integerRect(area) || !integerRect(bounds)) return null;
    const next = fitPageWindowBounds(bounds, { width: raw.width, height: raw.height }, area);
    if (!next) return null;
    const same =
      next.width === bounds.width && next.height === bounds.height && next.x === bounds.x && next.y === bounds.y;
    if (!same) {
      entry.applyingFit = true;
      try {
        entry.win.setBounds?.(next);
      } finally {
        entry.applyingFit = false;
      }
    }
    entry.reveal?.();
    return next;
  }

  ipcMain.handle("artifact-window:open", (event, raw) => open(event, raw));
  ipcMain.handle("artifact-window:close", (event, raw) => close(event, raw));
  ipcMain.handle("artifact-window:open-claude-ai", (event, raw) => openClaudeAi(event, raw));
  ipcMain.handle("artifact-window:set-top", (event, raw) => setTop(event, raw));
  ipcMain.handle("artifact-window:get-top", (event, raw) => getTop(event, raw));
  ipcMain.handle("artifact-window:fit-content", (event, raw) => fitContent(event, raw));

  return {
    open,
    close,
    openClaudeAi,
    setTop,
    getTop,
    fitContent,
    /** Artifact ids with a window open. */
    list: () => [...windows.keys()].filter((artifactId) => live(artifactId)),
    /** The open windows for the Window menu, in the order they opened. */
    entries: () => [...windows.keys()].flatMap((artifactId) => {
      const entry = live(artifactId);
      return entry ? [{ artifactId, title: entry.title }] : [];
    }),
    /** The Window menu picked one: it comes forward. */
    show(artifactId) {
      const entry = live(artifactId);
      if (!entry) return false;
      bringForward(entry.win);
      return true;
    },
    /** The main window is gone: its page drove these windows, so they go too
     * (quietly: the artifacts stay popped out and come back with it). */
    mainWindowGone() {
      for (const artifactId of windows.keys()) closeQuietly(artifactId);
    },
    /** The main window now shows another server: its artifacts' windows go. */
    mainNavigated(url) {
      let origin = null;
      try {
        origin = new URL(url).origin;
      } catch {
        // an unparseable address closes every window below
      }
      for (const [artifactId, entry] of windows) {
        if (entry.origin !== origin) closeQuietly(artifactId);
      }
    },
    /** The app quits: every artifact window closes with it. */
    closeAll() {
      for (const artifactId of windows.keys()) closeQuietly(artifactId);
      closeClaudeWindows();
    },
    dispose() {
      ipcMain.removeHandler("artifact-window:open");
      ipcMain.removeHandler("artifact-window:close");
      ipcMain.removeHandler("artifact-window:open-claude-ai");
      ipcMain.removeHandler("artifact-window:set-top");
      ipcMain.removeHandler("artifact-window:get-top");
      ipcMain.removeHandler("artifact-window:fit-content");
    },
  };
}
