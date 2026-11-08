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
//
// Electron takes a notification it created out of Notification Center when
// the JS object is garbage collected, and every one of them when the app
// quits (an auto-update included). So: every notification has an id and is
// held until clicked, closed, replaced or withdrawn; what is listed is
// mirrored to disk; at launch adoptDelivered() re-attaches what macOS still
// lists (getHistory) and quietly posts again what the quit removed.

const MAX_TITLE = 120;
/** #2909: a decision's context (question, approval, needs-you) keeps its
 * lines and reads whole in the expanded banner. */
const MAX_CONTEXT_BODY = 1200;
const MAX_ID = 200;
// Held notification objects: Electron takes a notification out of
// Notification Center when its object is garbage collected, so this is how
// many stay listed at once.
const MAX_KEPT = 500;
/** At most this many notifications come back after a quit or an update. */
const MAX_REPOST = 30;
/** How long after a banner macOS is asked whether it was delivered. */
const PROBE_MS = 4000;

/** Text shown in a notification: a string, trimmed and capped. */
function clip(value, max) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A body that keeps its line breaks (a decision's context, a table turned
 * into one line per row): spaces collapse inside each line, blank runs to one. */
function clipLines(value, max) {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The request the page sent, reduced to what a notification may carry.
 * Null when it has nothing to show. */
export function normalizeAttentionRequest(value) {
  if (!value || typeof value !== "object") return null;
  // the bot wrote it with notify false: in the chat, never a banner
  if (value.notify === false) return null;
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
    body: clipLines(value.body, MAX_CONTEXT_BODY),
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
    // the account page that asked (set by main, never by the page): a click
    // after a restart still opens the right account
    origin: typeof value.origin === "string" && value.origin.length <= 500 ? value.origin : "",
  };
}

/** Where a click goes: the bot, thread, room or routine run the notification
 * is about, so the page can open it even when it forgot the notification id
 * (a reload while the banner sat in the notification center). Null when
 * nothing usable came. */
export function normalizeTarget(value) {
  if (!value || typeof value !== "object") return null;
  const out = {};
  for (const key of ["botId", "threadId", "groupId", "routineRunId", "requestId", "cardId"]) {
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
 *   Notification?: { new (options: object): { id?: string, show(): void, close?(): void, on(event: string, fn: (...args: any[]) => void): void }, isSupported?(): boolean, remove?(id: string): void, getHistory?(): Promise<Array<{ id?: string, on(event: string, fn: (...args: any[]) => void): void }>> },
 *   getWindow: () => any,
 *   onClick: (id: string, target: object | null, origin?: string | null) => void,
 *   onReply?: (id: string, reply: string, target: object | null, origin?: string | null) => void,
 *   icon?: string,
 *   ensureAuthorized?: () => boolean | Promise<boolean>,
 *   store?: { read(): unknown, write(value: object): void },
 *   now?: () => number,
 *   setTimeout?: (fn: () => void, ms: number) => unknown,
 * }} deps
 */
export function createDesktopAttention(deps) {
  /** native id → the live notification object. Holding it is what keeps it
   * in Notification Center: Electron removes a notification it created
   * when that object is garbage collected. */
  const kept = new Map();
  /** native id → what a click needs after a restart ({id, target, ...}),
   * mirrored to deps.store so the next launch can re-attach or re-post it. */
  const records = new Map();
  let bounceId = null;
  let authAsked = false;
  let seq = 0;
  /** "delivered": macOS listed a notification we showed in Notification
   * Center; "not-delivered": it did not (Sagax is off or denied there);
   * "unknown": nothing checked yet, or the platform cannot tell. */
  let deliveryState = "unknown";
  const now = deps.now ?? Date.now;
  const later = deps.setTimeout ?? ((fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; });
  const canList = () => typeof deps.Notification?.getHistory === "function";

  const liveWindow = () => {
    const win = deps.getWindow();
    return win && !(typeof win.isDestroyed === "function" && win.isDestroyed()) ? win : null;
  };

  function persist() {
    if (!deps.store) return;
    try { deps.store.write({ version: 1, records: Object.fromEntries(records) }); } catch { /* disk full: next change retries */ }
  }

  function readStore() {
    try {
      const saved = deps.store?.read();
      const list = saved && typeof saved === "object" ? saved.records : null;
      if (!list || typeof list !== "object") return new Map();
      const out = new Map();
      for (const [nid, rec] of Object.entries(list)) {
        if (typeof nid !== "string" || nid.length > MAX_ID * 2 || !rec || typeof rec !== "object") continue;
        const title = clip(rec.title, MAX_TITLE);
        if (!title) continue;
        out.set(nid, {
          id: typeof rec.id === "string" && rec.id.length <= MAX_ID ? rec.id : "",
          target: normalizeTarget(rec.target),
          title,
          subtitle: clip(rec.subtitle, MAX_TITLE),
          body: clipLines(rec.body, MAX_CONTEXT_BODY),
          groupId: typeof rec.groupId === "string" && rec.groupId.length <= MAX_ID * 2 ? rec.groupId : "",
          withdrawKey: typeof rec.withdrawKey === "string" && rec.withdrawKey.length <= MAX_ID * 3 ? rec.withdrawKey : "",
          origin: typeof rec.origin === "string" && rec.origin.length <= 500 ? rec.origin : "",
          at: Number.isFinite(rec.at) ? rec.at : 0,
        });
      }
      return out;
    } catch {
      return new Map();
    }
  }

  /** Let go of one notification: clicked, closed, replaced or withdrawn.
   * `note` guards against a late close event of an object already replaced
   * under the same id. */
  const forget = (nid, note) => {
    if (note && kept.get(nid) !== note) return null;
    const held = kept.get(nid);
    kept.delete(nid);
    if (records.delete(nid)) persist();
    return held;
  };

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

  /** Hold a notification (new, adopted or re-posted) and wire its click,
   * reply and close to the conversation its record names. */
  function hold(nid, note, rec, hasReply) {
    kept.set(nid, note);
    if (kept.size > MAX_KEPT) {
      const oldest = kept.keys().next().value;
      forget(oldest);
    }
    note.on("click", () => {
      forget(nid, note);
      focusWindow();
      if (rec?.id) deps.onClick(rec.id, rec.target ?? null, rec.origin || null);
    });
    if (hasReply && typeof deps.onReply === "function") {
      note.on("reply", (_event, reply) => {
        forget(nid, note);
        focusWindow();
        const text = typeof reply === "string" ? reply.trim() : "";
        if (text && rec?.id) deps.onReply(rec.id, text, rec.target ?? null, rec.origin || null);
      });
    }
    note.on("close", () => forget(nid, note));
  }

  /** The ids macOS still lists in Notification Center, or null when it
   * cannot say (other platforms, older Electron, an error). */
  async function deliveredIds() {
    if (!canList()) return null;
    try {
      const history = await deps.Notification.getHistory();
      return new Set((Array.isArray(history) ? history : []).map((note) => note?.id).filter((id) => typeof id === "string"));
    } catch {
      return null;
    }
  }

  /** A few seconds after a banner, ask macOS whether it reached
   * Notification Center: that is the authorization state Settings shows. */
  function probe(nid) {
    if (!canList()) return Promise.resolve(deliveryState);
    return new Promise((resolve) => {
      later(async () => {
        const ids = await deliveredIds();
        if (ids) {
          if (ids.has(nid)) deliveryState = "delivered";
          else if (kept.has(nid)) deliveryState = "not-delivered";
          // drop what the person dismissed in Notification Center, so a
          // restart does not bring it back
          let changed = false;
          for (const [held, rec] of records) {
            if (!ids.has(held) && held !== nid && now() - rec.at > PROBE_MS) { records.delete(held); changed = true; }
          }
          if (changed) persist();
        }
        resolve(deliveryState);
      }, PROBE_MS);
    });
  }

  /** Show one native notification. False when the platform has none. */
  function notify(raw) {
    const request = normalizeAttentionRequest(raw);
    if (!request) return false;
    requestAttention(request);
    const Notification = deps.Notification;
    if (!Notification || (typeof Notification.isSupported === "function" && !Notification.isSupported())) return false;

    // Electron asks macOS for authorization itself the first time it posts
    // (UNUserNotificationCenter requestAuthorization); this hook only reads
    // and reports the state.
    if (!authAsked && typeof deps.ensureAuthorized === "function") {
      authAsked = true;
      try {
        const ok = deps.ensureAuthorized();
        if (ok && typeof ok.then === "function") void ok.catch(() => {});
      } catch { /* show anyway */ }
    }

    // Every notification carries an id: the one of its chat (a new notice
    // replaces the old) or a fresh one, so Notification Center can list it
    // and a restart can find it again.
    const nid = request.replaceId || `sagax:n:${request.id || "notice"}:${now().toString(36)}:${(++seq).toString(36)}`;
    if (request.replaceId) {
      const old = forget(request.replaceId);
      try { old?.close?.(); } catch { /* already gone */ }
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
      id: nid,
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
    const rec = {
      id: request.id,
      target: request.target,
      title: request.title,
      subtitle: request.subtitle,
      body: request.body,
      groupId: request.groupId,
      withdrawKey: request.withdrawKey,
      origin: request.origin,
      at: now(),
    };
    // Held until it is clicked, closed, replaced or withdrawn (a bounded
    // number, oldest first): letting it go would take it out of
    // Notification Center.
    hold(nid, note, rec, request.hasReply);
    records.set(nid, rec);
    persist();
    note.show();
    void probe(nid);
    return true;
  }

  /** At launch (macOS): take back what Notification Center still lists from
   * the last run, with its click, and post again, quietly, what quitting
   * removed (Electron clears its own notifications on quit, an update
   * included). Returns how many of each. */
  async function adoptDelivered() {
    const saved = readStore();
    if (!canList()) return { adopted: 0, reposted: 0 };
    let history = [];
    try { history = await deps.Notification.getHistory(); } catch { history = []; }
    if (!Array.isArray(history)) history = [];
    let adopted = 0;
    const present = new Set();
    for (const note of history) {
      const nid = typeof note?.id === "string" ? note.id : "";
      if (!nid || kept.has(nid)) continue;
      present.add(nid);
      const rec = saved.get(nid) ?? null;
      if (rec) records.set(nid, rec);
      hold(nid, note, rec, false);
      adopted++;
    }
    if (present.size > 0) deliveryState = "delivered";
    const missing = [...saved]
      .filter(([nid]) => !present.has(nid) && !kept.has(nid))
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_REPOST);
    let reposted = 0;
    for (const [nid, rec] of missing) {
      try {
        const note = new deps.Notification({
          id: nid,
          ...(rec.groupId ? { groupId: rec.groupId } : {}),
          title: rec.title,
          ...(rec.subtitle ? { subtitle: rec.subtitle } : {}),
          body: rec.body,
          silent: true,
          timeoutType: "default",
          urgency: notificationUrgency(deps.platform, false),
        });
        hold(nid, note, rec, false);
        records.set(nid, rec);
        note.show();
        reposted++;
      } catch { /* skip this one */ }
    }
    persist();
    return { adopted, reposted };
  }

  /** What Settings shows: whether notifications reach Notification Center. */
  function deliveryStatus() {
    return { state: deliveryState, canCheck: canList() };
  }

  /** Settings' "Send a test": one notification, then the state it found. */
  function test(request) {
    if (!notify({ ...request, sound: true, persistent: false })) return Promise.resolve(deliveryState);
    const last = [...kept.keys()].pop();
    return last ? probe(last) : Promise.resolve(deliveryState);
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
    for (const [nid, rec] of records) {
      if (rec.withdrawKey !== withdrawKey) continue;
      const note = forget(nid);
      try {
        if (note?.close) note.close();
        else deps.Notification?.remove?.(nid);
        closed++;
      } catch { /* already gone */ }
    }
    return closed;
  }

  return { notify, withdraw, requestAttention, setBadge, settle, adoptDelivered, deliveryStatus, test, keptCount: () => kept.size };
}
