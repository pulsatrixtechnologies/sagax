/**
 * The Data window (experimental, Settings > Developer > Experimental > Data
 * window): a bot's Data results (DuckDB tables, charts and SQL,
 * src/components/data) in a window of their own, opened from the chat
 * header's Data button. One window per bot: asking again brings that bot's
 * window forward instead of opening a second one.
 *
 *   main renderer  --data-window:open {botId, title, cardId?}-->  main  -->  BrowserWindow(<page origin>/data-window#bot=…)
 *
 * The window draws the app's own page (the same origin, build and Content
 * Security Policy as the main window) on its `/data-window` route, in the
 * default session so the person's sign-in and the desktop's request header
 * apply as they do in the main window. It gets no preload at all: no
 * `window.ogb`, so it can call nothing in main, plus contextIsolation, a
 * sandbox and no Node. It may only navigate within its own route; any other
 * link goes to the system browser. Only the main window's own page may ask
 * for one, and only while the server says the experimental switch is on.
 */

export const DATA_WINDOW_PATH = "/data-window";
export const DATA_WINDOW_SIZE = Object.freeze({ width: 1180, height: 780 });
export const DATA_WINDOW_MIN = Object.freeze({ width: 640, height: 460 });
/** More Data windows than this at once is a mistake, not a desk. */
export const MAX_DATA_WINDOWS = 12;
const TITLE_MAX = 120;

/** Bot ids as the server mints them; anything else never names a window. */
const BOT_ID_RE = /^[a-zA-Z0-9:_-]{1,64}$/;
/** Data card ids (shared/data-surface.ts mints `c_` plus a random id). */
const CARD_ID_RE = /^[a-zA-Z0-9:_-]{1,128}$/;

const isString = (value) => Object.prototype.toString.call(value) === "[object String]";

/** The request as the renderer sent it, or null: a bot id, a short plain
 * title and an optional card to show first. */
export function sanitizeDataWindowRequest(raw) {
  if (!raw || typeof raw !== "object") return null;
  const botId = raw.botId;
  if (!isString(botId) || !BOT_ID_RE.test(botId)) return null;
  // eslint-disable-next-line no-control-regex
  const title = isString(raw.title) ? raw.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, TITLE_MAX) : "";
  const cardId = isString(raw.cardId) && CARD_ID_RE.test(raw.cardId) ? raw.cardId : undefined;
  return { botId, title: title || "Data", ...(cardId ? { cardId } : {}) };
}

/** The window's page: the asking page's own origin, on the Data route. */
export function dataWindowUrl(origin, botId, cardId) {
  const params = new URLSearchParams({ bot: botId });
  if (cardId) params.set("card", cardId);
  return `${origin}${DATA_WINDOW_PATH}#${params}`;
}

/** Whether `url` stays on the Data route of `origin` (a hash change does). */
export function dataWindowNavigationAllowed(url, origin) {
  try {
    const target = new URL(url);
    return target.origin === origin && target.pathname === DATA_WINDOW_PATH;
  } catch {
    return false;
  }
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
 * @param {(origin: string) => Promise<boolean>} deps.featureEnabled the server's `features.dataWindow`;
 *   rejects when the server could not be asked (no answer, not 2xx, not JSON)
 * @param {(url: string) => void} [deps.openExternal] a link out of the window (validated by the caller)
 * @param {() => unknown} [deps.icon]
 * @param {(line: string) => void} [deps.log]
 */
export function createDataWindows(deps) {
  const { BrowserWindow, ipcMain, getMainWindow, isTrustedMain, featureEnabled } = deps;
  const log = deps.log ?? (() => {});
  /** botId -> { win, origin } */
  const windows = new Map();

  const live = (botId) => {
    const entry = windows.get(botId);
    if (!entry) return null;
    if (entry.win.isDestroyed()) {
      windows.delete(botId);
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

  /** "created" or "focused"; "off" when the page's server answered that its
   * experimental switch is off; "unavailable" when the switch could not be
   * read (the server did not answer, or not with its config); "refused"
   * otherwise (not the main window's page, a bad request, too many windows).
   * Only "off" means the switch is off: the page says so only then. */
  async function open(event, raw) {
    if (!fromMainWindow(event)) return "refused";
    const request = sanitizeDataWindowRequest(raw);
    const origin = pageOrigin(event);
    if (!request || !origin) return "refused";
    let enabled;
    try {
      enabled = (await featureEnabled(origin)) === true;
    } catch (error) {
      log(`data window: could not read the experimental switch from ${origin} (${error?.message ?? error})`);
      return "unavailable";
    }
    if (!enabled) {
      log(`data window: ${origin} reports the experimental switch off`);
      return "off";
    }

    const existing = live(request.botId);
    if (existing && existing.origin === origin) {
      existing.win.setTitle?.(request.title);
      existing.title = request.title;
      bringForward(existing.win);
      return "focused";
    }
    // Another server's window for this bot id: it is not this bot's.
    if (existing) existing.win.close();
    if (windows.size >= MAX_DATA_WINDOWS) return "refused";

    const win = new BrowserWindow({
      width: DATA_WINDOW_SIZE.width,
      height: DATA_WINDOW_SIZE.height,
      minWidth: DATA_WINDOW_MIN.width,
      minHeight: DATA_WINDOW_MIN.height,
      resizable: true,
      show: false,
      title: request.title,
      ...(deps.icon ? { icon: deps.icon() } : {}),
      backgroundColor: "#070707",
      autoHideMenuBar: true,
      webPreferences: {
        // No preload: this page gets no bridge into main.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const entry = { win, origin, title: request.title };
    windows.set(request.botId, entry);

    win.once("ready-to-show", () => {
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
    });
    win.on("closed", () => {
      if (windows.get(request.botId)?.win === win) windows.delete(request.botId);
    });
    // The window keeps the title main gave it ("Data: <bot>").
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
      if (dataWindowNavigationAllowed(url, origin)) return;
      navigationEvent.preventDefault();
      leave(url);
    };
    win.webContents.on("will-navigate", guard);
    win.webContents.on("will-redirect", guard);

    void Promise.resolve(win.loadURL(dataWindowUrl(origin, request.botId, request.cardId))).catch((error) => {
      log(`data window: the page did not load (${error?.message ?? error})`);
    });
    return "created";
  }

  ipcMain.handle("data-window:open", (event, raw) => open(event, raw));

  return {
    open,
    /** Bot ids with a Data window open. */
    list: () => [...windows.keys()].filter((botId) => live(botId)),
    /** The main window now shows another server: its bots' windows go. */
    mainNavigated(url) {
      let origin = null;
      try {
        origin = new URL(url).origin;
      } catch {
        // an unparseable address closes every window below
      }
      for (const [botId, entry] of windows) {
        if (entry.origin === origin) continue;
        windows.delete(botId);
        if (!entry.win.isDestroyed()) entry.win.close();
      }
    },
    /** The app quits: every Data window closes with it. */
    closeAll() {
      for (const [botId, entry] of windows) {
        windows.delete(botId);
        if (!entry.win.isDestroyed()) entry.win.close();
      }
    },
    dispose() {
      ipcMain.removeHandler("data-window:open");
    },
  };
}
