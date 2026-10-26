import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import localOriginModule from "./local-origin.cjs";

const LOCAL = "http://127.0.0.1:8799";
const OTHER = "https://bots.example.test";

const fixture = vi.hoisted(() => ({ autoUpdater: null, handlers: new Map(), fetch: null, answer: 1, asked: [], idle: "active" }));

vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: () => "/unused-updater-test-log", getLocale: () => "fr-CA" },
  clipboard: { writeText: vi.fn() },
  dialog: {
    showMessageBox: vi.fn(async (...args) => {
      fixture.asked.push(args.at(-1));
      return { response: fixture.answer };
    }),
  },
  ipcMain: { handle: (name, handler) => fixture.handlers.set(name, handler) },
  net: { fetch: (...args) => fixture.fetch(...args) },
  powerMonitor: { getSystemIdleState: () => fixture.idle, getSystemIdleTime: () => 0 },
}));
vi.mock("node:module", () => ({
  createRequire: () => () => ({ autoUpdater: fixture.autoUpdater }),
}));

/** A page in the main window: its contents, and an IPC event it sends. */
function page(origin) {
  const mainFrame = { url: `${origin}/` };
  const webContents = { mainFrame, send: vi.fn() };
  return { webContents, event: { sender: webContents, senderFrame: mainFrame } };
}

/** main.mjs's rule: this app's own UI (local-origin.cjs isDesktopUiSender). */
const pageAllowed = (event) => localOriginModule.isDesktopUiSender(event);

/** A fresh updater module with a fake electron-updater behind it. */
async function load(allowed = pageAllowed) {
  vi.resetModules();
  fixture.handlers.clear();
  const autoUpdater = new EventEmitter();
  autoUpdater.checkForUpdates = vi.fn(async () => {
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-available", { version: "2.0.0" });
    return { isUpdateAvailable: true };
  });
  autoUpdater.downloadUpdate = vi.fn(async () => {
    autoUpdater.emit("download-progress", { percent: 50 });
    autoUpdater.emit("update-downloaded", { version: "2.0.0" });
    return ["/unused-staged-update.zip"];
  });
  autoUpdater.quitAndInstall = vi.fn();
  autoUpdater.setFeedURL = vi.fn();
  fixture.autoUpdater = autoUpdater;
  fixture.fetch = vi.fn(async () => ({ ok: false }));
  const updater = await import("./updater.mjs");
  updater.registerUpdaterIpc({ pageAllowed: allowed });
  return { updater, autoUpdater, handlers: fixture.handlers };
}

const settle = async () => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

beforeEach(() => {
  localOriginModule.setLocalOrigin(LOCAL);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("main wires the updater to this app's own UI only", () => {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  expect(source).toContain("registerUpdaterIpc({ pageAllowed: updaterPageAllowed });");
  expect(source).toContain("const updaterPageAllowed = (event) => isDesktopUiSender(event);");
});

it("pins the feed to Sagax's GitHub releases with pre-releases off by default", async () => {
  const { updater, autoUpdater } = await load();
  updater.startUpdater();
  expect(autoUpdater.setFeedURL).toHaveBeenLastCalledWith({ provider: "github", owner: "pulsatrixtechnologies", repo: "sagax" });
  expect(autoUpdater.allowPrerelease).toBe(false);
  expect(autoUpdater.allowDowngrade).toBe(false);
  expect(autoUpdater.fullChangelog).toBe(true);
});

it("a downloaded update installs when the app quits on macOS and AppImage only: never on Windows, never a system package", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const resourcesPath = process.resourcesPath;
  const appImage = process.env.APPIMAGE;
  const resources = mkdtempSync(join(tmpdir(), "sagax-updater-package-"));
  try {
    for (const [os, marker, image, installsOnQuit] of [
      ["darwin", null, null, true],
      // Windows: on quit electron-updater would run the installer silently.
      ["win32", null, null, false],
      ["linux", null, "/home/a/Sagax.AppImage", true],
      ["linux", "deb", null, false],
      ["linux", "rpm", null, false],
    ]) {
      Object.defineProperty(process, "platform", { ...platform, value: os });
      process.resourcesPath = resources;
      rmSync(join(resources, "package-type"), { force: true });
      if (marker) writeFileSync(join(resources, "package-type"), marker);
      if (image) process.env.APPIMAGE = image;
      else delete process.env.APPIMAGE;
      const { updater, autoUpdater } = await load(() => false);
      updater.startUpdater();
      expect(autoUpdater.autoInstallOnAppQuit, `${os} ${marker ?? image ?? ""}`).toBe(installsOnQuit);
      expect(autoUpdater.autoRunAppAfterInstall).toBe(true);
      // Nothing is installed by itself before then: the coordinator owns the download.
      expect(autoUpdater.autoDownload).toBe(false);
    }
  } finally {
    Object.defineProperty(process, "platform", platform);
    process.resourcesPath = resourcesPath;
    if (appImage === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = appImage;
    rmSync(resources, { recursive: true, force: true });
  }
});

it("downloads an update by itself: the first check after launch starts it, and nothing restarts", async () => {
  const local = page(LOCAL);
  const { updater, autoUpdater } = await load();
  updater.attachUpdaterWindow({ webContents: local.webContents });
  updater.startUpdater();

  await vi.advanceTimersByTimeAsync(15_000);
  await settle();

  expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  const statuses = local.webContents.send.mock.calls.map(([, state]) => state.status);
  expect(statuses).not.toContain("available");
  expect(statuses.at(-1)).toBe("downloaded");
});

it("an update found without notes shows our release body, read from GitHub's API", async () => {
  const local = page(LOCAL);
  const { updater } = await load();
  fixture.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: "pulsa-v2.0.0", body: "Quoi de neuf\n\n## English\n\nWhat's new" }) }));
  updater.attachUpdaterWindow({ webContents: local.webContents });
  updater.startUpdater();

  await vi.advanceTimersByTimeAsync(15_000);
  await settle();

  expect(fixture.fetch).toHaveBeenCalledTimes(1);
  expect(fixture.fetch.mock.calls[0][0]).toBe("https://api.github.com/repos/pulsatrixtechnologies/sagax/releases/tags/pulsa-v2.0.0");
  const last = local.webContents.send.mock.calls.at(-1)[1];
  expect(last.status).toBe("downloaded");
  expect(last.notes).toBe("Quoi de neuf\n\n## English\n\nWhat's new");
});

it("this app's own page reads and drives the update channels; another server's page is refused", async () => {
  const { handlers } = await load();
  expect([...handlers.keys()].sort()).toEqual(["update:check", "update:download", "update:get-state", "update:install", "update:install-when-idle", "update:report-activity", "update:set-auto-install-away", "update:set-channel", "update:set-prereleases"]);
  const local = page(LOCAL);
  expect(() => handlers.get("update:get-state")(local.event)).not.toThrow();
  const other = page(OTHER);
  for (const channel of handlers.keys()) expect(() => handlers.get(channel)(other.event), channel).toThrow(/only available/);
});

it("sends update news only to a page allowed to read it", async () => {
  const other = page(OTHER);
  const { updater, autoUpdater, handlers } = await load();
  updater.attachUpdaterWindow({ webContents: other.webContents });
  updater.startUpdater();
  await vi.advanceTimersByTimeAsync(15_000);
  await settle();
  expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(other.webContents.send).not.toHaveBeenCalled();
  expect(() => handlers.get("update:get-state")(other.event)).toThrow(/only available/);
});

it("sends updater progress to a reopened window without restarting the updater", async () => {
  const first = page(LOCAL);
  const { updater, autoUpdater, handlers } = await load();
  updater.attachUpdaterWindow({ webContents: first.webContents });
  updater.startUpdater();
  const listenerCount = autoUpdater.eventNames().reduce((count, name) => count + autoUpdater.listenerCount(name), 0);
  const timerCount = vi.getTimerCount();

  first.webContents.send.mockImplementation(() => { throw new Error("window destroyed"); });
  first.webContents.send.mockClear();
  const reopened = page(LOCAL);
  updater.attachUpdaterWindow({ webContents: reopened.webContents });

  await handlers.get("update:check")(reopened.event);
  await settle();

  expect(first.webContents.send).not.toHaveBeenCalled();
  expect(reopened.webContents.send.mock.calls.map(([, state]) => state.status))
    .toEqual(["checking", "downloading", "downloading", ...(process.platform === "darwin" ? ["preparing"] : []), "downloaded"]);
  expect(handlers.get("update:get-state")(reopened.event)).toMatchObject({ status: "downloaded", version: "2.0.0" });
  expect(autoUpdater.eventNames().reduce((count, name) => count + autoUpdater.listenerCount(name), 0)).toBe(listenerCount);
  expect(vi.getTimerCount()).toBe(timerCount);
});

/** Runs `body` as if on `os`, with an update downloaded and the local page attached. */
async function downloadedOn(os, body) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: os });
  try {
    const local = page(LOCAL);
    const loaded = await load();
    loaded.updater.attachUpdaterWindow({ webContents: local.webContents, isDestroyed: () => false });
    loaded.updater.startUpdater();
    await loaded.handlers.get("update:check")(local.event);
    await settle();
    expect(loaded.handlers.get("update:get-state")(local.event).status).toBe("downloaded");
    await body({ ...loaded, local });
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
}

it.each(["win32", "darwin", "linux"])("%s: an install the page did not confirm asks natively, and Later installs nothing", async (os) => {
  fixture.asked = [];
  fixture.answer = 1;
  await downloadedOn(os, async ({ autoUpdater, handlers, local }) => {
    // an older page's menu item: install() with no confirmation
    await handlers.get("update:install")(local.event);
    await handlers.get("update:install")(local.event, { confirmed: "true" });
    await settle();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(fixture.asked).toHaveLength(2);
    expect(fixture.asked[0]).toMatchObject({ buttons: ["Redémarrer pour installer", "Plus tard"], defaultId: 1, cancelId: 1 });
    expect(fixture.asked[0].message).toBe("Sagax 2.0.0 est prête à installer");
    expect(handlers.get("update:get-state")(local.event).status).toBe("downloaded");
  });
});

it("Windows: a yes to the native question runs the installer with its progress window, then reopens Sagax", async () => {
  fixture.asked = [];
  fixture.answer = 0;
  await downloadedOn("win32", async ({ autoUpdater, handlers, local }) => {
    await handlers.get("update:install")(local.event);
    await settle();
    expect(fixture.asked).toHaveLength(1);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
});

it.each([["win32", false], ["darwin", true], ["linux", true]])("%s: Restart to install in the update dialog installs without a second question", async (os, silent) => {
  fixture.asked = [];
  fixture.answer = 1;
  await downloadedOn(os, async ({ autoUpdater, handlers, local }) => {
    await handlers.get("update:install")(local.event, { confirmed: true });
    await settle();
    expect(fixture.asked).toHaveLength(0);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(silent, true);
  });
});

it.each(["win32", "darwin"])("%s: away install waits for a known, empty bot count and an away person; the native question names bots at work", async (os) => {
  fixture.asked = [];
  fixture.idle = "active";
  await downloadedOn(os, async ({ autoUpdater, handlers, local }) => {
    await handlers.get("update:set-auto-install-away")(local.event, true);
    // never reported: unknown, nothing installs even when away
    fixture.idle = "idle";
    await vi.advanceTimersByTimeAsync(61_000);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    // a bot works: nothing installs
    await handlers.get("update:report-activity")(local.event, 2);
    await settle();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(handlers.get("update:get-state")(local.event)).toMatchObject({ activeBots: 2, autoInstallWhenAway: true });
    // the person is back: nothing installs
    fixture.idle = "active";
    await handlers.get("update:report-activity")(local.event, 0);
    await settle();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    // away and no bot: installs through the same path (Windows keeps its visible installer)
    fixture.idle = "locked";
    await vi.advanceTimersByTimeAsync(61_000);
    await handlers.get("update:report-activity")(local.event, 0);
    await settle();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(os !== "win32", true);
  });
});

it("waiting for the bots restarts once none works, without needing the person away; the channel is named", async () => {
  fixture.idle = "active";
  await downloadedOn("darwin", async ({ autoUpdater, handlers, local }) => {
    await handlers.get("update:report-activity")(local.event, 1);
    await handlers.get("update:install-when-idle")(local.event, true);
    await settle();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    await handlers.get("update:report-activity")(local.event, 0);
    await settle();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect((await handlers.get("update:set-channel")(local.event, "nightly")).channel).toBe("nightly");
    expect(autoUpdater.allowPrerelease).toBe(true);
    expect((await handlers.get("update:set-channel")(local.event, "stable")).channel).toBe("stable");
  });
});

it("the wait for the bots ends with its update: an error or another version never installs on an old click", async () => {
  fixture.idle = "active";
  await downloadedOn("linux", async ({ autoUpdater, handlers, local }) => {
    await handlers.get("update:report-activity")(local.event, 1);
    expect((await handlers.get("update:install-when-idle")(local.event, true)).waitingForBots).toBe(true);
    // a newer version replaces the one the person saw
    autoUpdater.emit("update-downloaded", { version: "3.0.0" });
    await handlers.get("update:report-activity")(local.event, 0);
    await settle();
    expect(handlers.get("update:get-state")(local.event).waitingForBots).not.toBe(true);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});
