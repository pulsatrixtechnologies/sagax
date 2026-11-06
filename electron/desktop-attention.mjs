// Getting a person's attention from the desktop shell: a native notification
// that stays until it is dismissed, a Dock bounce on macOS, a flashing
// taskbar button on Windows and Linux, and the unread count on the app icon
// (macOS Dock, Linux launcher; Windows uses the overlay icon in main.mjs).
// The page decides WHAT is worth it (src/lib/attention.ts +
// src/lib/native-notification-payload.ts); this module only does it. Kept
// free of Electron imports so node:test covers every rule.
//
// macOS shows a notification as a banner (it slides away) or as an alert
// (it stays) depending on the person's choice in System Settings >
// Notifications > Sagax; an app cannot force Alerts. `timeoutType: "never"`
// is honoured on Windows and Linux. The Settings help text says so.
//
// Never pass urgency: "critical" on macOS: that requires Apple's critical-
// alerts entitlement, which Sagax does not ship. Without it, those banners
// never reach Notification Center (#2120).

const MAX_TITLE = 120;
const MAX_BODY = 400;
const MAX_ID = 200;
const MAX_KEPT = 50;

/** Text shown in a notification: a string, trimmed and capped. */
function clip(value, max) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The request the page sent, reduced to what a notification may carry.
 * Null when it has nothing to show. */
export function normalizeAttentionRequest(value) {
  if (!value || typeof value !== "object") return null;
  const title = clip(value.title, MAX_TITLE);
  if (!title) return null;
  const id = typeof value.id === "string" && value.id.length <= MAX_ID ? value.id : "";
  const bounce = value.bounce === "critical" || value.bounce === "informational" ? value.bounce : null;
  const replaceId = typeof value.replaceId === "string" && value.replaceId.length <= MAX_ID * 2
    ? value.replaceId
    : (typeof value.groupKey === "string" && value.groupKey.length <= MAX_ID * 2 ? value.groupKey : "");
  const groupId = typeof value.groupKey === "string" && value.groupKey.length <= MAX_ID * 2
    ? value.groupKey
    : replaceId;
  const icon = typeof value.icon === "string" && value.icon.length > 0 && value.icon.length <= 8_000
    ? value.icon
    : "";
  return {
    id,
    title,
    subtitle: clip(value.subtitle, MAX_TITLE),
    body: clip(value.body, MAX_BODY),
    sound: value.sound !== false,
    persistent: value.persistent !== false,
    bounce,
    flash: value.flash === true,
    target: normalizeTarget(value.target),
    withdrawKey: typeof value.withdrawKey === "string" && value.withdrawKey.length <= MAX_ID * 3 ? value.withdrawKey : "",
    replaceId,
    groupId,
    hasReply: value.hasReply === true,
    replyPlaceholder: clip(value.replyPlaceholder, 80) || "Reply",
    icon,
  };
}

/** Where a click goes: the bot, thread, room or routine run the notification
 * is about, so the page can open it even when it forgot the notification id
 * (a reload while the banner sat in the notification center). Null when
 * nothing usable came. */
export function normalizeTarget(value) {
  if (!value || typeof value !== "object") return null;
  const out = {};
  for (const key of ["botId", "threadId", "groupId", "routineRunId"]) {
    const field = value[key];
    if (typeof field === "string" && field.length <= MAX_ID) out[key] = field;
  }
  return out.threadId || out.routineRunId || out.botId ? out : null;
}

/**
 * macOS Notification Center urgency. Critical alerts need a special Apple
 * entitlement Sagax does not have; using them drops the banner entirely.
 * Windows/Linux may still use a higher urgency for persistent notices.
 */
export function notificationUrgency(platform, persistent) {
  if (platform === "darwin") return "normal";
  return persistent ? "critical" : "normal";
}

/**
 * @param {{
 *   platform: string,
 *   app: { dock?: { bounce?: (type: string) => number, cancelBounce?: (id: number) => void }, setBadgeCount?: (count: number) => boolean },
 *   Notification?: { new (options: object): { show(): void, close?(): void, on(event: string, fn: (...args: any[]) => void): void }, isSupported?(): boolean, remove?(id: string): void },
 *   getWindow: () => any,
 *   onClick: (id: string, target: object | null) => void,
 *   onReply?: (id: string, reply: string, target: object | null) => void,
 *   icon?: string,
 *   ensureAuthorized?: () => boolean | Promise<boolean>,
 * }} deps
 */
export function createDesktopAttention(deps) {
  const kept = new Map();
  /** replaceId → kept key, so a new notice for the same chat replaces the old. */
  const byReplace = new Map();
  let bounceId = null;
  let authAsked = false;

  const liveWindow = () => {
    const win = deps.getWindow();
    return win && !(typeof win.isDestroyed === "function" && win.isDestroyed()) ? win : null;
  };

  const forget = (key) => {
    const note = kept.get(key);
    kept.delete(key);
    withdrawable.delete(key);
    for (const [replaceId, held] of byReplace) {
      if (held === key) byReplace.delete(replaceId);
    }
    return note;
  };
  /** kept key → the page's withdraw key (an approval answered elsewhere) */
  const withdrawable = new Map();

  /** Bounce the Dock icon (macOS) or flash the taskbar button (Windows,
   * Linux) until the window is focused. Nothing when it already is. */
  function requestAttention({ bounce = null, flash = false } = {}) {
    const win = liveWindow();
    if (win && typeof win.isFocused === "function" && win.isFocused()) return false;
    let asked = false;
    if (deps.platform === "darwin" && bounce && typeof deps.app.dock?.bounce === "function") {
      if (bounceId !== null) deps.app.dock.cancelBounce?.(bounceId);
      bounceId = deps.app.dock.bounce(bounce);
      asked = true;
    }
    if (deps.platform !== "darwin" && (flash || bounce) && win && typeof win.flashFrame === "function") {
      win.flashFrame(true);
      asked = true;
      if (typeof win.once === "function") win.once("focus", () => { try { win.flashFrame(false); } catch { /* gone */ } });
    }
    return asked;
  }

  function focusWindow() {
    const win = liveWindow();
    if (!win) return;
    if (typeof win.isMinimized === "function" && win.isMinimized()) win.restore?.();
    win.show?.();
    win.focus?.();
  }

  /** Show one native notification. False when the platform has none. */
  function notify(raw) {
    const request = normalizeAttentionRequest(raw);
    if (!request) return false;
    requestAttention(request);
    const Notification = deps.Notification;
    if (!Notification || (typeof Notification.isSupported === "function" && !Notification.isSupported())) return false;

    // First need: ask macOS for authorization when the API is there. A denied
    // status still attempts show() so a later grant is picked up.
    if (!authAsked && typeof deps.ensureAuthorized === "function") {
      authAsked = true;
      try {
        const ok = deps.ensureAuthorized();
        if (ok && typeof ok.then === "function") void ok.catch(() => {});
      } catch { /* show anyway */ }
    }

    if (request.replaceId) {
      const previous = byReplace.get(request.replaceId);
      if (previous) {
        const old = forget(previous);
        try { old?.close?.(); } catch { /* already gone */ }
      }
      if (typeof Notification.remove === "function") {
        try { Notification.remove(request.replaceId); } catch { /* older Electron */ }
      }
    }

    const urgency = notificationUrgency(deps.platform, request.persistent);
    // Avatar (content image on macOS) when the page sent a usable path; the
    // app bundle icon stays on the left on macOS. Never force the generic
    // deps.icon onto macOS (it becomes a useless right-hand attachment).
    const icon = request.icon
      || (deps.icon && deps.platform !== "darwin" ? deps.icon : undefined);
    const note = new Notification({
      ...(request.replaceId ? { id: request.replaceId } : {}),
      ...(request.groupId ? { groupId: request.groupId } : {}),
      title: request.title,
      ...(request.subtitle ? { subtitle: request.subtitle } : {}),
      body: request.body,
      silent: !request.sound,
      ...(request.persistent
        ? { timeoutType: "never", urgency }
        : { timeoutType: "default", urgency }),
      ...(icon ? { icon } : {}),
      ...(request.hasReply ? { hasReply: true, replyPlaceholder: request.replyPlaceholder } : {}),
    });
    // The click handler lives as long as the notification object does; keep
    // it until it is clicked or closed (a bounded number, oldest first).
    const key = Symbol(request.id || request.replaceId || "notification");
    kept.set(key, note);
    if (request.replaceId) byReplace.set(request.replaceId, key);
    if (request.withdrawKey) withdrawable.set(key, request.withdrawKey);
    if (kept.size > MAX_KEPT) forget(kept.keys().next().value);
    note.on("click", () => {
      forget(key);
      focusWindow();
      if (request.id) deps.onClick(request.id, request.target);
    });
    if (request.hasReply && typeof deps.onReply === "function") {
      note.on("reply", (_event, reply) => {
        forget(key);
        focusWindow();
        const text = typeof reply === "string" ? reply.trim() : "";
        if (text && request.id) deps.onReply(request.id, text, request.target);
      });
    }
    note.on("close", () => forget(key));
    note.show();
    return true;
  }

  /** The unread count on the app icon (macOS Dock, Linux launcher). */
  function setBadge(count) {
    const value = Number.isSafeInteger(count) && count > 0 ? count : 0;
    if (deps.platform === "darwin" || deps.platform === "linux") deps.app.setBadgeCount?.(value);
    return value;
  }

  /** The window came forward: stop asking. */
  function settle() {
    if (bounceId !== null) {
      deps.app.dock?.cancelBounce?.(bounceId);
      bounceId = null;
    }
    const win = liveWindow();
    if (win && deps.platform !== "darwin" && typeof win.flashFrame === "function") win.flashFrame(false);
  }

  /** Take down every notification shown for this withdraw key: the approval
   * it asked about was answered on another device, or expired. */
  function withdraw(withdrawKey) {
    if (typeof withdrawKey !== "string" || !withdrawKey) return 0;
    let closed = 0;
    for (const [key, value] of withdrawable) {
      if (value !== withdrawKey) continue;
      const note = kept.get(key);
      forget(key);
      try { note?.close?.(); closed++; } catch { /* already gone */ }
    }
    return closed;
  }

  return { notify, withdraw, requestAttention, setBadge, settle, keptCount: () => kept.size };
}
