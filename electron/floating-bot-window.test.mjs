import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  AVATAR_MAX,
  bodyAfterResize,
  clampBodyToDisplays,
  createFloatingBotWindows,
  FLOAT_BODY,
  FLOAT_HOME,
  keepOffNeighbours,
  MENU_MAX,
  SEAM_SHARE,
  windowLimits,
  menuTemplate,
  sanitizeBody,
  SUBMENU_MAX,
  FLOAT_MAX,
  FLOATING_QUERY,
  floatingDefaultBounds,
  MAX_FLOATING,
  READY_TIMEOUT_MS,
  REMEMBER_DELAY_MS,
  waitForPage,
  sanitizeCall,
  sanitizeTray,
  TRAY_MAX,
  menuPopupPoint,
  sanitizeFloatingEvent,
  sanitizeFloatingSnapshot,
  sanitizePositions,
  mascotLook,
  sanitizeCue,
  APP_SKINS,
  appTheme,
} from "./floating-bot-window.mjs";
import { BUNBU_SKINS, CRAB_SKINS, FROG_SKINS, GRUMP_SKINS, LEGACY_BUNBU_SKINS, LEGACY_CRAB_SKINS, LEGACY_FROG_SKINS, LEGACY_GRUMP_SKINS, LEGACY_OGRE_SKINS, LEGACY_SHAPE_SKINS, LEGACY_SHIBA_SKINS, LEGACY_TROMBI_SKINS, OGRE_SKINS, SHAPE_SKINS, SHIBA_SKINS, TROMBI_SKINS } from "../shared/mascot-look.ts";
import { displaySignature } from "./retro-assistant-window.mjs";
import { SKIN_IDS } from "../src/lib/skins.ts";

const PRIMARY = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 850 } };
const SECOND = { id: 2, bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, workArea: { x: 1440, y: 0, width: 1920, height: 1040 } };

function fakeElectron({ displays = [PRIMARY] } = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const windows = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.destroyed = false;
      this.events = new Map();
      this.calls = [];
      const handlers = new Map();
      this.webContents = {
        sent: [],
        handlers,
        send: (channel, payload) => this.webContents.sent.push([channel, payload]),
        setWindowOpenHandler: vi.fn(),
        on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
        fire: (name, ...args) => (handlers.get(name) ?? []).forEach((fn) => fn(...args)),
      };
      this.loadURL = vi.fn(async () => undefined);
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.events.get("closed")?.forEach((fn) => fn()); }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.calls.push(["setBounds"]); }
    setPosition(x, y) { this.bounds = { ...this.bounds, x, y }; this.calls.push(["setPosition"]); }
    isFocused() { return this.calls.some(([name]) => name === "focus"); }
    setAlwaysOnTop(...args) { this.calls.push(["setAlwaysOnTop", ...args]); }
    setVisibleOnAllWorkspaces(...args) { this.calls.push(["setVisibleOnAllWorkspaces", ...args]); }
    setIgnoreMouseEvents(...args) { this.calls.push(["setIgnoreMouseEvents", ...args]); }
    setFocusable(...args) { this.calls.push(["setFocusable", ...args]); }
    focus() { this.calls.push(["focus"]); }
    showInactive() { this.calls.push(["showInactive"]); }
    on(name, fn) { this.events.set(name, [...(this.events.get(name) ?? []), fn]); }
    once(name, fn) { this.on(name, fn); }
  }
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: (channel, fn) => listeners.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
    removeListener: (channel) => listeners.delete(channel),
  };
  const screenEvents = new Map();
  const screen = {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
    getCursorScreenPoint: () => ({ x: 700, y: 400 }),
    on: (name, fn) => screenEvents.set(name, fn),
    removeListener: (name) => screenEvents.delete(name),
    setDisplays: (next) => { displays = next; },
    fire: (name) => screenEvents.get(name)?.(),
  };
  const main = { webContents: { sent: [], send(channel, payload) { this.sent.push([channel, payload]); } }, isDestroyed: () => false };
  return { BrowserWindow: FakeWindow, ipcMain, screen, handlers, listeners, windows, main };
}

function setup(extra = {}) {
  const fake = fakeElectron(extra);
  const saved = { positions: extra.positions };
  const focusMain = vi.fn();
  const logs = [];
  const controller = createFloatingBotWindows({
    BrowserWindow: fake.BrowserWindow,
    screen: fake.screen,
    ipcMain: fake.ipcMain,
    getMainWindow: () => fake.main,
    isTrustedMain: extra.isTrustedMain,
    platform: extra.platform ?? "darwin",
    pageUrl: () => `http://127.0.0.1:8799/?${FLOATING_QUERY}`,
    preload: "/app/electron/floating-bot-preload.cjs",
    readPositions: () => saved.positions ?? {},
    writePositions: (positions) => { saved.positions = JSON.parse(JSON.stringify(positions)); },
    focusMain,
    Menu: extra.Menu,
    log: (line) => logs.push(line),
  });
  const fromMain = { sender: fake.main.webContents };
  const invoke = (channel, event, ...args) => fake.handlers.get(channel)(event, ...args);
  const emit = (channel, event, ...args) => fake.listeners.get(channel)(event, ...args);
  const open = (botId, alwaysOnTop = true) => {
    invoke("floating-bots:open", fromMain, { botId, alwaysOnTop });
    const win = controller.window(botId);
    return { win, from: { sender: win.webContents } };
  };
  return { fake, controller, fromMain, invoke, emit, open, saved, focusMain, logs };
}

const SNAPSHOT = {
  v: 1,
  name: "Ada",
  label: "Ada, on the desktop",
  color: "green",
  skin: "none",
  avatar: null,
  pose: "speak",
  reduced: false,
  retro: false,
  sparkle: 2,
  locale: "fr",
  menu: [{ id: "open", label: "Ouvrir le fil" }, { id: "top", label: "Toujours au-dessus", checked: true }],
  balloon: { kind: "chat", text: "Bonjour", streaming: true, truncated: false, open: "Ouvrir dans Pulsa Bot", close: "Cacher la bulle", input: { label: "Message", placeholder: "Écrire", send: "Envoyer" } },
};

describe("floating bots: one window per bot", () => {
  it("opens a frameless, transparent, sandboxed, always-on-top window per bot on the main page's request", () => {
    const { fake, open } = setup();
    const { win } = open("bot_a");
    expect(win.options).toMatchObject({ frame: false, transparent: true, skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false });
    expect(win.options.webPreferences).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false, preload: "/app/electron/floating-bot-preload.cjs" });
    // hidden or covered, the page is throttled: the 3D mascot stops drawing there
    expect(win.options.webPreferences.backgroundThrottling).toBe(true);
    expect(win.loadURL).toHaveBeenCalledWith(`http://127.0.0.1:8799/?${FLOATING_QUERY}`);
    expect(win.calls).toContainEqual(["setAlwaysOnTop", true, "floating"]);
    expect(win.calls).toContainEqual(["setIgnoreMouseEvents", true, { forward: true }]);
    open("bot_b");
    open("bot_a");
    expect(fake.windows).toHaveLength(2);
  });

  it("places a second bot beside the first, not on top of it", () => {
    const { open } = setup();
    const a = open("bot_a").win.getBounds();
    const b = open("bot_b").win.getBounds();
    expect(b.x).toBeLessThan(a.x);
  });

  it("caps the number of windows", () => {
    const { invoke, fromMain, fake } = setup();
    for (let i = 0; i < MAX_FLOATING + 3; i += 1) invoke("floating-bots:open", fromMain, { botId: `bot_${i}` });
    expect(fake.windows).toHaveLength(MAX_FLOATING);
  });

  it("toggles always on top per bot", () => {
    const { invoke, fromMain, open } = setup();
    const { win } = open("bot_a");
    expect(invoke("floating-bots:set-top", fromMain, { botId: "bot_a", on: false })).toBe(true);
    expect(win.calls.at(-1)).toEqual(["setAlwaysOnTop", false]);
    expect(invoke("floating-bots:set-top", fromMain, { botId: "bot_a", on: "yes" })).toBe(false);
    const { win: other } = open("bot_b", false);
    expect(other.calls).toContainEqual(["setAlwaysOnTop", false]);
  });
});

describe("floating bots: per-bot channels", () => {
  it("sends a bot's snapshot only to that bot's window, cleaned", () => {
    const { emit, open, fromMain } = setup();
    const a = open("bot_a").win;
    const b = open("bot_b").win;
    emit("floating-bots:update", fromMain, { botId: "bot_a", snapshot: { ...SNAPSHOT, token: "secret", balloon: { ...SNAPSHOT.balloon, html: "<b>" } } });
    expect(b.webContents.sent).toHaveLength(0);
    const [channel, state] = a.webContents.sent.at(-1);
    expect(channel).toBe("floating-bot:state");
    expect(state).not.toHaveProperty("token");
    expect(state.balloon).not.toHaveProperty("html");
  });

  it("tags an event with the window's own bot, whatever the payload claims", () => {
    const { emit, open, fake } = setup();
    open("bot_a");
    const { from } = open("bot_b");
    emit("floating-bots:event", from, { type: "send", text: "salut", botId: "bot_a" });
    expect(fake.main.webContents.sent).toContainEqual(["floating-bots:event", { botId: "bot_b", event: { type: "send", text: "salut" } }]);
  });

  it("lets only the local main page drive the windows", () => {
    const { invoke, emit, fake, open } = setup();
    expect(invoke("floating-bots:open", { sender: {} }, { botId: "bot_a" })).toBe(false);
    expect(fake.windows).toHaveLength(0);
    const { win, from } = open("bot_a");
    emit("floating-bots:update", from, { botId: "bot_a", snapshot: SNAPSHOT });
    expect(win.webContents.sent).toHaveLength(0);
    expect(invoke("floating-bots:close", from, { botId: "bot_a" })).toBe(false);
    expect(invoke("floating-bots:list", from)).toEqual([]);
    const remote = setup({ isTrustedMain: () => false });
    expect(remote.invoke("floating-bots:open", remote.fromMain, { botId: "bot_a" })).toBe(false);
  });

  it("lets only a floating window move, size or report, and only itself", () => {
    const { invoke, emit, open, fromMain, fake } = setup();
    const a = open("bot_a").win;
    const { win: b, from: fromB } = open("bot_b");
    const before = a.getBounds();
    expect(invoke("floating-bots:move-by", fromMain, { dx: -50, dy: -50 })).toBeNull();
    emit("floating-bots:event", fromMain, { type: "click" });
    expect(fake.main.webContents.sent.filter(([channel]) => channel === "floating-bots:event")).toHaveLength(0);
    invoke("floating-bots:move-by", fromB, { dx: -40, dy: -40 });
    expect(a.getBounds()).toEqual(before);
    expect(b.bounds.x).not.toBe(before.x);
  });

  it("refuses bad bot ids", () => {
    const { invoke, fromMain, fake } = setup();
    expect(invoke("floating-bots:open", fromMain, { botId: "../../x" })).toBe(false);
    expect(invoke("floating-bots:open", fromMain, "bot_a")).toBe(false);
    expect(fake.windows).toHaveLength(0);
  });

  it("brings the app forward on Open in the app, and replays the last snapshot when ready", () => {
    const { emit, open, fromMain, focusMain } = setup();
    const { win, from } = open("bot_a");
    emit("floating-bots:update", fromMain, { botId: "bot_a", snapshot: SNAPSHOT });
    win.webContents.sent.length = 0;
    emit("floating-bots:ready", from);
    expect(win.webContents.sent.at(-1)[1]).toMatchObject({ name: "Ada", pose: "speak" });
    emit("floating-bots:event", from, { type: "open" });
    emit("floating-bots:event", from, { type: "menu", id: "open" });
    expect(focusMain).toHaveBeenCalledTimes(2);
  });
});

describe("floating bots: lifecycle", () => {
  it("closes silently for the brain, tells it when closed from outside", () => {
    const { controller, invoke, fromMain, open, fake } = setup();
    open("bot_a");
    const { win: b } = open("bot_b");
    invoke("floating-bots:close", fromMain, { botId: "bot_a" });
    expect(controller.botIds).toEqual(["bot_b"]);
    expect(fake.main.webContents.sent.some(([channel]) => channel === "floating-bots:closed")).toBe(false);
    b.destroy();
    expect(fake.main.webContents.sent).toContainEqual(["floating-bots:closed", { botId: "bot_b" }]);
  });

  it("goes with the main window and on quit, without dropping the saved list", () => {
    const { controller, open, fake } = setup();
    const { win } = open("bot_a");
    controller.mainWindowGone();
    expect(win.destroyed).toBe(true);
    expect(fake.main.webContents.sent.some(([channel]) => channel === "floating-bots:closed")).toBe(false);
    open("bot_b");
    controller.dispose();
    expect(fake.handlers.size).toBe(0);
    expect(fake.listeners.size).toBe(0);
  });
});

describe("floating bots: a window is never left invisible", () => {
  it("retries a page that fails to load, reloads one that dies, and ignores an aborted load", () => {
    vi.useFakeTimers();
    try {
      const { open, logs } = setup();
      const { win } = open("bot_a");
      expect(win.loadURL).toHaveBeenCalledTimes(1);
      win.webContents.fire("did-fail-load", {}, -3, "ERR_ABORTED", "", true);
      vi.advanceTimersByTime(5000);
      expect(win.loadURL).toHaveBeenCalledTimes(1);
      win.webContents.fire("did-fail-load", {}, -2, "ERR_FAILED", "", true);
      vi.advanceTimersByTime(1000);
      expect(win.loadURL).toHaveBeenCalledTimes(2);
      win.webContents.fire("render-process-gone", {}, { reason: "crashed" });
      vi.advanceTimersByTime(2000);
      expect(win.loadURL).toHaveBeenCalledTimes(3);
      expect(logs.some((line) => line.includes("page failed to load"))).toBe(true);
      // never more than a few times
      for (let i = 0; i < 6; i += 1) win.webContents.fire("did-fail-load", {}, -2, "ERR_FAILED", "", true);
      vi.advanceTimersByTime(60_000);
      expect(win.loadURL.mock.calls.length).toBeLessThanOrEqual(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a snapshot sent a moment before the window exists, for the window that opens", () => {
    const { emit, fromMain, open } = setup();
    emit("floating-bots:update", fromMain, { botId: "bot_a", snapshot: SNAPSHOT });
    const { win, from } = open("bot_a");
    emit("floating-bots:ready", from);
    const [channel, state] = win.webContents.sent.at(-1);
    expect(channel).toBe("floating-bot:state");
    expect(state).toMatchObject({ name: "Ada", pose: "speak" });
  });

  it("asks the app page for a state when a window is ready without one, and keeps a closed window's state for the next", () => {
    const { emit, fromMain, open, invoke, fake } = setup();
    const first = open("bot_a");
    emit("floating-bots:ready", first.from);
    expect(fake.main.webContents.sent).toContainEqual(["floating-bots:want", { botId: "bot_a" }]);
    emit("floating-bots:update", fromMain, { botId: "bot_a", snapshot: SNAPSHOT });
    // closed and opened again (the app page remounted): the new window still gets the state
    invoke("floating-bots:close", fromMain, { botId: "bot_a" });
    const again = open("bot_a");
    emit("floating-bots:ready", again.from);
    expect(again.win.webContents.sent.at(-1)).toEqual(["floating-bot:state", expect.objectContaining({ name: "Ada" })]);
  });

  it("waits for a development page to answer before loading it", async () => {
    let calls = 0;
    const fetchImpl = async () => ({ ok: ++calls >= 3 });
    expect(await waitForPage("http://127.0.0.1:5199/", { fetchImpl, delayMs: 1 })).toBe(true);
    expect(calls).toBe(3);
    expect(await waitForPage("http://x/", { fetchImpl: async () => { throw new Error("down"); }, tries: 2, delayMs: 1 })).toBe(false);
  });

  it("says in its log why a state did not reach a window", () => {
    const { emit, open, logs, fake } = setup();
    emit("floating-bots:update", { sender: {} }, { botId: "bot_a", snapshot: SNAPSHOT });
    emit("floating-bots:update", { sender: fake.main.webContents }, { botId: "bot_a", snapshot: { v: 2 } });
    const { from } = open("bot_b");
    emit("floating-bots:ready", from);
    expect(logs).toEqual(expect.arrayContaining([
      "floating bots: update refused (not the app page)",
      "floating bots: state for bot_a refused as malformed",
      "floating bots: bot_b is ready but no state has come from the app yet; asking the app",
    ]));
  });

  it("reloads a page that never says it is ready, and logs the page's errors", () => {
    vi.useFakeTimers();
    try {
      const { open, emit, logs } = setup();
      const ready = open("bot_a");
      const silent = open("bot_b");
      emit("floating-bots:ready", ready.from);
      vi.advanceTimersByTime(READY_TIMEOUT_MS + 3000);
      expect(ready.win.loadURL).toHaveBeenCalledTimes(1);
      expect(silent.win.loadURL).toHaveBeenCalledTimes(2);
      silent.win.webContents.fire("console-message", { level: "error", message: "TypeError: boom" });
      silent.win.webContents.fire("console-message", { level: "info", message: "hello" });
      expect(logs.filter((line) => line.includes("page error"))).toEqual(["floating bot bot_b page error: TypeError: boom"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("listens to display changes only once the app is ready (the screen module needs it)", async () => {
    let ready;
    const whenReady = () => new Promise((resolve) => { ready = resolve; });
    const fake = fakeElectron();
    const on = vi.spyOn(fake.screen, "on");
    createFloatingBotWindows({ BrowserWindow: fake.BrowserWindow, screen: fake.screen, ipcMain: fake.ipcMain, getMainWindow: () => fake.main, pageUrl: () => "http://x/", preload: "/p", whenReady });
    expect(on).not.toHaveBeenCalled();
    ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(on).toHaveBeenCalledWith("display-removed", expect.any(Function));
  });

  it("brings every mascot back on screen when a display goes away", () => {
    const { fake, open } = setup({ displays: [PRIMARY, SECOND] });
    const { win } = open("bot_a");
    win.setBounds({ x: 3000, y: 500, width: 156, height: 172 });
    fake.screen.setDisplays([PRIMARY]);
    fake.screen.fire("display-removed");
    const bounds = win.getBounds();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(PRIMARY.workArea.x + PRIMARY.workArea.width);
  });
});

describe("floating bots: positions and screens", () => {
  it("remembers each bot's spot per display setup and restores it clamped", () => {
    const first = setup();
    const { win, from } = first.open("bot_a");
    first.invoke("floating-bots:move-by", from, { dx: -300, dy: -200 });
    first.emit("floating-bots:moved", from);
    const spot = win.getBounds();
    const key = displaySignature([PRIMARY]);
    // the character's own corner, marked as such (v 2)
    expect(first.saved.positions[key].bot_a).toEqual({ x: spot.x + FLOAT_BODY.x + FLOAT_BODY.width, y: spot.y + FLOAT_BODY.y + FLOAT_BODY.height, v: 2 });

    const again = setup({ positions: first.saved.positions });
    expect(again.open("bot_a").win.getBounds()).toMatchObject({ x: spot.x, y: spot.y });
  });

  it("lets the mascot fly its own window inside the work areas, without saving where it flew", () => {
    const { open, invoke, emit, saved, fake } = setup({ displays: [PRIMARY, SECOND] });
    const { win, from } = open("bot_a");
    const home = win.getBounds();
    const geometry = invoke("floating-bots:geometry", from);
    const bodyAt = (b) => ({ x: b.x + FLOAT_BODY.x, y: b.y + FLOAT_BODY.y, width: FLOAT_BODY.width, height: FLOAT_BODY.height });
    // on macOS, how far the window may reach toward the second display (to the primary's right)
    expect(geometry).toEqual({ bounds: home, workArea: PRIMARY.workArea, cursor: { x: 700, y: 400 }, body: bodyAt(home), limits: { right: 1440 + Math.floor(FLOAT_HOME.width * SEAM_SHARE) } });
    emit("floating-bots:autopilot", from, true);
    // a flight cannot take the character off the screens (the window's empty room may hang off)
    expect(invoke("floating-bots:move-to", from, { x: -5000, y: 100 })).toMatchObject({ x: -FLOAT_BODY.x, y: 100 });
    expect(invoke("floating-bots:move-to", from, { x: 100, y: -900 })).toMatchObject({ x: 100, y: PRIMARY.workArea.y - FLOAT_BODY.y });
    win.events.get("moved")?.forEach((fn) => fn());
    emit("floating-bots:moved", from);
    expect(saved.positions).toBeUndefined();
    // flown onto the second display, it reports that display's work area
    invoke("floating-bots:move-to", from, { x: 2000, y: 500 });
    expect(invoke("floating-bots:geometry", from).workArea).toEqual(SECOND.workArea);
    emit("floating-bots:autopilot", from, false);
    emit("floating-bots:moved", from);
    expect(Object.values(saved.positions)[0].bot_a).toBeDefined();
    // the main page and a stranger cannot fly it
    expect(invoke("floating-bots:move-to", { sender: fake.main.webContents }, { x: 0, y: 0 })).toBeNull();
    expect(invoke("floating-bots:geometry", { sender: {} })).toBeNull();
    expect(invoke("floating-bots:move-to", from, { x: "1", y: 2 })).toBeNull();
  });

  it("pulls a spot saved off every screen back onto the visible displays", () => {
    const key = displaySignature([PRIMARY, SECOND]);
    const { open } = setup({ displays: [PRIMARY, SECOND], positions: { [key]: { bot_a: { x: 99999, y: -5000 } } } });
    const bounds = open("bot_a").win.getBounds();
    // the character is fully on the second display (its room may hang off)
    expect(bounds.x + FLOAT_BODY.x + FLOAT_BODY.width).toBeLessThanOrEqual(SECOND.workArea.x + SECOND.workArea.width);
    expect(bounds.y + FLOAT_BODY.y).toBeGreaterThanOrEqual(SECOND.workArea.y);
  });

  it("lets the character stand in any corner of any display, its room hanging off, and puts it back there exactly", () => {
    // (macOS keeps the room off a neighbouring display: the next test)
    const first = setup({ displays: [PRIMARY, SECOND], platform: "win32" });
    const { win, from } = first.open("bot_a");
    const corners = [
      { x: PRIMARY.workArea.x, y: PRIMARY.workArea.y },
      { x: PRIMARY.workArea.x + PRIMARY.workArea.width - FLOAT_BODY.width, y: PRIMARY.workArea.y + PRIMARY.workArea.height - FLOAT_BODY.height },
      { x: SECOND.workArea.x + SECOND.workArea.width - FLOAT_BODY.width, y: SECOND.workArea.y },
      { x: SECOND.workArea.x, y: SECOND.workArea.y + SECOND.workArea.height - FLOAT_BODY.height },
    ];
    // dragged past each corner (never toward the other display): it stops with the character exactly in it
    const past = [{ x: -50, y: -50 }, { x: 0, y: 50 }, { x: 50, y: -50 }, { x: 0, y: 50 }];
    corners.forEach((corner, index) => {
      first.invoke("floating-bots:move-to", from, { x: corner.x - FLOAT_BODY.x + past[index].x, y: corner.y - FLOAT_BODY.y + past[index].y });
      const at = win.getBounds();
      expect({ x: at.x + FLOAT_BODY.x, y: at.y + FLOAT_BODY.y }).toEqual(corner);
    });
    // the top-left corner of the primary display: the window's room hangs off the screen
    first.invoke("floating-bots:move-to", from, { x: -2000, y: -2000 });
    const spot = win.getBounds();
    expect(spot.x).toBeLessThan(PRIMARY.workArea.x);
    expect(spot.y).toBeLessThan(PRIMARY.workArea.y);
    first.emit("floating-bots:moved", from);
    // a restart with the same displays: exactly there, no snap back to a default spot
    const again = setup({ displays: [PRIMARY, SECOND], positions: first.saved.positions, platform: "win32" });
    expect(again.open("bot_a").win.getBounds()).toMatchObject({ x: spot.x, y: spot.y });
    // that display setup gone: the default spot on what is there
    const other = setup({ displays: [SECOND], positions: first.saved.positions });
    const fallback = other.open("bot_a").win.getBounds();
    expect(fallback.x + FLOAT_BODY.x).toBeGreaterThanOrEqual(SECOND.workArea.x);
  });

  it("on macOS keeps the window's room off a neighbouring display (macOS would undo the move), never off a free edge", () => {
    const { open, invoke, emit } = setup({ displays: [PRIMARY, SECOND] });
    const { win, from } = open("bot_a");
    // the second display's left edge is the seam with the primary: the room (above and to the left) would reach onto it
    invoke("floating-bots:move-to", from, { x: SECOND.workArea.x - FLOAT_BODY.x - 50, y: 100 });
    const b = win.getBounds();
    const onPrimary = PRIMARY.bounds.x + PRIMARY.bounds.width - b.x;
    expect(onPrimary).toBeLessThanOrEqual(Math.floor(FLOAT_HOME.width * SEAM_SHARE));
    expect(b.x + FLOAT_BODY.x).toBeGreaterThan(SECOND.workArea.x);
    // with the chat's room on its right (the window's character near its left), the character reaches the seam itself
    const body = { x: 56, y: 535, width: 120, height: 120 };
    emit("floating-bots:body", from, body);
    invoke("floating-bots:move-to", from, { x: SECOND.workArea.x - body.x - 50, y: 100 });
    expect(win.getBounds().x + body.x).toBe(SECOND.workArea.x);
    // a free edge (nothing past it): the room hangs off as far as it needs
    invoke("floating-bots:move-to", from, { x: SECOND.workArea.x + SECOND.workArea.width, y: 100 });
    expect(win.getBounds().x + body.x + body.width).toBe(SECOND.workArea.x + SECOND.workArea.width);
    expect(keepOffNeighbours({ x: 100, y: 100, width: 352, height: 716 }, FLOAT_BODY, [PRIMARY.bounds, SECOND.bounds])).toEqual({ x: 100, y: 100, width: 352, height: 716 });
    // the limits the page gets, to open the window's room away from the seam: only where a display touches
    const size = { width: 352, height: 716 };
    expect(windowLimits({ x: 1500, y: 300, width: 120, height: 120 }, size, [PRIMARY.bounds, SECOND.bounds])).toEqual({ left: 1440 - 63 });
    expect(windowLimits({ x: 300, y: 300, width: 120, height: 120 }, size, [PRIMARY.bounds])).toBeNull();
    const below = { x: 0, y: 900, width: 1440, height: 900 };
    expect(windowLimits({ x: 300, y: 300, width: 120, height: 120 }, size, [PRIMARY.bounds, below])).toEqual({ bottom: 900 + Math.floor(716 * SEAM_SHARE) });
  });

  it("reads an older save (the window's corner) as before", () => {
    const key = displaySignature([PRIMARY]);
    const { open } = setup({ positions: { [key]: { bot_a: { x: 900, y: 800 } } } });
    expect(open("bot_a").win.getBounds()).toMatchObject({ x: 900 - FLOAT_HOME.width, y: 800 - FLOAT_HOME.height });
  });

  it("keeps on screen the box the page reports, and a new layout keeps the character where it stands", () => {
    const { open, emit, invoke } = setup();
    const { win, from } = open("bot_a");
    // the chat's room now below and to the right: the character is near the window's top-left corner
    const body = { x: 56, y: 71, width: 120, height: 120 };
    const before = win.getBounds();
    const placed = invoke("floating-bots:frame", from, { width: FLOAT_HOME.width, height: FLOAT_HOME.height, body });
    expect(placed.x + body.x).toBe(before.x + FLOAT_BODY.x);
    expect(placed.y + body.y).toBe(before.y + FLOAT_BODY.y);
    // from now on that box is what stays on screen
    invoke("floating-bots:move-to", from, { x: 5000, y: 5000 });
    const end = win.getBounds();
    expect(end.x + body.x + body.width).toBe(PRIMARY.workArea.x + PRIMARY.workArea.width);
    expect(end.y + body.y + body.height).toBe(PRIMARY.workArea.y + PRIMARY.workArea.height);
    // the page says where the character was drawn just before: that is what stays put
    invoke("floating-bots:move-to", from, { x: 400, y: 0 });
    const at = win.getBounds();
    const moved = invoke("floating-bots:frame", from, { width: FLOAT_HOME.width, height: FLOAT_HOME.height, body: FLOAT_BODY, from: { x: 100, y: 90, width: 120, height: 120 } });
    expect(moved.x + FLOAT_BODY.x).toBe(at.x + 100);
    expect(moved.y + FLOAT_BODY.y).toBe(at.y + 90);
    // a box reported outside its window, or of no size, is refused
    emit("floating-bots:body", from, { x: 5000, y: 5000, width: 120, height: 120 });
    emit("floating-bots:body", from, { x: 1, y: 1, width: 0, height: 120 });
    expect(invoke("floating-bots:frame", from, { width: 300, height: 300, body: null })).toBeNull();
    expect(invoke("floating-bots:frame", { sender: {} }, { width: 300, height: 300, body })).toBeNull();
  });

  it("clamps only the character's box, the nearest display's when it is off every screen", () => {
    const areas = [PRIMARY.workArea, SECOND.workArea];
    const body = { x: 177, y: 535, width: 120, height: 120 };
    // right in the top-left corner of the primary, the window above and left of the screen
    expect(clampBodyToDisplays({ x: -400, y: -900, width: 352, height: 716 }, body, areas)).toMatchObject({ x: -177, y: 25 - 535 });
    // past the far edge of the second display
    expect(clampBodyToDisplays({ x: 9000, y: 9000, width: 352, height: 716 }, body, areas)).toMatchObject({ x: 3360 - 297, y: 1040 - 655 });
    // inside: untouched
    expect(clampBodyToDisplays({ x: 600, y: 100, width: 352, height: 716 }, body, areas)).toMatchObject({ x: 600, y: 100 });
    expect(sanitizeBody({ x: 10, y: 10, width: 999, height: 20 }, { width: 100, height: 100 })).toEqual({ x: 10, y: 10, width: 90, height: 20 });
    expect(sanitizeBody({ x: "1", y: 1, width: 20, height: 20 }, { width: 100, height: 100 })).toBeNull();
    // a window that grows up and to the left: the box keeps its distance to the bottom-right corner
    expect(bodyAfterResize(body, { width: 352, height: 716 }, { width: 500, height: 800 })).toEqual({ x: 325, y: 619, width: 120, height: 120 });
    expect(bodyAfterResize(body, { width: 352, height: 716 }, { width: 500, height: 800 }, { x: "left", y: "top" })).toEqual(body);
  });

  it("grows a window from the mascot's corner: bottom-right, or the one the balloon opened away from", () => {
    const { open, invoke } = setup();
    const { win, from } = open("bot_a");
    win.setBounds({ x: 600, y: 300, width: 200, height: 200 });
    expect(invoke("floating-bots:resize", from, { width: 500, height: 400 })).toMatchObject({ x: 300, y: 100 });
    win.setBounds({ x: 600, y: 300, width: 200, height: 200 });
    expect(invoke("floating-bots:resize", from, { width: 500, height: 400, anchorX: "left", anchorY: "top" })).toMatchObject({ x: 600, y: 300 });
  });

  it("drags and resizes inside the work areas", () => {
    const { invoke, open } = setup();
    const { win, from } = open("bot_a");
    invoke("floating-bots:move-by", from, { dx: -1e9, dy: -1e9 });
    // the character in the corner, the window's room past the screen's edge
    expect(win.bounds).toMatchObject({ x: PRIMARY.workArea.x - FLOAT_BODY.x, y: PRIMARY.workArea.y - FLOAT_BODY.y });
    expect(invoke("floating-bots:move-by", from, { dx: Number.NaN, dy: 0 })).toBeNull();
    invoke("floating-bots:resize", from, { width: 99999, height: 99999 });
    expect(win.bounds.width).toBeLessThanOrEqual(FLOAT_MAX.width);
    expect(win.bounds.height).toBeLessThanOrEqual(Math.min(FLOAT_MAX.height, PRIMARY.workArea.height));
  });

  it("drops malformed saved positions", () => {
    expect(sanitizePositions({ sig: { bot_a: { x: 1, y: 2 }, "bad id": { x: 1, y: 1 }, bot_b: { x: "1", y: 2 } } })).toEqual({ sig: { bot_a: { x: 1, y: 2 } } });
    expect(sanitizePositions(null)).toEqual({});
    expect(sanitizePositions([1, 2])).toEqual({});
    // per-display spots never share this table (older builds slice the first 32 keys)
    expect(sanitizePositions({ "display:1@0,0": { bot_a: { x: 1, y: 2, v: 2, t: 9 } }, sig: { bot_a: { x: 3, y: 4, v: 2, t: 9 } } })).toEqual({ sig: { bot_a: { x: 3, y: 4, v: 2 } } });
  });

  it("steps new bots across the bottom of the primary display", () => {
    const a = floatingDefaultBounds(PRIMARY.workArea, 0);
    const b = floatingDefaultBounds(PRIMARY.workArea, 1);
    expect(b.x).toBeLessThan(a.x);
    expect(a.y + a.height).toBeLessThanOrEqual(PRIMARY.workArea.y + PRIMARY.workArea.height);
  });
});

describe("floating bots: payload validation", () => {
  it("refuses a snapshot of the wrong shape", () => {
    expect(sanitizeFloatingSnapshot(null)).toBeNull();
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, v: 2 })).toBeNull();
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, pose: "dance" })).toBeNull();
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, name: 5 })).toBeNull();
  });

  it("bounds every text and list, and keeps only safe values", () => {
    const clean = sanitizeFloatingSnapshot({
      ...SNAPSHOT,
      locale: "fr<script>",
      color: "red; background:url(x)",
      skin: "../../x",
      sparkle: -1,
      menu: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, label: "x".repeat(500) })),
      balloon: { ...SNAPSHOT.balloon, kind: "chat", text: "y".repeat(9000), asked: "z".repeat(900) },
    });
    expect(clean).toMatchObject({ locale: "en", color: "blue", skin: "none", sparkle: 0 });
    expect(clean.menu).toHaveLength(MENU_MAX);
    expect(clean.menu[0].label.length).toBe(80);
    expect(clean.balloon.text.length).toBe(4000);
    expect(clean.balloon.asked.length).toBe(300);
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, balloon: { kind: "html" } }).balloon).toBeNull();
  });

  it("keeps the mascot's task, mood, fly-away choice and hints, bounded", () => {
    expect(sanitizeFloatingSnapshot(SNAPSHOT)).toMatchObject({ task: "idle", mood: 0.6, flyAway: true, hints: { mood: "", working: "" } });
    const clean = sanitizeFloatingSnapshot({ ...SNAPSHOT, task: "working", mood: 4, flyAway: false, hints: { mood: "m".repeat(500), working: "w".repeat(500), html: "<b>" } });
    expect(clean).toMatchObject({ task: "working", mood: 1, flyAway: false });
    expect(clean.hints.mood.length).toBe(80);
    expect(clean.hints.working.length).toBe(200);
    expect(clean.hints).not.toHaveProperty("html");
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, task: "rm -rf", mood: Number.NaN })).toMatchObject({ task: "idle", mood: 0.6 });
  });

  it("keeps the character a bot wears and its look, known values only", () => {
    expect(sanitizeFloatingSnapshot(SNAPSHOT)).toMatchObject({ mascot: { character: "owl" } });
    const clean = sanitizeFloatingSnapshot({
      ...SNAPSHOT,
      mascot: { character: "shape", shape: "cloud", style: "3d", skins: { shape: "neon", trombi: "gold", html: "<b>" }, extra: 1 },
    });
    expect(clean.mascot).toEqual({ character: "shape", shape: "cloud", style: "3d", skins: { shape: "neon", trombi: "gold" } });
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, mascot: { character: "dragon" } }).mascot).toEqual({ character: "owl" });
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, mascot: { character: "shape", shape: "rocket" } }).mascot).toEqual({ character: "shape" });
  });

  it("keeps the bot's id, a few earlier exchanges and the pin label, bounded", () => {
    const clean = sanitizeFloatingSnapshot({
      ...SNAPSHOT,
      id: "bot_a",
      hints: { pin: "Put back" },
      balloon: { ...SNAPSHOT.balloon, history: [...Array.from({ length: 9 }, (_, i) => ({ asked: `q${i}`, text: "t".repeat(3000) })), null] },
    });
    expect(clean.id).toBe("bot_a");
    expect(clean.hints.pin).toBe("Put back");
    expect(clean.balloon.history).toHaveLength(3);
    expect(clean.balloon.history[0].text.length).toBe(2000);
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, id: "../x" }).id).toBe("");
  });

  it("keeps the activity level, the hoot and the context figures for the energy bar, bounded", () => {
    expect(sanitizeFloatingSnapshot(SNAPSHOT)).toMatchObject({ liveliness: "normal", context: null });
    const clean = sanitizeFloatingSnapshot({
      ...SNAPSHOT,
      liveliness: "lively",
      hints: { hoot: "h".repeat(90) },
      context: { percent: 24.4, tokens: 48_000, window: 200_000, detail: "d".repeat(400), label: "Context 24%", html: "<b>" },
    });
    expect(clean.liveliness).toBe("lively");
    expect(clean.hints.hoot.length).toBe(40);
    expect(clean.context).toEqual({ percent: 24, tokens: 48_000, window: 200_000, detail: "d".repeat(120), label: "Context 24%" });
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, liveliness: "wild", context: { tokens: "x" } })).toMatchObject({ liveliness: "normal", context: null });
  });

  it("takes a picture only as a bounded inline image, never a URL", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, avatar: { src: png, crop: "rounded", zoom: 9 } }).avatar).toEqual({ src: png, crop: "rounded", zoom: 3, focusX: 0.5, focusY: 0.5 });
    for (const src of ["/api/attachments/a.png", "https://evil/x.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,PGI+", `data:image/png;base64,${"A".repeat(AVATAR_MAX)}`]) {
      expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, avatar: { src } }).avatar).toBeNull();
    }
  });

  it("accepts only the events a floating window can make", () => {
    expect(sanitizeFloatingEvent({ type: "click" })).toEqual({ type: "click" });
    expect(sanitizeFloatingEvent({ type: "play", extra: 1 })).toEqual({ type: "play" });
    expect(sanitizeFloatingEvent({ type: "pet" })).toEqual({ type: "pet" });
    expect(sanitizeFloatingEvent({ type: "mascot", choice: { character: "trombi" } })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "menu", id: "dock" })).toEqual({ type: "menu", id: "dock" });
    expect(sanitizeFloatingEvent({ type: "menu", id: "../x" })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "send", text: "q".repeat(5000) }).text.length).toBe(4000);
    expect(sanitizeFloatingEvent({ type: "send", text: "   " })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "send", text: 1 })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "eval", code: "x" })).toBeNull();
    expect(sanitizeFloatingEvent("click")).toBeNull();
  });
});

describe("floating bots: the hover controls' activity tray", () => {
  it("passes opaque ids and short texts only, bounded", () => {
    const tray = sanitizeTray({
      loading: true,
      threadId: "t-secret",
      items: [
        { id: "a0", kind: "approval", title: "x".repeat(300), detail: "y".repeat(300), canStop: true, canOpen: true, requestId: "req-1", threadId: "t9" },
        { id: "thread:t1", kind: "running", title: "bad id" },
        { id: "r0", kind: "routine", title: "bad kind" },
        ...Array.from({ length: 20 }, (_, i) => ({ id: `r${i + 1}`, kind: "running", title: "Export", canStop: "yes" })),
      ],
    });
    expect(tray.loading).toBe(true);
    expect(tray.items).toHaveLength(TRAY_MAX);
    expect(tray.items[0]).toEqual({ id: "a0", kind: "approval", title: "x".repeat(80), detail: "y".repeat(140), canStop: true, canOpen: true });
    expect(tray.items[1]).toMatchObject({ id: "r1", canStop: false, canOpen: false });
    expect(JSON.stringify(tray)).not.toMatch(/req-1|t9|t-secret/);
    expect(sanitizeTray(null)).toBeNull();
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, tray: { items: [{ id: "a0", kind: "approval", title: "Needs you" }] } }).tray.items).toHaveLength(1);
    expect(sanitizeFloatingSnapshot(SNAPSHOT).tray).toBeNull();
  });

  it("takes back the bell and a row's buttons only with a listed id's shape", () => {
    expect(sanitizeFloatingEvent({ type: "tray", open: true, botId: "other" })).toEqual({ type: "tray", open: true });
    expect(sanitizeFloatingEvent({ type: "tray", open: "yes" })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "work", action: "allow", id: "a0", requestId: "x" })).toEqual({ type: "work", action: "allow", id: "a0" });
    expect(sanitizeFloatingEvent({ type: "work", action: "stop", id: "r12" })).toEqual({ type: "work", action: "stop", id: "r12" });
    expect(sanitizeFloatingEvent({ type: "work", action: "delete", id: "a0" })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "work", action: "allow", id: "thread:t1" })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "work", action: "open", id: "r100" })).toBeNull();
  });
});

describe("floating bots: a voice call with the mascot", () => {
  it("passes the call's states, short texts and settings only, bounded", () => {
    const call = sanitizeCall({
      phase: "speaking", muted: true, botAudible: true, push: false, startedAt: 5, line: "x".repeat(5000), token: "secret",
      transcript: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, who: i % 2 ? "bot" : "you", text: "hi", html: "<b>" })),
      settings: { voice: "eve", speed: 9, language: "fr", key: "sk" },
      callSettings: { input: "push", onlyMyVoice: true, earcons: false, pause: "patient" },
      voices: [{ id: "eve", label: "Eve" }, { id: "bad id!", label: "X" }],
      enrollment: { state: "recording", share: 3 },
      previewing: { id: "eve", loading: true },
    });
    expect(call).not.toHaveProperty("token");
    expect(call.line).toHaveLength(1200);
    expect(call.transcript).toHaveLength(8);
    expect(call.transcript[0]).not.toHaveProperty("html");
    expect(call.settings).toEqual({ voice: "eve", speed: 2, language: "fr" });
    expect(call.callSettings).toEqual({ input: "push", onlyMyVoice: true, earcons: false, pause: "patient" });
    expect(call.voices).toEqual([{ id: "eve", label: "Eve" }]);
    expect(call.enrollment).toEqual({ state: "recording", share: 1 });
    expect(sanitizeCall({ phase: "ringing" })).toBeNull();
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, call: { phase: "listening" }, hints: { call: "Call Sagax" } })).toMatchObject({ call: { phase: "listening" }, hints: { call: "Call Sagax" } });
  });

  it("takes back only known call actions, with checked settings", () => {
    expect(sanitizeFloatingEvent({ type: "call", action: "start", botId: "other" })).toEqual({ type: "call", action: "start" });
    expect(sanitizeFloatingEvent({ type: "call", action: "dial" })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "call", action: "preview", voice: "eve" })).toEqual({ type: "call", action: "preview", voice: "eve" });
    expect(sanitizeFloatingEvent({ type: "call", action: "settings", patch: { voice: "eve", speed: 1.5, xai: "key" } })).toEqual({ type: "call", action: "settings", patch: { voice: "eve", speed: 1.5 } });
    expect(sanitizeFloatingEvent({ type: "call", action: "call-settings", patch: { input: "shout" } })).toBeNull();
    // the end-of-turn pause (Short / Normal / Patient) travels too
    expect(sanitizeFloatingEvent({ type: "call", action: "call-settings", patch: { pause: "short" } })).toMatchObject({ patch: { pause: "short" } });
    expect(sanitizeFloatingEvent({ type: "call", action: "call-settings", patch: { pause: "forever" } })).toBeNull();
  });

  it("passes the captions switch (on unless turned off)", () => {
    expect(sanitizeCall({ phase: "speaking" }).captions).toBe(true);
    expect(sanitizeCall({ phase: "speaking", captions: false }).captions).toBe(false);
    expect(sanitizeCall({ phase: "speaking", captions: "no" }).captions).toBe(true);
  });

  it("relays the call's levels from the app page to that bot's window only", () => {
    const { emit, open, fromMain } = setup();
    const a = open("bot_a");
    const b = open("bot_b").win;
    emit("floating-bots:level", fromMain, { botId: "bot_a", levels: { bot: 2, mic: 0.2 } });
    expect(a.win.webContents.sent.at(-1)).toEqual(["floating-bot:level", { bot: 1, mic: 0.2 }]);
    expect(b.webContents.sent).toHaveLength(0);
    // a mascot window cannot speak for the app page
    emit("floating-bots:level", a.from, { botId: "bot_b", levels: { bot: 1, mic: 1 } });
    expect(b.webContents.sent).toHaveLength(0);
  });
});

describe("floating bots: the menu opens at the pointer", () => {
  const areas = [PRIMARY.workArea, SECOND.workArea];
  it("puts it exactly where the click was, in the window's coordinates", () => {
    expect(menuPopupPoint({ x: 120, y: 80 }, 1, { x: 600, y: 400, width: 240, height: 260 }, areas)).toEqual({ x: 120, y: 80 });
    // a zoomed page reports CSS pixels: times the zoom gives the window's (DIP) coordinates
    expect(menuPopupPoint({ x: 100, y: 50 }, 1.25, { x: 600, y: 400, width: 300, height: 300 }, areas)).toEqual({ x: 125, y: 63 });
    // on the second display (left of it at x 1440)
    expect(menuPopupPoint({ x: 30, y: 40 }, 1, { x: 2000, y: 500, width: 240, height: 260 }, areas)).toEqual({ x: 30, y: 40 });
  });

  it("keeps it inside the work area of the display under the click", () => {
    // a window partly above the primary's menu bar (work area starts at y 25)
    expect(menuPopupPoint({ x: 50, y: 5 }, 1, { x: 100, y: 0, width: 240, height: 260 }, areas)).toEqual({ x: 50, y: 25 });
    // off the bottom of the primary (work area ends at 875): back inside
    expect(menuPopupPoint({ x: 10, y: 250 }, 1, { x: 100, y: 700, width: 240, height: 260 }, areas)).toEqual({ x: 10, y: 174 });
    // past the right edge of the second display: the nearest area's last pixel
    expect(menuPopupPoint({ x: 300, y: 10 }, 1, { x: 3300, y: 100, width: 240, height: 260 }, areas)).toEqual({ x: 59, y: 10 });
  });

  it("pops main's native menu over the asking window only, with the snapshot's items", () => {
    const popup = vi.fn();
    let template = null;
    const Menu = { buildFromTemplate: vi.fn((items) => { template = items; return { popup }; }) };
    const { emit, open, fromMain, fake } = setup({ Menu });
    const a = open("bot_a");
    emit("floating-bots:update", fromMain, { botId: "bot_a", snapshot: { ...SNAPSHOT, menu: [{ id: "call", label: "Appeler" }, { id: "top", label: "Always on top", checked: true }] } });
    a.win.setBounds?.({ x: 600, y: 400, width: 240, height: 260 });
    emit("floating-bots:menu", a.from, { x: 33, y: 44 });
    expect(popup).toHaveBeenCalledOnce();
    const [options] = popup.mock.calls[0];
    expect(options.window).toBe(a.win);
    expect(template.map((item) => item.label)).toEqual(["Appeler", "Always on top"]);
    expect(template[1]).toMatchObject({ type: "checkbox", checked: true });
    template[0].click();
    expect(fake.main.webContents.sent.at(-1)).toEqual(["floating-bots:event", { botId: "bot_a", event: { type: "menu", id: "call" } }]);
    // the app page cannot pop a mascot's menu
    emit("floating-bots:menu", fromMain, { x: 1, y: 1 });
    expect(popup).toHaveBeenCalledOnce();
  });
});

describe("floating bots: the mascot's right-click menu", () => {
  const MENU = [
    { id: "balloon", label: "Talk" },
    { id: "call", label: "Start a voice call" },
    { id: "open", label: "Open in Sagax" },
    { id: "sep-1", label: "", type: "separator" },
    { id: "switch", label: "Switch bot", items: [{ id: "switch:bot_a", label: "Ada", checked: true }, { id: "switch:bot_b", label: "Bo" }, { id: "switch:bot_c", label: "Cy", enabled: false }] },
    { id: "moves", label: "Moves", items: [{ id: "move:wave", label: "Wave" }, { id: "move:dance", label: "Dance" }] },
    { id: "sep-2", label: "", type: "separator" },
    { id: "snooze", label: "Hide for 1 hour" },
    { id: "dock", label: "Put back in the window" },
    { id: "sep-3", label: "", type: "separator" },
    { id: "options", label: "On the desktop", items: [{ id: "top", label: "Always on top", checked: true }] },
    { id: "settings", label: "Settings" },
  ];
  const popMenu = () => {
    const popup = vi.fn();
    let template = null;
    const Menu = { buildFromTemplate: vi.fn((items) => { template = items; return { popup }; }) };
    const ctx = setup({ Menu });
    const a = ctx.open("bot_a");
    ctx.emit("floating-bots:update", ctx.fromMain, { botId: "bot_a", snapshot: { ...SNAPSHOT, menu: MENU } });
    ctx.emit("floating-bots:menu", a.from, { x: 10, y: 10 });
    return { ...ctx, a, popup, template: () => template };
  };
  const sentToBrain = (fake) => fake.main.webContents.sent.filter(([channel]) => channel === "floating-bots:event").map(([, value]) => value.event.id);

  it("passes the balloon's composer row labels, bounded, and nothing else", () => {
    const clean = sanitizeFloatingSnapshot({ ...SNAPSHOT, balloon: { ...SNAPSHOT.balloon, input: { ...SNAPSHOT.balloon.input, attach: "Joindre", model: "m".repeat(200), modelTitle: "t", url: "https://x" } } });
    expect(clean.balloon.input).toEqual({ label: "Message", placeholder: "Écrire", send: "Envoyer", attach: "Joindre", model: "m".repeat(80), modelTitle: "t" });
    const none = sanitizeFloatingSnapshot({ ...SNAPSHOT, balloon: { ...SNAPSHOT.balloon, input: { ...SNAPSHOT.balloon.input, attach: 3, model: "" } } });
    expect(none.balloon.input).toEqual({ label: "Message", placeholder: "Écrire", send: "Envoyer" });
  });

  it("brings the app forward for the balloon's clip and model chip, then tells the brain", () => {
    const { open, emit, fake, focusMain } = setup();
    const { from } = open("bot_a");
    emit("floating-bots:event", from, { type: "menu", id: "attach" });
    emit("floating-bots:event", from, { type: "menu", id: "model" });
    expect(focusMain).toHaveBeenCalledTimes(2);
    expect(fake.main.webContents.sent.slice(-2).map(([, value]) => value.event.id)).toEqual(["attach", "model"]);
  });

  it("keeps separators, greyed items and one level of submenus, bounded", () => {
    const clean = sanitizeFloatingSnapshot({ ...SNAPSHOT, menu: MENU }).menu;
    expect(clean).toEqual(MENU);
    const deep = sanitizeFloatingSnapshot({ ...SNAPSHOT, menu: [{ id: "a", label: "A", items: [{ id: "b", label: "B", items: [{ id: "c", label: "C" }] }] }] }).menu;
    // no submenu inside a submenu
    expect(deep[0].items[0]).toEqual({ id: "b", label: "B" });
    const many = sanitizeFloatingSnapshot({ ...SNAPSHOT, menu: [{ id: "switch", label: "Switch", items: Array.from({ length: 50 }, (_, i) => ({ id: `switch:b${i}`, label: "x" })) }] }).menu;
    expect(many[0].items).toHaveLength(SUBMENU_MAX);
    // a menu id may carry a 64-character bot id
    expect(sanitizeFloatingEvent({ type: "menu", id: `switch:${"b".repeat(64)}` })).toEqual({ type: "menu", id: `switch:${"b".repeat(64)}` });
    expect(sanitizeFloatingEvent({ type: "menu", id: "x".repeat(81) })).toBeNull();
  });

  it("builds the native menu with its separators, submenus and greyed items", () => {
    const choose = vi.fn();
    const template = menuTemplate(sanitizeFloatingSnapshot({ ...SNAPSHOT, menu: MENU }).menu, choose);
    expect(template.map((item) => item.type === "separator" ? "-" : item.label)).toEqual(["Talk", "Start a voice call", "Open in Sagax", "-", "Switch bot", "Moves", "-", "Hide for 1 hour", "Put back in the window", "-", "On the desktop", "Settings"]);
    expect(template[4].submenu.map((item) => item.label)).toEqual(["Ada", "Bo", "Cy"]);
    expect(template[4].submenu[0]).toMatchObject({ type: "checkbox", checked: true });
    expect(template[4].submenu[2]).toMatchObject({ enabled: false });
    template[4].submenu[1].click();
    expect(choose).toHaveBeenCalledWith("switch:bot_b");
  });

  it("sends each choice to the brain for this window's bot, and brings the app forward for Open and Settings", () => {
    const { template, fake, focusMain } = popMenu();
    const items = template();
    for (const label of ["Talk", "Start a voice call", "Hide for 1 hour", "Put back in the window"]) items.find((item) => item.label === label).click();
    expect(focusMain).not.toHaveBeenCalled();
    items.find((item) => item.label === "Open in Sagax").click();
    expect(focusMain).toHaveBeenCalledTimes(1);
    items.find((item) => item.label === "Settings").click();
    expect(focusMain).toHaveBeenCalledTimes(2);
    items.find((item) => item.label === "Switch bot").submenu[1].click();
    expect(sentToBrain(fake)).toEqual(["balloon", "call", "snooze", "dock", "open", "settings", "switch:bot_b"]);
  });

  it("main passes electron Menu so a right click can pop the native menu", () => {
    const src = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
    const start = src.indexOf("const floatingBotWindows = createFloatingBotWindows");
    expect(start).toBeGreaterThan(-1);
    expect(src.slice(start, start + 1800)).toMatch(/\bMenu,/);
  });

  it("skips the native menu when Menu was not given", () => {
    const { emit, open, fromMain, logs } = setup();
    const a = open("bot_a");
    emit("floating-bots:update", fromMain, { botId: "bot_a", snapshot: { ...SNAPSHOT, menu: MENU } });
    emit("floating-bots:menu", a.from, { x: 10, y: 10 });
    expect(logs.some((line) => line.includes("Menu was not given"))).toBe(true);
  });

  it("plays a move in the mascot's own window, without the brain", () => {
    const { template, fake, a } = popMenu();
    template().find((item) => item.label === "Moves").submenu[1].click();
    expect(a.win.webContents.sent.at(-1)).toEqual(["floating-bot:move", "dance"]);
    expect(sentToBrain(fake)).toEqual([]);
  });

  it("switches a window to another bot in place: same spot, the new bot's state, and its later choices", () => {
    const { invoke, emit, fromMain, fake, controller, a, template, saved } = popMenu();
    const spot = a.win.getBounds();
    emit("floating-bots:update", fromMain, { botId: "bot_b", snapshot: { ...SNAPSHOT, name: "Bo" } });
    expect(invoke("floating-bots:rekey", fromMain, { from: "bot_a", to: "bot_b" })).toBe(true);
    expect(controller.window("bot_b")).toBe(a.win);
    expect(controller.window("bot_a")).toBeNull();
    expect(a.win.getBounds()).toEqual(spot);
    // the state kept for the new bot reaches the window at once, and the new bot keeps the spot
    expect(a.win.webContents.sent.at(-1)[1]).toMatchObject({ name: "Bo" });
    expect(Object.values(saved.positions)[0].bot_b).toBeDefined();
    // a choice in a menu opened before the switch speaks for the new bot
    template().find((item) => item.label === "Talk").click();
    expect(fake.main.webContents.sent.at(-1)).toEqual(["floating-bots:event", { botId: "bot_b", event: { type: "menu", id: "balloon" } }]);
    // only the app page, a known window, a free id
    expect(invoke("floating-bots:rekey", a.from, { from: "bot_b", to: "bot_c" })).toBe(false);
    expect(invoke("floating-bots:rekey", fromMain, { from: "nope", to: "bot_c" })).toBe(false);
    invoke("floating-bots:open", fromMain, { botId: "bot_c" });
    expect(invoke("floating-bots:rekey", fromMain, { from: "bot_b", to: "bot_c" })).toBe(false);
    // closed from outside after a switch: the brain hears of the new bot
    a.win.destroy();
    expect(fake.main.webContents.sent.at(-1)).toEqual(["floating-bots:closed", { botId: "bot_b" }]);
  });
});

describe("the desktop window's mascot look", () => {
  it("knows every shape and Trombi skin, and maps older names like the app", () => {
    for (const skin of SHAPE_SKINS) expect(mascotLook({ character: "shape", skins: { shape: skin } }).skins.shape).toBe(skin);
    for (const skin of TROMBI_SKINS) expect(mascotLook({ character: "trombi", skins: { trombi: skin } }).skins.trombi).toBe(skin);
    for (const [old, current] of Object.entries(LEGACY_SHAPE_SKINS)) expect(mascotLook({ character: "shape", skins: { shape: old } }).skins.shape).toBe(current);
    for (const [old, current] of Object.entries(LEGACY_TROMBI_SKINS)) expect(mascotLook({ character: "trombi", skins: { trombi: old } }).skins.trombi).toBe(current);
    expect(mascotLook({ character: "shape", skins: { shape: "plasma" } })).toEqual({ character: "shape" });
  });

  // #5349: the engine's look settings reach the desktop mascot with the look, known values only
  it("keeps the engine's look settings (material, mood, eye colour, depth, pointer), and drops one it does not know", () => {
    const settings = { material: "fluffy", mood: "happy", eyeColor: "#ffffff", depth: 10, followPointer: false };
    expect(mascotLook({ character: "shape", shape: "cup", ...settings })).toEqual({ character: "shape", shape: "cup", ...settings });
    expect(mascotLook({ character: "shape", material: "glass" })).toEqual({ character: "shape", material: "glass" });
    expect(mascotLook({ character: "shape", material: "flat", mood: "neutral", depth: 0, followPointer: true })).toEqual({ character: "shape", material: "flat", mood: "neutral", depth: 0, followPointer: true });
    expect(mascotLook({ character: "shape", material: "velvet", mood: "sleepy", eyeColor: "red", depth: 99, followPointer: "no", state: "working" })).toEqual({ character: "shape" });
    expect(mascotLook({ character: "shape", eyeColor: "#2A8FE8" })).toEqual({ character: "shape", eyeColor: "#2a8fe8" });
    // a look stored before the settings is unchanged
    expect(mascotLook({ character: "shape", shape: "cup", skins: { shape: "gold" } })).toEqual({ character: "shape", shape: "cup", skins: { shape: "gold" } });
  });

  it("knows Bunbu and its twelve skins, legacy names included, and drops a skin it does not know", () => {
    for (const skin of BUNBU_SKINS) expect(mascotLook({ character: "bunbu", skins: { bunbu: skin } })).toEqual({ character: "bunbu", skins: { bunbu: skin } });
    for (const [old, current] of Object.entries(LEGACY_BUNBU_SKINS)) expect(mascotLook({ character: "bunbu", skins: { bunbu: old } }).skins.bunbu).toBe(current);
    expect(mascotLook({ character: "bunbu", skins: { bunbu: "junk" } })).toEqual({ character: "bunbu" });
  });

  it("passes a nudge, an achievement or a snooze cue on to the window, and nothing else", () => {
    expect(sanitizeCue({ kind: "nudge", at: 12 })).toEqual({ kind: "nudge", at: 12 });
    expect(sanitizeCue({ kind: "snooze", at: 1, botId: "x" })).toEqual({ kind: "snooze", at: 1 });
    expect(sanitizeCue({ kind: "explode", at: 1 })).toBeNull();
    expect(sanitizeCue({ kind: "nudge", at: Number.NaN })).toBeNull();
    expect(sanitizeCue(null)).toBeNull();
  });

  it("knows Shiba and its thirteen skins, legacy names included, as the app does", () => {
    for (const skin of SHIBA_SKINS) expect(mascotLook({ character: "shiba", skins: { shiba: skin } })).toEqual({ character: "shiba", skins: { shiba: skin } });
    for (const [old, current] of Object.entries(LEGACY_SHIBA_SKINS)) expect(mascotLook({ character: "shiba", skins: { shiba: old } }).skins.shiba).toBe(current);
    expect(mascotLook({ character: "shiba", skins: { shiba: "junk", bunbu: "gold" } })).toEqual({ character: "shiba", skins: { bunbu: "gold" } });
  });

  it("knows Grump and its thirteen skins, legacy names included, as the app does", () => {
    for (const skin of GRUMP_SKINS) expect(mascotLook({ character: "grump", skins: { grump: skin } })).toEqual({ character: "grump", skins: { grump: skin } });
    for (const [old, current] of Object.entries(LEGACY_GRUMP_SKINS)) expect(mascotLook({ character: "grump", skins: { grump: old } }).skins.grump).toBe(current);
    expect(mascotLook({ character: "grump", skins: { grump: "junk", shiba: "gold" } })).toEqual({ character: "grump", skins: { shiba: "gold" } });
  });

  it("knows Ogre and its thirteen skins, legacy names included, as the app does", () => {
    for (const skin of OGRE_SKINS) expect(mascotLook({ character: "ogre", skins: { ogre: skin } })).toEqual({ character: "ogre", skins: { ogre: skin } });
    for (const [old, current] of Object.entries(LEGACY_OGRE_SKINS)) expect(mascotLook({ character: "ogre", skins: { ogre: old } }).skins.ogre).toBe(current);
    expect(mascotLook({ character: "ogre", skins: { ogre: "junk", shiba: "red" } })).toEqual({ character: "ogre", skins: { shiba: "red" } });
  });

  it("knows Frog and its thirteen skins, legacy names included, as the app does", () => {
    for (const skin of FROG_SKINS) expect(mascotLook({ character: "frog", skins: { frog: skin } })).toEqual({ character: "frog", skins: { frog: skin } });
    for (const [old, current] of Object.entries(LEGACY_FROG_SKINS)) expect(mascotLook({ character: "frog", skins: { frog: old } }).skins.frog).toBe(current);
    expect(mascotLook({ character: "frog", skins: { frog: "junk", shiba: "red" } })).toEqual({ character: "frog", skins: { shiba: "red" } });
  });

  it("knows Crab and its fourteen skins, legacy names included, as the app does", () => {
    for (const skin of CRAB_SKINS) expect(mascotLook({ character: "crab", skins: { crab: skin } })).toEqual({ character: "crab", skins: { crab: skin } });
    for (const [old, current] of Object.entries(LEGACY_CRAB_SKINS)) expect(mascotLook({ character: "crab", skins: { crab: old } }).skins.crab).toBe(current);
    expect(mascotLook({ character: "crab", skins: { crab: "junk", frog: "tree" } })).toEqual({ character: "crab", skins: { frog: "tree" } });
  });
});

describe("floating bots: a smooth chat", () => {
  it("saves a dragged spot once the window stands still, not at every step macOS reports", () => {
    vi.useFakeTimers();
    try {
      const { open, invoke, saved } = setup();
      const { win, from } = open("bot_a");
      for (let i = 0; i < 30; i += 1) {
        invoke("floating-bots:move-by", from, { dx: -3, dy: -2 });
        win.events.get("moved")?.forEach((fn) => fn());
      }
      expect(saved.positions).toBeUndefined();
      vi.advanceTimersByTime(REMEMBER_DELAY_MS);
      const spot = win.getBounds();
      expect(Object.values(saved.positions)[0].bot_a).toEqual({ x: spot.x + FLOAT_BODY.x + FLOAT_BODY.width, y: spot.y + FLOAT_BODY.y + FLOAT_BODY.height, v: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never saves the steps of the mascot's own flight, even when it lands before the delay", () => {
    vi.useFakeTimers();
    try {
      const { open, emit, invoke, saved } = setup();
      const { win, from } = open("bot_a");
      emit("floating-bots:autopilot", from, true);
      invoke("floating-bots:move-to", from, { x: 100, y: 300 });
      win.events.get("moved")?.forEach((fn) => fn());
      emit("floating-bots:autopilot", from, false);
      vi.advanceTimersByTime(REMEMBER_DELAY_MS * 2);
      expect(saved.positions).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves a window without resizing it, and asks nothing when nothing changes", () => {
    const { open, invoke } = setup();
    const { win, from } = open("bot_a");
    win.calls.length = 0;
    invoke("floating-bots:move-by", from, { dx: -10, dy: -10 });
    expect(win.calls.map(([name]) => name)).toEqual(["setPosition"]);
    const { width, height } = win.getBounds();
    win.calls.length = 0;
    invoke("floating-bots:resize", from, { width, height });
    expect(win.calls).toEqual([]);
    invoke("floating-bots:resize", from, { width: width + 100, height: height + 100 });
    expect(win.calls.map(([name]) => name)).toEqual(["setBounds"]);
  });

  it("lets clicks through or takes them only on a change, and focuses only a window without the focus", () => {
    const { open, emit } = setup();
    const { win, from } = open("bot_a");
    win.calls.length = 0;
    for (const on of [true, true, true, false, false, true]) emit("floating-bots:set-interactive", from, on);
    expect(win.calls.filter(([name]) => name === "setIgnoreMouseEvents").map(([, ignore]) => ignore)).toEqual([false, true, false]);
    for (const on of [true, true, true]) emit("floating-bots:set-focusable", from, on);
    expect(win.calls.filter(([name]) => name === "setFocusable")).toEqual([["setFocusable", true]]);
    expect(win.calls.filter(([name]) => name === "focus")).toHaveLength(1);
    emit("floating-bots:set-focusable", from, false);
    expect(win.calls.filter(([name]) => name === "setFocusable").at(-1)).toEqual(["setFocusable", false]);
  });

  it("passes the app's theme to the window: a known skin and a hex accent only", () => {
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, theme: { skin: "pulsatrix-light", accent: "#336699" } }).theme).toEqual({ skin: "pulsatrix-light", accent: "#336699" });
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, theme: { skin: "pulsatrix-light", accent: "javascript:x" } }).theme).toEqual({ skin: "pulsatrix-light" });
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, theme: { skin: "other" } })).not.toHaveProperty("theme");
    expect(sanitizeFloatingSnapshot(SNAPSHOT)).not.toHaveProperty("theme");
    expect(appTheme({ skin: "dusk", accent: "#abcdef", extra: 1 })).toEqual({ skin: "dusk", accent: "#abcdef" });
    // main's list is the app's list
    expect([...APP_SKINS].sort()).toEqual([...SKIN_IDS].sort());
  });
});

describe("floating bots: a drag follows the pointer's path", () => {
  it("crosses onto the next display in small steps, and loses no ground held at an edge", () => {
    const { open, invoke, emit } = setup({ displays: [PRIMARY, SECOND] });
    const { win, from } = open("bot_a");
    const bodyX = () => win.getBounds().x + FLOAT_BODY.x;
    // to the primary's right edge (the second display is past it), then on in 10 px steps
    invoke("floating-bots:move-to", from, { x: PRIMARY.workArea.x + PRIMARY.workArea.width - FLOAT_BODY.x - FLOAT_BODY.width, y: 200 });
    emit("floating-bots:moved", from);
    for (let i = 0; i < 6; i += 1) invoke("floating-bots:move-by", from, { dx: 10, dy: 0 });
    // held at the seam while it is still mostly on the primary
    expect(bodyX() + FLOAT_BODY.width).toBe(PRIMARY.workArea.x + PRIMARY.workArea.width);
    for (let i = 0; i < 6; i += 1) invoke("floating-bots:move-by", from, { dx: 10, dy: 0 });
    // past the middle of its box: on the second display
    expect(bodyX()).toBeGreaterThanOrEqual(SECOND.workArea.x);
    // back the way it came: it follows the pointer again at once
    for (let i = 0; i < 12; i += 1) invoke("floating-bots:move-by", from, { dx: -10, dy: 0 });
    expect(bodyX() + FLOAT_BODY.width).toBe(PRIMARY.workArea.x + PRIMARY.workArea.width);
    // the drag ended: the next one starts from where the window stands
    emit("floating-bots:moved", from);
    const at = bodyX();
    invoke("floating-bots:move-by", from, { dx: -10, dy: 0 });
    expect(bodyX()).toBe(at - 10);
  });
});
