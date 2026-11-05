// Sagax secondary-monitor agent cursor. Cua Driver still draws only on the
// primary macOS display (trycua/cua#5336); when the agent point sits on another
// display, Electron paints a small click-through overlay there so the person
// can follow the action.

import net from "node:net";
import {
  needsSecondaryAgentCursor,
  normalizeCursorDisplays,
  planSecondaryAgentCursor,
} from "./agent-cursor-displays.mjs";

const POLL_MS = 50;
const SOCKET_TIMEOUT_MS = 400;
const OVERLAY_TITLE = "Sagax agent cursor";

const CURSOR_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
svg{display:block;width:48px;height:48px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.45))}
</style></head><body>
<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M6 4 L6 36 L16 28 L22 42 L28 39 L22 25 L34 25 Z" fill="#f4f4f5" stroke="#18181b" stroke-width="1.5" stroke-linejoin="round"/>
</svg>
</body></html>`;

function requestSocket(socketPath, request, { timeoutMs = SOCKET_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    let data = Buffer.alloc(0);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      const newline = data.indexOf(0x0a);
      if (newline === -1) return;
      try {
        finish(resolve, JSON.parse(data.subarray(0, newline).toString("utf8")));
      } catch (error) {
        finish(reject, error);
      }
    });
    socket.once("error", (error) => finish(reject, error));
    const timer = setTimeout(
      () => finish(reject, Object.assign(new Error("agent cursor socket timed out"), { code: "timeout" })),
      timeoutMs,
    );
    timer.unref?.();
  });
}

function readCursorPoint(response) {
  const result = response?.ok === true ? response.result : response?.result ?? response;
  const position = result?.position ?? result;
  const x = position?.x;
  const y = position?.y;
  if (![x, y].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return { x, y };
}

function overlayDataUrl() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(CURSOR_HTML)}`;
}

/**
 * @param {{
 *   BrowserWindow: typeof import("electron").BrowserWindow,
 *   screen: typeof import("electron").screen,
 *   platform?: string,
 *   request?: typeof requestSocket,
 *   pollMs?: number,
 * }} deps
 */
export function createAgentCursorOverlay(deps) {
  const BrowserWindow = deps.BrowserWindow;
  const screen = deps.screen;
  const platform = deps.platform ?? process.platform;
  const request = deps.request ?? requestSocket;
  const pollMs = deps.pollMs ?? POLL_MS;

  /** @type {import("electron").BrowserWindow | null} */
  let win = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let socketPath = null;
  let lastBoundsKey = "";
  let running = false;

  function live() {
    return win != null && !win.isDestroyed();
  }

  function hide() {
    lastBoundsKey = "";
    if (!live()) {
      win = null;
      return;
    }
    try {
      win.hide();
    } catch {
      /* ignore */
    }
  }

  function destroyWindow() {
    if (!live()) {
      win = null;
      return;
    }
    try {
      win.destroy();
    } catch {
      /* ignore */
    }
    win = null;
    lastBoundsKey = "";
  }

  function ensureWindow(bounds) {
    if (!live()) {
      win = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        title: OVERLAY_TITLE,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      try {
        win.setAlwaysOnTop(true, "screen-saver");
        win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
        win.setIgnoreMouseEvents(true, { forward: true });
      } catch {
        /* platform without one of these */
      }
      win.setMenuBarVisibility?.(false);
      win.loadURL(overlayDataUrl());
    }
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    if (key !== lastBoundsKey) {
      win.setBounds(bounds, false);
      lastBoundsKey = key;
    }
    if (!win.isVisible()) win.showInactive();
  }

  async function tick() {
    if (!running || !socketPath) return;
    const displays = normalizeCursorDisplays(screen.getAllDisplays());
    if (!needsSecondaryAgentCursor(platform, displays)) {
      hide();
      return;
    }
    let point = null;
    try {
      const response = await request(socketPath, {
        method: "call",
        name: "get_cursor_position",
        args: {},
      });
      point = readCursorPoint(response);
    } catch {
      hide();
      return;
    }
    if (!point) {
      hide();
      return;
    }
    const primaryId = screen.getPrimaryDisplay()?.id;
    const plan = planSecondaryAgentCursor(point, displays, primaryId);
    if (!plan.show || !plan.windowBounds) {
      hide();
      return;
    }
    ensureWindow(plan.windowBounds);
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startPolling() {
    stopPolling();
    timer = setInterval(() => {
      void tick();
    }, pollMs);
    timer.unref?.();
    void tick();
  }

  return {
    /** Sync the helper with the current Cua connection descriptor. */
    sync(connection) {
      const nextSocket =
        connection &&
        typeof connection.socketPath === "string" &&
        connection.socketPath.length > 0 &&
        (connection.mode === "embedded" || connection.mode === "standalone")
          ? connection.socketPath
          : null;
      socketPath = nextSocket;
      if (!nextSocket || platform !== "darwin") {
        running = false;
        stopPolling();
        destroyWindow();
        return;
      }
      let displays = [];
      try {
        displays = screen.getAllDisplays();
      } catch {
        // Electron's screen module is only safe after app ready.
        running = false;
        stopPolling();
        destroyWindow();
        return;
      }
      if (!needsSecondaryAgentCursor(platform, displays)) {
        running = false;
        stopPolling();
        destroyWindow();
        return;
      }
      running = true;
      startPolling();
    },
    stop() {
      running = false;
      socketPath = null;
      stopPolling();
      destroyWindow();
    },
    /** Test seam: one poll cycle. */
    _tick: tick,
    _live: live,
  };
}

export { readCursorPoint, requestSocket };
