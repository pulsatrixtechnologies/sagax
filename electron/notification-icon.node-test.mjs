import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopAttention } from "./desktop-attention.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The element types of an .icns file, in file order. */
function icnsTypes(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.toString("latin1", 0, 4), "icns");
  assert.equal(buffer.readUInt32BE(4), buffer.length);
  const types = [];
  for (let at = 8; at < buffer.length; at += buffer.readUInt32BE(at + 4)) types.push(buffer.toString("latin1", at, at + 4));
  return types;
}

test("macOS notifications and the Dock read the bundle icon: the .icns holds every size", () => {
  const icns = path.join(root, "build/icon.icns");
  assert.ok(fs.existsSync(icns));
  // ic07 128, ic08 256, ic09 512, ic10 1024, ic11 32@2x... ic12 64, ic13 256@2x, ic14 512@2x
  for (const type of ["ic04", "ic05", "ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14"]) {
    assert.ok(icnsTypes(icns).includes(type), `build/icon.icns lacks ${type}`);
  }
});

test("the packaged icon sources named by electron-builder exist", () => {
  const config = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
  for (const match of config.matchAll(/^\s+icon:\s+(\S+)/gm)) {
    assert.ok(fs.existsSync(path.join(root, match[1])), `${match[1]} is missing`);
  }
  assert.match(config, /^mac:[\s\S]*?\n {2}icon: build\/icon\.icon$/m);
  assert.ok(fs.existsSync(path.join(root, "build/icon.icon/icon.json")));
});

test("macOS keeps the app bundle icon on the left: the generic deps.icon is never attached", () => {
  const made = [];
  class FakeNotification {
    constructor(options) { made.push(options); }
    show() {}
    on() {}
  }
  for (const platform of ["darwin", "win32", "linux"]) {
    const attention = createDesktopAttention({
      platform,
      app: { setBadgeCount() {}, dock: { bounce: () => 1, cancelBounce() {} } },
      Notification: FakeNotification,
      getWindow: () => null,
      onClick: () => {},
      icon: "/old/ghost.png",
    });
    attention.notify({ id: "a", title: "Quasar finished", body: "done" });
  }
  // darwin: no right-hand attachment from the generic app icon
  assert.equal(made[0].icon, undefined);
  // win/linux may use the app icon when no avatar was sent
  assert.equal(made[1].icon, "/old/ghost.png");
  assert.equal(made[2].icon, "/old/ghost.png");
});

test("a sender avatar may attach on macOS as the content image", () => {
  const made = [];
  class FakeNotification {
    constructor(options) { made.push(options); }
    show() {}
    on() {}
  }
  createDesktopAttention({
    platform: "darwin",
    app: { setBadgeCount() {}, dock: { bounce: () => 1, cancelBounce() {} } },
    Notification: FakeNotification,
    getWindow: () => null,
    onClick: () => {},
    icon: "/old/ghost.png",
  }).notify({ id: "a", title: "Scout", body: "hi", icon: "/tmp/scout-avatar.png" });
  assert.equal(made[0].icon, "/tmp/scout-avatar.png");
});

test("no main-process source names a removed mascot asset as an icon", () => {
  for (const name of fs.readdirSync(__dirnameOf())) {
    if (!/\.(mjs|cjs)$/.test(name) || /\.(node-)?test\./.test(name)) continue;
    const text = fs.readFileSync(path.join(__dirnameOf(), name), "utf8");
    if (!text.includes("new Notification(")) continue;
    assert.doesNotMatch(text, /(ghost|bunbu|trombi|pulsa-bot|pulsabot)[\w-]*\.(png|icns|ico|svg)/i, `${name} references an old mascot image`);
  }
});

function __dirnameOf() {
  return path.join(root, "electron");
}

test("the dev launcher compiles the app icon and gives the clone its own bundle id", () => {
  const script = fs.readFileSync(path.join(root, "scripts/dev-desktop.mjs"), "utf8");
  assert.match(script, /build\/icon\.icon/);
  assert.match(script, /CFBundleIdentifier", DEV_BUNDLE_ID/);
  assert.doesNotMatch(script, /DEV_BUNDLE_ID = "com\.github\.Electron"/);
});
