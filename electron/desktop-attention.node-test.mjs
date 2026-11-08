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
  const long = normalizeAttentionRequest({ title: "Alice", body: "x".repeat(2000), id: "nudge:1" });
  assert.equal(long.body.length, 1200);
  assert.equal(long.sound, true);
  assert.equal(long.persistent, true);
  assert.equal(long.bounce, null);
  assert.equal(normalizeAttentionRequest({ title: "A", bounce: "loud" }).bounce, null);
  assert.equal(normalizeAttentionRequest({ title: "A", id: "x".repeat(500) }).id, "");
});

test("#2909: a decision's context keeps its lines and its card target", () => {
  const request = normalizeAttentionRequest({
    title: "Katarina",
    body: "Deux copies diffèrent.\n\n\n\nCopie : Locale   · Date : 7 nov.\r\n• Locale : Garde tes changements",
    target: { botId: "b", threadId: "t", requestId: "q-1", cardId: "m-q", extra: "no" },
  });
  assert.equal(request.body, "Deux copies diffèrent.\n\nCopie : Locale · Date : 7 nov.\n• Locale : Garde tes changements");
  assert.deepEqual(request.target, { botId: "b", threadId: "t", requestId: "q-1", cardId: "m-q" });
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

test("a notice the bot sent with notify false never reaches the desktop", () => {
  assert.equal(normalizeAttentionRequest({ title: "Scout", body: "log", notify: false }), null);
  assert.ok(normalizeAttentionRequest({ title: "Scout", body: "done", notify: true }));
  assert.ok(normalizeAttentionRequest({ title: "Scout", body: "done" }));
  const { FakeNotification, made } = fakeNotificationClass();
  const { app } = fakeApp();
  const attention = createDesktopAttention({ platform: "darwin", app, Notification: FakeNotification, getWindow: () => null, onClick: () => {} });
  assert.equal(attention.notify({ title: "Scout", body: "log", notify: false }), false);
  assert.equal(made.length, 0);
});

// Root cause of "no Sagax notifications in Notification Center" (0.8.58):
// Electron removes a notification it created when its object is garbage
// collected, and all of them at quit (every auto-update). These cover the fix.
function macNotificationClass(history = []) {
  const made = [];
  const removed = [];
  class MacNote {
    constructor(options) { this.options = options; this.id = options?.id; this.handlers = {}; this.shown = false; made.push(this); }
    static isSupported() { return true; }
    static remove(id) { removed.push(id); }
    static async getHistory() { return history; }
    on(event, fn) { this.handlers[event] = fn; }
    show() { this.shown = true; }
    close() { this.handlers.close?.(); }
  }
  return { MacNote, made, removed };
}

function memoryStore(initial = null) {
  let value = initial;
  return { read: () => value, write: (next) => { value = JSON.parse(JSON.stringify(next)); }, get value() { return value; } };
}

function restored(id) {
  const note = { id, handlers: {}, on(event, fn) { this.handlers[event] = fn; } };
  return note;
}

test("every notification carries an id and stays held well past fifty (no GC removal)", () => {
  const { MacNote, made } = macNotificationClass();
  const attention = createDesktopAttention({ platform: "darwin", app: fakeApp().app, Notification: MacNote, getWindow: () => null, onClick: () => {}, setTimeout: () => {} });
  for (let i = 0; i < 120; i++) attention.notify({ id: `n${i}`, title: "Scout", body: `msg ${i}` });
  assert.equal(attention.keptCount(), 120);
  assert.ok(made.every((note) => typeof note.options.id === "string" && note.options.id.length > 0));
  assert.equal(new Set(made.map((note) => note.options.id)).size, 120);
});

test("what is listed is mirrored to the store, and a click drops it", () => {
  const { MacNote, made } = macNotificationClass();
  const store = memoryStore();
  const attention = createDesktopAttention({ platform: "darwin", app: fakeApp().app, Notification: MacNote, getWindow: () => null, onClick: () => {}, store, setTimeout: () => {} });
  attention.notify({ id: "thread:t1", title: "Scout", body: "done", replaceId: "sagax:chat:t1", target: { botId: "scout", threadId: "t1" } });
  attention.notify({ id: "approval:1", title: "Allow?", body: "run", withdrawKey: "approval:t2:r1" });
  assert.deepEqual(Object.keys(store.value.records).length, 2);
  assert.deepEqual(store.value.records["sagax:chat:t1"].target, { botId: "scout", threadId: "t1" });
  made[0].handlers.click();
  assert.deepEqual(Object.keys(store.value.records).length, 1);
  assert.equal(attention.withdraw("approval:t2:r1"), 1);
  assert.deepEqual(store.value.records, {});
});

test("at launch, a notification macOS still lists is adopted and its click opens the right chat", async () => {
  const listed = restored("sagax:chat:t1");
  const { MacNote, made } = macNotificationClass([listed]);
  const store = memoryStore({ version: 1, records: { "sagax:chat:t1": { id: "thread:t1", target: { botId: "scout", threadId: "t1" }, title: "Scout", body: "done", at: 1 } } });
  const clicked = [];
  const attention = createDesktopAttention({ platform: "darwin", app: fakeApp().app, Notification: MacNote, getWindow: () => null, onClick: (id, target) => clicked.push({ id, target }), store, setTimeout: () => {} });
  assert.deepEqual(await attention.adoptDelivered(), { adopted: 1, reposted: 0 });
  assert.equal(made.length, 0);
  assert.equal(attention.deliveryStatus().state, "delivered");
  listed.handlers.click();
  assert.deepEqual(clicked, [{ id: "thread:t1", target: { botId: "scout", threadId: "t1" } }]);
});

test("at launch, what the quit removed is posted again quietly with its click", async () => {
  const { MacNote, made } = macNotificationClass([]);
  const store = memoryStore({ version: 1, records: {
    "sagax:chat:t1": { id: "thread:t1", target: { botId: "scout", threadId: "t1" }, title: "Scout", subtitle: "Ops", body: "done", groupId: "sagax:chat:t1", at: 2 },
    "bad": { title: "" },
  } });
  const clicked = [];
  const attention = createDesktopAttention({ platform: "darwin", app: fakeApp().app, Notification: MacNote, getWindow: () => null, onClick: (id, target) => clicked.push({ id, target }), store, setTimeout: () => {} });
  assert.deepEqual(await attention.adoptDelivered(), { adopted: 0, reposted: 1 });
  assert.equal(made[0].options.id, "sagax:chat:t1");
  assert.equal(made[0].options.silent, true);
  assert.equal(made[0].options.urgency, "normal");
  assert.equal(made[0].shown, true);
  made[0].handlers.click();
  assert.deepEqual(clicked, [{ id: "thread:t1", target: { botId: "scout", threadId: "t1" } }]);
});

test("a late close event of a replaced notification does not drop its replacement", () => {
  const { MacNote, made } = macNotificationClass();
  const store = memoryStore();
  const attention = createDesktopAttention({ platform: "darwin", app: fakeApp().app, Notification: MacNote, getWindow: () => null, onClick: () => {}, store, setTimeout: () => {} });
  made.length = 0;
  attention.notify({ id: "a", title: "Scout", body: "one", replaceId: "sagax:chat:t1" });
  const first = made[0];
  first.close = () => {}; // Electron emits close later, not during close()
  attention.notify({ id: "b", title: "Scout", body: "two", replaceId: "sagax:chat:t1" });
  first.handlers.close();
  assert.equal(attention.keptCount(), 1);
  assert.equal(store.value.records["sagax:chat:t1"].body, "two");
});

test("the delivery probe reports delivered or not-delivered from Notification Center", async () => {
  const listed = [];
  const { MacNote, made } = macNotificationClass(listed);
  const timers = [];
  const attention = createDesktopAttention({ platform: "darwin", app: fakeApp().app, Notification: MacNote, getWindow: () => null, onClick: () => {}, setTimeout: (fn) => timers.push(fn) });
  assert.deepEqual(attention.deliveryStatus(), { state: "unknown", canCheck: true });
  const missing = attention.test({ title: "Sagax", body: "test" });
  await timers.pop()();
  assert.equal(await missing, "not-delivered");
  const found = attention.test({ title: "Sagax", body: "test 2" });
  listed.push(restored(made.at(-1).options.id));
  await timers.pop()();
  assert.equal(await found, "delivered");
  assert.equal(attention.deliveryStatus().state, "delivered");
});
