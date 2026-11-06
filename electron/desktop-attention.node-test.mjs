import assert from "node:assert/strict";
import test from "node:test";

import { createDesktopAttention, normalizeAttentionRequest, notificationUrgency } from "./desktop-attention.mjs";

function fakeNotificationClass() {
  const made = [];
  class FakeNotification {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.shown = false;
      made.push(this);
    }
    static isSupported() { return true; }
    on(event, fn) { this.handlers[event] = fn; }
    show() { this.shown = true; }
  }
  return { FakeNotification, made };
}

function fakeWindow({ focused = false } = {}) {
  const calls = [];
  const once = {};
  return {
    calls,
    once,
    win: {
      isDestroyed: () => false,
      isFocused: () => focused,
      isMinimized: () => true,
      restore: () => calls.push("restore"),
      show: () => calls.push("show"),
      focus: () => calls.push("focus"),
      flashFrame: (on) => calls.push(`flash:${on}`),
      once: (event, fn) => { once[event] = fn; },
    },
  };
}

function fakeApp() {
  const calls = [];
  return {
    calls,
    app: {
      dock: { bounce: (type) => { calls.push(`bounce:${type}`); return 7; }, cancelBounce: (id) => calls.push(`cancel:${id}`) },
      setBadgeCount: (count) => { calls.push(`badge:${count}`); return true; },
    },
  };
}

test("a request is trimmed, capped, and needs a title", () => {
  assert.equal(normalizeAttentionRequest(null), null);
  assert.equal(normalizeAttentionRequest({ title: "   " }), null);
  const long = normalizeAttentionRequest({ title: "Alice", body: "x".repeat(1000), id: "nudge:1" });
  assert.equal(long.body.length, 400);
  assert.equal(long.sound, true);
  assert.equal(long.persistent, true);
  assert.equal(long.bounce, null);
  assert.equal(normalizeAttentionRequest({ title: "A", bounce: "loud" }).bounce, null);
  assert.equal(normalizeAttentionRequest({ title: "A", id: "x".repeat(500) }).id, "");
});

test("a persistent notification never times out, plays its sound, and a click opens the window then the thread", () => {
  const { FakeNotification, made } = fakeNotificationClass();
  const { win, calls } = fakeWindow();
  const clicked = [];
  const attention = createDesktopAttention({ platform: "win32", app: fakeApp().app, Notification: FakeNotification, getWindow: () => win, onClick: (id) => clicked.push(id) });
  assert.equal(attention.notify({ id: "thread:t1", title: "Alice", body: "lunch?", persistent: true, sound: true }), true);
  assert.equal(made.length, 1);
  assert.equal(made[0].options.timeoutType, "never");
  assert.equal(made[0].options.silent, false);
  assert.equal(made[0].shown, true);
  assert.equal(attention.keptCount(), 1);
  made[0].handlers.click();
  assert.deepEqual(clicked, ["thread:t1"]);
  assert.deepEqual(calls.filter((call) => !call.startsWith("flash")), ["restore", "show", "focus"]);
  assert.equal(attention.keptCount(), 0);
});

test("sound off and not persistent: a silent banner with the default timeout", () => {
  const { FakeNotification, made } = fakeNotificationClass();
  const attention = createDesktopAttention({ platform: "linux", app: fakeApp().app, Notification: FakeNotification, getWindow: () => null, onClick: () => {} });
  attention.notify({ title: "Bot", body: "done", persistent: false, sound: false });
  assert.equal(made[0].options.silent, true);
  assert.equal(made[0].options.timeoutType, "default");
});

test("macOS bounces the Dock icon for an unfocused window, never for a focused one", () => {
  const dock = fakeApp();
  const away = createDesktopAttention({ platform: "darwin", app: dock.app, getWindow: () => fakeWindow().win, onClick: () => {} });
  assert.equal(away.requestAttention({ bounce: "critical" }), true);
  assert.deepEqual(dock.calls, ["bounce:critical"]);
  away.settle();
  assert.deepEqual(dock.calls, ["bounce:critical", "cancel:7"]);

  const here = fakeApp();
  const focused = createDesktopAttention({ platform: "darwin", app: here.app, getWindow: () => fakeWindow({ focused: true }).win, onClick: () => {} });
  assert.equal(focused.requestAttention({ bounce: "critical" }), false);
  assert.deepEqual(here.calls, []);
});

test("Windows flashes the taskbar button until the window is focused", () => {
  const { win, calls, once } = fakeWindow();
  const attention = createDesktopAttention({ platform: "win32", app: fakeApp().app, getWindow: () => win, onClick: () => {} });
  assert.equal(attention.requestAttention({ flash: true }), true);
  assert.deepEqual(calls, ["flash:true"]);
  once.focus();
  assert.deepEqual(calls, ["flash:true", "flash:false"]);
});

test("the badge is the unread count on macOS and Linux, zero for anything else", () => {
  const mac = fakeApp();
  const attention = createDesktopAttention({ platform: "darwin", app: mac.app, getWindow: () => null, onClick: () => {} });
  assert.equal(attention.setBadge(3), 3);
  assert.equal(attention.setBadge(-1), 0);
  assert.equal(attention.setBadge(Number.NaN), 0);
  assert.deepEqual(mac.calls, ["badge:3", "badge:0", "badge:0"]);
  const win = fakeApp();
  createDesktopAttention({ platform: "win32", app: win.app, getWindow: () => null, onClick: () => {} }).setBadge(4);
  assert.deepEqual(win.calls, []);
});

test("without a notification class it still asks for attention and reports no banner", () => {
  const dock = fakeApp();
  const attention = createDesktopAttention({ platform: "darwin", app: dock.app, getWindow: () => fakeWindow().win, onClick: () => {} });
  assert.equal(attention.notify({ title: "Alice", bounce: "critical" }), false);
  assert.deepEqual(dock.calls, ["bounce:critical"]);
});

test("a click sends the notification id with the conversation it is about", () => {
  const { FakeNotification, made } = fakeNotificationClass();
  const { win } = fakeWindow();
  const clicked = [];
  const attention = createDesktopAttention({ platform: "darwin", app: fakeApp().app, Notification: FakeNotification, getWindow: () => win, onClick: (id, target) => clicked.push([id, target]) });
  attention.notify({
    id: "sagax-notification:3",
    title: "Quasar finished",
    target: { botId: "bot-1", threadId: "thread-9", groupId: "room-1", junk: "x", routineRunId: 5 },
  });
  made[0].handlers.click();
  assert.deepEqual(clicked, [["sagax-notification:3", { botId: "bot-1", threadId: "thread-9", groupId: "room-1" }]]);
});

test("a request without a usable target clicks through with null", () => {
  assert.equal(normalizeAttentionRequest({ title: "A", target: {} }).target, null);
  assert.equal(normalizeAttentionRequest({ title: "A", target: "thread" }).target, null);
});

test("an approval answered elsewhere takes its notification down", () => {
  const closed = [];
  class FakeNote {
    constructor(options) { this.options = options; this.handlers = {}; }
    show() {}
    close() { closed.push(this.options.title); this.handlers.close?.(); }
    on(event, fn) { this.handlers[event] = fn; }
  }
  const attention = createDesktopAttention({ platform: "linux", app: {}, Notification: FakeNote, getWindow: () => null, onClick: () => {} });
  attention.notify({ id: "a", title: "Allow Nib to run a command?", body: "Run echo hi.", withdrawKey: "approval:t1:r1" });
  attention.notify({ id: "b", title: "Nib finished", body: "done" });
  assert.equal(attention.withdraw("approval:t1:r2"), 0);
  assert.equal(attention.withdraw("approval:t1:r1"), 1);
  assert.deepEqual(closed, ["Allow Nib to run a command?"]);
  assert.equal(attention.withdraw("approval:t1:r1"), 0);
  assert.equal(attention.keptCount(), 1);
});

test("macOS never uses critical urgency (no critical-alerts entitlement)", () => {
  assert.equal(notificationUrgency("darwin", true), "normal");
  assert.equal(notificationUrgency("darwin", false), "normal");
  assert.equal(notificationUrgency("win32", true), "critical");
  assert.equal(notificationUrgency("linux", false), "normal");
  const { FakeNotification, made } = fakeNotificationClass();
  createDesktopAttention({
    platform: "darwin",
    app: fakeApp().app,
    Notification: FakeNotification,
    getWindow: () => null,
    onClick: () => {},
  }).notify({ title: "Scout", body: "done", persistent: true });
  assert.equal(made[0].options.urgency, "normal");
});

test("macOS carries subtitle, replace id, avatar icon and hasReply", () => {
  const { FakeNotification, made } = fakeNotificationClass();
  const replies = [];
  const attention = createDesktopAttention({
    platform: "darwin",
    app: fakeApp().app,
    Notification: FakeNotification,
    getWindow: () => fakeWindow().win,
    onClick: () => {},
    onReply: (id, reply, target) => replies.push({ id, reply, target }),
    icon: "/app/icon.png",
  });
  attention.notify({
    id: "click-1",
    replaceId: "sagax:chat:t1",
    groupKey: "sagax:chat:t1",
    title: "Scout",
    subtitle: "Ops",
    body: "hello",
    hasReply: true,
    replyPlaceholder: "Reply to Scout",
    icon: "/tmp/avatar.png",
    target: { botId: "scout", threadId: "t1" },
  });
  assert.equal(made[0].options.id, "sagax:chat:t1");
  assert.equal(made[0].options.groupId, "sagax:chat:t1");
  assert.equal(made[0].options.subtitle, "Ops");
  assert.equal(made[0].options.hasReply, true);
  assert.equal(made[0].options.icon, "/tmp/avatar.png");
  made[0].handlers.reply?.(null, "  sounds good  ");
  assert.deepEqual(replies, [{ id: "click-1", reply: "sounds good", target: { botId: "scout", threadId: "t1" } }]);
});

test("a second notice for the same chat replaces the first", () => {
  const closed = [];
  class FakeNote {
    constructor(options) { this.options = options; this.handlers = {}; }
    static isSupported() { return true; }
    static remove(id) { closed.push(`remove:${id}`); }
    show() {}
    close() { closed.push(`close:${this.options.body}`); this.handlers.close?.(); }
    on(event, fn) { this.handlers[event] = fn; }
  }
  const attention = createDesktopAttention({ platform: "darwin", app: fakeApp().app, Notification: FakeNote, getWindow: () => null, onClick: () => {} });
  attention.notify({ id: "a", title: "Scout", body: "one", replaceId: "sagax:chat:t1", groupKey: "sagax:chat:t1" });
  attention.notify({ id: "b", title: "Scout", body: "two", replaceId: "sagax:chat:t1", groupKey: "sagax:chat:t1" });
  assert.equal(attention.keptCount(), 1);
  assert.ok(closed.includes("close:one"));
  assert.ok(closed.includes("remove:sagax:chat:t1"));
});

test("ensureAuthorized runs once on first notify", () => {
  const { FakeNotification } = fakeNotificationClass();
  let calls = 0;
  const attention = createDesktopAttention({
    platform: "darwin",
    app: fakeApp().app,
    Notification: FakeNotification,
    getWindow: () => null,
    onClick: () => {},
    ensureAuthorized: () => { calls += 1; return true; },
  });
  attention.notify({ title: "A", body: "1" });
  attention.notify({ title: "B", body: "2" });
  assert.equal(calls, 1);
});
