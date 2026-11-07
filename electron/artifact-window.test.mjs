// An artifact in a real desktop window of its own (electron/artifact-window.mjs):
// one window per artifact, its place kept per artifact and brought back on a
// screen that still exists, opened where a dragged-out panel was let go, and
// gone with the main window so nothing keeps the app from quitting.
import { describe, expect, it, vi } from "vitest";

import {
  applyArtifactWindowOnTop,
  ARTIFACT_WINDOW_MIN,
  ARTIFACT_WINDOW_SIZE,
  artifactWindowNavigationAllowed,
  CLAUDE_AI_PARTITION,
  claudeAiArtifactUrl,
  claudeAiNavigationAllowed,
  claudeAiPermissionAllowed,
  createArtifactWindows,
  MAX_REMEMBERED_PLACES,
  pageWindowChromeOptions,
  watchWindowPointer,
  parseArtifactWindowPlaces,
  resolveArtifactWindowBounds,
  sanitizeArtifactWindowRequest,
} from "./artifact-window.mjs";

const ORIGIN = "http://127.0.0.1:48996";
const PRIMARY = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
const SECOND = { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } };

function fakeElectron() {
  const handlers = new Map();
  const windows = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width, height: options.height };
      this.destroyed = false;
      this.onTop = options.alwaysOnTop === true;
      this.events = new Map();
      this.calls = [];
      const contentHandlers = new Map();
      this.webContents = {
        handlers: contentHandlers,
        setWindowOpenHandler: (fn) => { this.openHandler = fn; },
        on: (name, fn) => contentHandlers.set(name, [...(contentHandlers.get(name) ?? []), fn]),
        fire: (name, ...args) => (contentHandlers.get(name) ?? []).forEach((fn) => fn(...args)),
      };
      this.loadURL = vi.fn(async () => undefined);
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    close() {
      if (this.destroyed) return;
      this.fire("close");
      this.destroyed = true;
      this.fire("closed");
    }
    setTitle(title) { this.calls.push(["setTitle", title]); }
    setAlwaysOnTop(flag, level) { this.onTop = flag === true; this.calls.push(["setAlwaysOnTop", flag, level]); }
    isAlwaysOnTop() { return this.onTop === true; }
    isMinimized() { return false; }
    isMaximized() { return false; }
    isFullScreen() { return this.fullscreen === true; }
    setFullScreen(on) { this.fullscreen = on === true; this.calls.push(["setFullScreen", on === true]); }
    maximize() { this.calls.push(["maximize"]); }
    getBounds() { return { ...this.bounds }; }
    getNormalBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.fire("resize"); this.fire("move"); }
    show() { this.calls.push(["show"]); }
    showInactive() { this.calls.push(["showInactive"]); }
    focus() { this.calls.push(["focus"]); }
    on(name, fn) { this.events.set(name, [...(this.events.get(name) ?? []), fn]); }
    once(name, fn) {
      const wrap = (...args) => {
        const list = this.events.get(name) ?? [];
        this.events.set(name, list.filter((entry) => entry !== wrap));
        fn(...args);
      };
      this.on(name, wrap);
    }
    fire(name, ...args) { (this.events.get(name) ?? []).forEach((fn) => fn(...args)); }
  }
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
  };
  const sent = [];
  const main = {
    webContents: { getURL: () => `${ORIGIN}/`, send: (...args) => sent.push(args) },
    isDestroyed: () => false,
    getBounds: () => ({ x: 100, y: 100, width: 1200, height: 800 }),
  };
  return { BrowserWindow: FakeWindow, ipcMain, handlers, windows, main, sent };
}

function memoryStore(initial = null) {
  let value = initial;
  return { read: () => value, write: vi.fn((next) => { value = JSON.parse(JSON.stringify(next)); }), get: () => value };
}

function setup({ displays = [PRIMARY, SECOND], store = memoryStore(), trusted = true, session, openExternal, preload = "/app/electron/artifact-window-preload.cjs" } = {}) {
  const fake = fakeElectron();
  const onChange = vi.fn();
  const screen = {
    getPrimaryDisplay: () => displays[0],
    getAllDisplays: () => displays,
    getDisplayMatching: (bounds) => {
      const point = { x: (bounds?.x ?? 0) + ((bounds?.width ?? 0) / 2), y: (bounds?.y ?? 0) + ((bounds?.height ?? 0) / 2) };
      return displays.find((display) => {
        const area = display.workArea;
        return point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height;
      }) ?? displays[0];
    },
  };
  const controller = createArtifactWindows({
    BrowserWindow: fake.BrowserWindow,
    ipcMain: fake.ipcMain,
    getMainWindow: () => fake.main,
    isTrustedMain: () => trusted,
    screen,
    boundsStore: store,
    onChange,
    preload,
    ...(session ? { session } : {}),
    ...(openExternal ? { openExternal } : {}),
  });
  const event = { sender: fake.main.webContents, senderFrame: { url: `${ORIGIN}/` } };
  const open = (request) => fake.handlers.get("artifact-window:open")(event, { botId: "bot-a", title: "Live table", ...request });
  return { fake, controller, open, onChange, store, event };
}

describe("artifact window requests", () => {
  it("keeps the ids, a plain title, a size, a screen point, the focus choice and always-on-top", () => {
    expect(sanitizeArtifactWindowRequest({ botId: "bot-a", artifactId: "art_1", title: "Live\ntable", x: 1500.4, y: 200, focus: false, alwaysOnTop: true })).toEqual({
      botId: "bot-a", artifactId: "art_1", title: "Live table", width: ARTIFACT_WINDOW_SIZE.width, height: ARTIFACT_WINDOW_SIZE.height, at: { x: 1500, y: 200 }, focus: false, alwaysOnTop: true,
    });
    expect(sanitizeArtifactWindowRequest({ botId: "bot-a", artifactId: "../x" })).toBeNull();
    expect(sanitizeArtifactWindowRequest({ botId: "bot-a", artifactId: "art_1", x: 1e9, y: 0 })).not.toHaveProperty("at");
    expect(sanitizeArtifactWindowRequest({ botId: "bot-a", artifactId: "art_1" })).not.toHaveProperty("alwaysOnTop");
  });

  it("only navigates within its own route", () => {
    expect(artifactWindowNavigationAllowed(`${ORIGIN}/artifact-window#bot=a&artifact=b`, ORIGIN)).toBe(true);
    expect(artifactWindowNavigationAllowed(`${ORIGIN}/`, ORIGIN)).toBe(false);
    expect(artifactWindowNavigationAllowed("https://example.com/artifact-window", ORIGIN)).toBe(false);
  });
});

describe("where an artifact window opens", () => {
  const request = { width: 960, height: 720 };
  const areas = [PRIMARY.workArea, SECOND.workArea];

  it("comes back at its remembered place on a screen that still exists", () => {
    const place = { bounds: { x: 1600, y: 100, width: 800, height: 600 }, maximized: false };
    expect(resolveArtifactWindowBounds({ place, workAreas: areas, home: PRIMARY.workArea, request }).bounds).toEqual(place.bounds);
  });

  it("comes back on the primary screen when its screen is gone", () => {
    const place = { bounds: { x: 1600, y: 100, width: 800, height: 600 }, maximized: false };
    const { bounds } = resolveArtifactWindowBounds({ place, workAreas: [PRIMARY.workArea], home: PRIMARY.workArea, request });
    expect(bounds).toEqual({ x: 320, y: 163, width: 800, height: 600 });
  });

  it("opens where a dragged-out panel was let go, on that screen", () => {
    const { bounds } = resolveArtifactWindowBounds({ workAreas: areas, home: PRIMARY.workArea, request: { ...request, at: { x: 2000, y: 300 } } });
    expect(bounds).toEqual({ x: 1520, y: 284, width: 960, height: 720 });
  });

  it("is centered on the app's screen the first time, never larger than it", () => {
    const small = { x: 0, y: 0, width: 800, height: 600 };
    expect(resolveArtifactWindowBounds({ workAreas: [small], home: small, request }).bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it("keeps the most recent places only and drops malformed ones", () => {
    const windows = Object.fromEntries(Array.from({ length: MAX_REMEMBERED_PLACES + 5 }, (_, index) => [`art_${index}`, { bounds: { x: 0, y: 0, width: 400, height: 300 } }]));
    windows.bad = { bounds: { x: "1", y: 0, width: 1, height: 1 } };
    const places = parseArtifactWindowPlaces({ windows });
    expect(places.size).toBe(MAX_REMEMBERED_PLACES);
    expect(places.has("art_0")).toBe(false);
    expect(places.has("bad")).toBe(false);
  });
});

describe("artifact windows", () => {
  it("opens a real, isolated, resizable window and lists it in the Window menu", async () => {
    const { fake, controller, open, onChange } = setup();
    expect(await open({ artifactId: "art_1" })).toBe("created");
    const [win] = fake.windows;
    expect(win.options).toMatchObject({
      resizable: true,
      movable: true,
      fullscreenable: true,
      minWidth: ARTIFACT_WINDOW_MIN.width,
      minHeight: ARTIFACT_WINDOW_MIN.height,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: "/app/electron/artifact-window-preload.cjs" },
    });
    expect(win.events.has("enter-full-screen")).toBe(true);
    expect(win.events.has("leave-full-screen")).toBe(true);
    expect(win.loadURL).toHaveBeenCalledWith(`${ORIGIN}/artifact-window#bot=bot-a&artifact=art_1`);
    expect(controller.entries()).toEqual([{ artifactId: "art_1", title: "Live table" }]);
    expect(onChange).toHaveBeenCalled();
    win.fire("ready-to-show");
    expect(win.calls).toContainEqual(["focus"]);
  });

  it("toggles always on top from the main window and from the page window itself (#2046)", async () => {
    const { fake, open, event, store } = setup();
    expect(await open({ artifactId: "page:pageAAAA1111" })).toBe("created");
    const [win] = fake.windows;
    expect(win.onTop).toBe(false);
    expect(await fake.handlers.get("artifact-window:set-top")(event, { artifactId: "page:pageAAAA1111", on: true })).toBe(true);
    expect(win.calls).toContainEqual(["setAlwaysOnTop", true, "floating"]);
    expect(await fake.handlers.get("artifact-window:get-top")(event, { artifactId: "page:pageAAAA1111" })).toBe(true);
    // the page window itself (sender = its webContents) may toggle without an id
    expect(await fake.handlers.get("artifact-window:set-top")({ sender: win.webContents }, { on: false })).toBe(true);
    expect(win.calls.at(-1)).toEqual(["setAlwaysOnTop", false, undefined]);
    expect(await fake.handlers.get("artifact-window:get-top")({ sender: win.webContents })).toBe(false);
    expect(await fake.handlers.get("artifact-window:set-top")({ sender: win.webContents }, { on: true })).toBe(true);
    // a stranger's sender cannot toggle
    expect(await fake.handlers.get("artifact-window:set-top")({ sender: {} }, { on: false })).toBe(false);
    win.close();
    expect(store.get().windows["page:pageAAAA1111"].alwaysOnTop).toBe(true);
  });

  it("a page window has no native title bar; an artifact window keeps its own (#2336)", async () => {
    expect(pageWindowChromeOptions("darwin")).toEqual({ titleBarStyle: "customButtonsOnHover" });
    expect(pageWindowChromeOptions("win32")).toEqual({ frame: false });
    expect(pageWindowChromeOptions("linux")).toEqual({ frame: false });
  });

  it("tells the page when the cursor enters or leaves its window (#2336)", () => {
    const sent = [];
    const win = { isDestroyed: () => false, getBounds: () => ({ x: 100, y: 100, width: 400, height: 300 }), webContents: { send: (...args) => sent.push(args) } };
    let cursor = { x: 10, y: 10 };
    const watch = watchWindowPointer(win, { getCursorScreenPoint: () => cursor }, 60_000);
    watch.tick();
    cursor = { x: 200, y: 200 };
    watch.tick();
    watch.tick();
    cursor = { x: 500, y: 200 };
    watch.tick();
    watch.stop();
    expect(sent).toEqual([["artifact-window:pointer", false], ["artifact-window:pointer", true], ["artifact-window:pointer", false]]);
    expect(watchWindowPointer(win, {})).toBeNull();
  });

  it("remembers always-on-top and puts it back the next time (#2046)", async () => {
    const store = memoryStore({ version: 1, windows: { "page:pageAAAA1111": { bounds: { x: 100, y: 80, width: 700, height: 500 }, maximized: false, alwaysOnTop: true } } });
    const { fake, open } = setup({ store });
    expect(await open({ artifactId: "page:pageAAAA1111" })).toBe("created");
    expect(fake.windows[0].options.alwaysOnTop).toBe(true);
    expect(fake.windows[0].calls).toContainEqual(["setAlwaysOnTop", true, "floating"]);
  });

  it("applyArtifactWindowOnTop uses the floating level when on", () => {
    const win = { destroyed: false, isDestroyed() { return this.destroyed; }, calls: [], setAlwaysOnTop(flag, level) { this.calls.push([flag, level]); } };
    expect(applyArtifactWindowOnTop(win, true)).toBe(true);
    expect(applyArtifactWindowOnTop(win, false)).toBe(true);
    expect(win.calls).toEqual([[true, "floating"], [false, undefined]]);
  });

  it("keeps one window per artifact: asking again brings it forward", async () => {
    const { fake, open, controller } = setup();
    await open({ artifactId: "art_1" });
    expect(await open({ artifactId: "art_1" })).toBe("focused");
    expect(fake.windows).toHaveLength(1);
    expect(fake.windows[0].calls.filter(([name]) => name === "focus")).toHaveLength(1);
    // restored without taking the focus
    expect(await open({ artifactId: "art_1", focus: false })).toBe("focused");
    expect(fake.windows[0].calls.filter(([name]) => name === "focus")).toHaveLength(1);
    expect(controller.show("art_1")).toBe(true);
    expect(fake.windows[0].calls.filter(([name]) => name === "focus")).toHaveLength(2);
  });

  it("refuses a page that is not the main window's own", async () => {
    const { fake, open } = setup({ trusted: false });
    expect(await open({ artifactId: "art_1" })).toBe("refused");
    expect(fake.windows).toHaveLength(0);
  });

  it("remembers its place per artifact and opens there next time", async () => {
    const store = memoryStore();
    const first = setup({ store });
    await first.open({ artifactId: "art_1" });
    first.fake.windows[0].bounds = { x: 1700, y: 120, width: 700, height: 500 };
    first.fake.windows[0].close();
    expect(store.get().windows.art_1.bounds).toEqual({ x: 1700, y: 120, width: 700, height: 500 });

    const second = setup({ store });
    await second.open({ artifactId: "art_1" });
    expect(second.fake.windows[0].options).toMatchObject({ x: 1700, y: 120, width: 700, height: 500 });
    // another artifact has no place yet: centered on the app's screen
    await second.open({ artifactId: "art_2" });
    expect(second.fake.windows[1].options).toMatchObject({ x: 240, y: 103, width: 960, height: 720 });
  });

  it("brings a place on a screen that is gone back to the primary screen", async () => {
    const store = memoryStore({ version: 1, windows: { art_1: { bounds: { x: 2000, y: 100, width: 700, height: 500 } } } });
    const { fake, open } = setup({ store, displays: [PRIMARY] });
    await open({ artifactId: "art_1" });
    const { x, y, width, height } = fake.windows[0].options;
    expect(x).toBeGreaterThanOrEqual(PRIMARY.workArea.x);
    expect(x + width).toBeLessThanOrEqual(PRIMARY.workArea.x + PRIMARY.workArea.width);
    expect(y).toBeGreaterThanOrEqual(PRIMARY.workArea.y);
    expect(y + height).toBeLessThanOrEqual(PRIMARY.workArea.y + PRIMARY.workArea.height);
  });

  it("tells the page when the person closes it, so the artifact docks", async () => {
    const { fake, open, controller } = setup();
    await open({ artifactId: "art_1" });
    fake.windows[0].close();
    expect(fake.sent).toContainEqual(["artifact-window:closed", { botId: "bot-a", artifactId: "art_1" }]);
    expect(controller.entries()).toEqual([]);
  });

  it("goes with the main window, quietly, so none is left to keep the app from quitting", async () => {
    const { fake, open, controller } = setup();
    await open({ artifactId: "art_1" });
    await open({ artifactId: "art_2" });
    controller.mainWindowGone();
    expect(fake.windows.every((win) => win.isDestroyed())).toBe(true);
    expect(controller.list()).toEqual([]);
    expect(fake.sent).toEqual([]);
  });
});

describe("claude.ai artifact windows (#2018)", () => {
  const URL_OK = "https://claude.ai/artifact/AbCdEf123456";

  it("accepts only a claude.ai artifact link, canonical", () => {
    expect(claudeAiArtifactUrl("https://www.claude.ai/code/artifact/AbCdEf123456/")).toBe("https://claude.ai/code/artifact/AbCdEf123456");
    expect(claudeAiArtifactUrl("http://claude.ai/artifact/AbCdEf123456")).toBeNull();
    expect(claudeAiArtifactUrl("https://claude.ai.example.com/artifact/AbCdEf123456")).toBeNull();
    expect(claudeAiArtifactUrl("https://user:pw@claude.ai/artifact/AbCdEf123456")).toBeNull();
    expect(claudeAiArtifactUrl("https://claude.ai/settings")).toBeNull();
  });

  it("navigates on claude.ai and its sign-in hosts only", () => {
    expect(claudeAiNavigationAllowed("https://claude.ai/login")).toBe(true);
    expect(claudeAiNavigationAllowed("https://accounts.google.com/o/oauth2/auth")).toBe(true);
    expect(claudeAiNavigationAllowed("https://console.anthropic.com/")).toBe(true);
    expect(claudeAiNavigationAllowed("http://claude.ai/")).toBe(false);
    expect(claudeAiNavigationAllowed("https://evilclaude.ai/")).toBe(false);
    expect(claudeAiNavigationAllowed("https://example.com/")).toBe(false);
    expect(claudeAiPermissionAllowed("media")).toBe(false);
    expect(claudeAiPermissionAllowed("clipboard-sanitized-write")).toBe(true);
  });

  it("opens claude.ai in the persistent claude-ai session, one window per link", async () => {
    const partitions = [];
    const shared = { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() };
    const { fake, event } = setup({ session: { fromPartition: (name) => { partitions.push(name); return shared; } } });
    const openClaude = (url) => fake.handlers.get("artifact-window:open-claude-ai")(event, { url });
    expect(await openClaude(`${URL_OK}/`)).toBe("created");
    const win = fake.windows.at(-1);
    expect(win.options.webPreferences).toMatchObject({ partition: CLAUDE_AI_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false });
    expect(win.options.webPreferences.preload).toBeUndefined();
    expect(win.loadURL).toHaveBeenCalledWith(URL_OK);
    expect(partitions).toEqual([CLAUDE_AI_PARTITION]);
    expect(shared.setPermissionRequestHandler).toHaveBeenCalled();
    expect(await openClaude(URL_OK)).toBe("focused");
    expect(fake.windows).toHaveLength(1);
    expect(await openClaude("https://example.com/artifact/AbCdEf123456")).toBe("refused");
  });

  it("sends a link off claude.ai to the system browser", async () => {
    const openExternal = vi.fn();
    const { fake, event } = setup({ openExternal });
    await fake.handlers.get("artifact-window:open-claude-ai")(event, { url: URL_OK });
    const win = fake.windows.at(-1);
    const prevent = vi.fn();
    win.webContents.fire("will-navigate", { preventDefault: prevent }, "https://example.com/elsewhere");
    expect(prevent).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith("https://example.com/elsewhere");
    const kept = vi.fn();
    win.webContents.fire("will-navigate", { preventDefault: kept }, "https://claude.ai/login");
    expect(kept).not.toHaveBeenCalled();
    expect(win.openHandler({ url: "https://example.com/x" })).toEqual({ action: "deny" });
    expect(win.openHandler({ url: "https://accounts.google.com/signin" }).action).toBe("allow");
  });

  it("refuses a page that is not the main window's own", async () => {
    const { fake, event } = setup({ trusted: false });
    expect(await fake.handlers.get("artifact-window:open-claude-ai")(event, { url: URL_OK })).toBe("refused");
  });
});

describe("page window fit-to-content (#2051)", () => {
  const PAGE_ID = "page:abcdefgh12345678";
  const PRELOAD = "/tmp/artifact-window-preload.cjs";

  it("gives a page window its preload and fits before show", async () => {
    vi.useFakeTimers();
    const { fake, open } = setup({ preload: PRELOAD });
    expect(await open({ artifactId: PAGE_ID, title: "KPI" })).toBe("created");
    const win = fake.windows[0];
    expect(win.options.webPreferences.preload).toBe(PRELOAD);
    win.fire("ready-to-show");
    expect(win.calls.map(([name]) => name)).not.toContain("show");
    const fromPage = { sender: win.webContents };
    const fitted = await fake.handlers.get("artifact-window:fit-content")(fromPage, { width: 640, height: 360 });
    expect(fitted).toMatchObject({ width: 640, height: 360 });
    expect(win.bounds).toMatchObject({ width: 640, height: 360 });
    expect(win.calls.map(([name]) => name)).toContain("show");
    vi.useRealTimers();
  });

  it("clamps a fit to the work area and refuses a non-page window", async () => {
    const { fake, open } = setup({ preload: PRELOAD });
    await open({ artifactId: PAGE_ID });
    const win = fake.windows[0];
    const fromPage = { sender: win.webContents };
    const fitted = await fake.handlers.get("artifact-window:fit-content")(fromPage, { width: 5000, height: 5000 });
    expect(fitted.width).toBeLessThanOrEqual(PRIMARY.workArea.width);
    expect(fitted.height).toBeLessThanOrEqual(PRIMARY.workArea.height);

    await open({ artifactId: "art_1" });
    const artifact = fake.windows[1];
    // Every artifact/page window loads the shared preload (#2046/#2043/#2051);
    // fit-content still answers only for a page window.
    expect(artifact.options.webPreferences.preload).toBe(PRELOAD);
    expect(await fake.handlers.get("artifact-window:fit-content")({ sender: artifact.webContents }, { width: 400, height: 300 })).toBeNull();
  });

  it("remembers a person resize and stops auto-fitting that page", async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const first = setup({ store, preload: PRELOAD });
    await first.open({ artifactId: PAGE_ID });
    const win = first.fake.windows[0];
    await first.fake.handlers.get("artifact-window:fit-content")({ sender: win.webContents }, { width: 640, height: 360 });
    // person drags the size: not during an applying fit
    win.bounds = { ...win.bounds, width: 900, height: 700 };
    win.fire("resize");
    await vi.advanceTimersByTimeAsync(500);
    expect(store.get().windows[PAGE_ID]).toMatchObject({
      bounds: { width: 900, height: 700 },
      personSized: true,
    });
    expect(await first.fake.handlers.get("artifact-window:fit-content")({ sender: win.webContents }, { width: 500, height: 300 })).toBeNull();
    expect(win.bounds).toMatchObject({ width: 900, height: 700 });
    win.close();

    const second = setup({ store, preload: PRELOAD });
    await second.open({ artifactId: PAGE_ID });
    const again = second.fake.windows[0];
    expect(again.options).toMatchObject({ width: 900, height: 700 });
    again.fire("ready-to-show");
    expect(again.calls.map(([name]) => name)).toContain("show");
    expect(await second.fake.handlers.get("artifact-window:fit-content")({ sender: again.webContents }, { width: 400, height: 280 })).toBeNull();
    vi.useRealTimers();
  });

  it("shows a page window after the fit timeout when no measure arrives", async () => {
    vi.useFakeTimers();
    const { fake, open } = setup({ preload: PRELOAD });
    await open({ artifactId: PAGE_ID });
    const win = fake.windows[0];
    win.fire("ready-to-show");
    expect(win.calls.map(([name]) => name)).not.toContain("show");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(win.calls.map(([name]) => name)).toContain("show");
    vi.useRealTimers();
  });

  it("skips fit while the window is fullscreen so auto-fit never fights OS fullscreen", async () => {
    const { fake, open } = setup({ preload: PRELOAD });
    await open({ artifactId: PAGE_ID });
    const win = fake.windows[0];
    win.fire("ready-to-show");
    win.fullscreen = true;
    const before = { ...win.bounds };
    expect(await fake.handlers.get("artifact-window:fit-content")({ sender: win.webContents }, { width: 640, height: 360 })).toBeNull();
    expect(win.bounds).toEqual(before);
  });
});
