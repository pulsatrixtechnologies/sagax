// Permission policy for the main application window. The local UI needs a
// small set of capabilities to function: audio media (microphone for voice
// input), notifications, and clipboard access. Screen preview has its own
// one-shot, user-gesture-bound display-media guard in main.mjs.
//
// Privileged capabilities — camera/video, geolocation, USB, HID, serial,
// MIDI, unguarded screen capture, window management, local fonts — stay off: the app
// does not use them, and granting them unconditionally to the renderer leaves
// host sensors and devices exposed if an untrusted payload ever executes.
// The allow-list also applies only to the verified renderer origin; any
// opaque or cross-origin request is refused outright.
//
// Two narrow exceptions: the organization server's bundled UI may use the
// microphone (voice mode in server mode), and the paired remote server open
// in the main window may write the clipboard (the copy button), following
// the one rule in remoteClipboardWriteAllowed. That remote server may also,
// once the person said yes to its first microphone request, use the
// microphone for a Live call: a saved server is not necessarily the
// person's own (an address is saved before pairing, and a chat-only code can
// come from someone else), so its microphone is asked, never assumed
// (mainFrameMicrophoneAllowed). Nothing else.

const ALLOWED_APP_PERMISSIONS = new Set([
  "notifications",
  "clipboard-read",
  "clipboard-sanitized-write",
  "fullscreen",
]);

// Opaque origins (data:, about:blank, javascript:) serialise as the string
// "null"; never let two of them match each other.
function webOrigin(value) {
  if (typeof value !== "string") return null;
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Decide whether a requested Chromium permission should be granted for the main app window.
 *
 * @param {string} permission The Electron/Chromium permission name
 * @param {string} requestingUrlOrOrigin The URL or origin requesting the permission
 * @param {string} rendererOrigin The trusted local renderer origin
 * @param {{ mediaTypes?: string[], mediaType?: string }} [details] Optional request details
 * @param {{ microphoneOrigins?: Array<string | null | undefined> }} [extra] Other origins
 *   drawn with this app's own UI that may use the microphone only: the
 *   organization server of server mode (bundled-ui.cjs), for voice mode.
 * @returns {boolean} True if the permission should be granted, false otherwise
 */
export function appPermissionAllowed(permission, requestingUrlOrOrigin, rendererOrigin, details = {}, extra = {}) {
  const requesting = webOrigin(requestingUrlOrOrigin);
  const allowed = webOrigin(rendererOrigin);
  if (!requesting) return false;
  if (!allowed || requesting !== allowed) {
    // the bundled UI on an organization server: audio capture, nothing else
    const microphone = (extra.microphoneOrigins ?? []).map(webOrigin).filter(Boolean);
    return permission === "media" && microphone.includes(requesting) && audioOnly(details);
  }

  // Media: audio (microphone) is permitted; video (camera/webcam) is strictly denied.
  // Electron 43 routes getDisplayMedia through permission="media" with mediaTypes: []
  // before selecting display media. Allowing this preserves the guarded displayMediaGuard
  // without granting webcam access.
  if (permission === "media") {
    if (details?.mediaType !== undefined && details.mediaType !== "audio") return false;
    if (details?.mediaTypes !== undefined) {
      // Empty mediaTypes is Electron getDisplayMedia routing; ["audio"] is microphone capture.
      return Array.isArray(details.mediaTypes) && details.mediaTypes.every((type) => type === "audio");
    }
    return details?.mediaType === "audio";
  }

  return ALLOWED_APP_PERMISSIONS.has(permission);
}

/** A microphone request, never the camera or the screen (non-empty audio only). */
function audioOnly(details) {
  if (details?.mediaType !== undefined && details.mediaType !== "audio") return false;
  if (details?.mediaTypes !== undefined) {
    return Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 && details.mediaTypes.every((type) => type === "audio");
  }
  return details?.mediaType === "audio";
}

/**
 * Whether the active saved server the person allowed may use the microphone:
 * only in the main frame, only at the exact origin the active saved
 * environment reports. Never the camera, screen capture or notifications;
 * clipboard writes are the separate rule in remoteClipboardWriteAllowed, and
 * that page never reads the clipboard.
 *
 * @param {string} permission The Electron/Chromium permission name
 * @param {string} requestingUrlOrOrigin The URL or origin requesting the permission
 * @param {string | null | undefined} trustedOrigin The active server's origin, or null when there is none
 * @param {{ isMainFrame?: boolean, mediaTypes?: string[], mediaType?: string }} [details] Request details
 * @returns {boolean} True only for that page's own microphone request
 */
function mainFrameMicrophoneAllowed(permission, requestingUrlOrOrigin, trustedOrigin, details) {
  // This computer's media rule with that page as the trusted origin, narrowed
  // to the main frame and never getDisplayMedia (empty mediaTypes).
  if (permission !== "media" || details?.isMainFrame !== true || details.mediaTypes?.length === 0) return false;
  return appPermissionAllowed("media", requestingUrlOrOrigin, trustedOrigin ?? null, details);
}

/**
 * The one capability besides the microphone a paired remote server's page gets
 * on this computer:
 * writing the clipboard (navigator.clipboard.writeText asks Chromium for
 * "clipboard-sanitized-write", which covers text and the HTML/images Chromium
 * sanitizes). It is granted only to the main frame of the server the person is
 * viewing right now, matched by exact origin against the active saved
 * environment, so switching servers withdraws it at once. Reading the
 * clipboard and every other permission stay local-only.
 *
 * It relies on Chromium's transient user activation (~5 s after a user
 * interaction): without one, Chromium requests "clipboard-read", which stays
 * denied here. No separate activation tracking is done.
 *
 * @param {string} permission The Electron/Chromium permission name
 * @param {string} requestingUrlOrOrigin The URL or origin requesting the permission
 * @param {string | null | undefined} activeRemoteOrigin Origin of the active saved environment, if any
 * @param {{ isMainFrame?: boolean }} [details] Optional request details
 * @returns {boolean} True only for a main-frame clipboard write from the active remote origin
 */
export function remoteClipboardWriteAllowed(permission, requestingUrlOrOrigin, activeRemoteOrigin, details = {}) {
  if (permission !== "clipboard-sanitized-write") return false;
  if (details?.isMainFrame !== true) return false;
  const requesting = webOrigin(requestingUrlOrOrigin);
  const active = webOrigin(activeRemoteOrigin);
  return Boolean(requesting && active && requesting === active);
}

/**
 * The session's permission handlers. This computer's own page gets
 * appPermissionAllowed (with the organization server's bundled UI allowed the
 * microphone only, for voice mode); the active remote server, in the main
 * window's main frame, gets clipboard writes, and the microphone once the
 * person allowed it.
 *
 * @param {{ rendererOrigin: () => string, mainContents: () => unknown,
 *   microphoneOrigins?: () => Array<string | null | undefined>, activeRemoteOrigin?: () => string | null,
 *   activeRemoteMicrophone?: () => boolean, askRemoteMicrophone?: (origin: string) => Promise<unknown> | null }} context
 *   `mainContents`: the main window's webContents, or null;
 *   `microphoneOrigins`: appPermissionAllowed's extra microphone origins;
 *   `activeRemoteOrigin`: the active saved environment's origin, or null on
 *   this computer, asked on every request so a server switch withdraws it;
 *   `activeRemoteMicrophone`: whether the person allowed that server the
 *   microphone, also asked on every request; `askRemoteMicrophone`: on a
 *   microphone request the person has not answered yet, a wait for their
 *   answer (main's dialog), or null when there is nothing to ask.
 */
export function appPermissionHandlers({ rendererOrigin, mainContents, microphoneOrigins = () => [], activeRemoteOrigin = () => null,
  activeRemoteMicrophone = () => false, askRemoteMicrophone = () => null }) {
  // The main window's page asking for the microphone as the active remote
  // server; read per request so a server switch withdraws it.
  const asksAsRemote = (contents, permission, requesting, details) =>
    Boolean(contents) && contents === mainContents() && mainFrameMicrophoneAllowed(permission, requesting, activeRemoteOrigin(), details);
  // The active remote server's page, in the main window's own main frame, writing the clipboard.
  const clipboardWrite = (contents, permission, requesting, details) =>
    Boolean(contents) && contents === mainContents() &&
    remoteClipboardWriteAllowed(permission, requesting, activeRemoteOrigin(), details);
  const allowed = (contents, permission, requesting, details) =>
    appPermissionAllowed(permission, requesting, rendererOrigin(), details, { microphoneOrigins: microphoneOrigins() }) ||
    (asksAsRemote(contents, permission, requesting, details) && activeRemoteMicrophone() === true) ||
    clipboardWrite(contents, permission, requesting, details);
  return {
    // Only a request may wait (Electron answers it through the callback): a
    // saved server's microphone request not yet answered asks the person;
    // anything else is decided at once. The answer is the rule again
    // afterwards, so a switch made meanwhile still refuses.
    request: (contents, permission, callback, details) => {
      const requesting = details?.requestingUrl ?? contents?.getURL?.() ?? "";
      const decide = () => allowed(contents, permission, requesting, details);
      if (decide()) return callback(true);
      const asking = asksAsRemote(contents, permission, requesting, details) ? askRemoteMicrophone(activeRemoteOrigin()) : null;
      if (!asking) return callback(false);
      void Promise.resolve(asking).catch(() => {}).then(() => callback(decide()));
    },
    check: (contents, permission, requestingOrigin, details) =>
      allowed(contents, permission, requestingOrigin || contents?.getURL?.() || "", details),
    /** perm:status's `pageMic`: what `request` answers the asking page's
     * microphone request, so a blocked Live call can say whether this app
     * refused it (a web browser can make the call) or the computer did. */
    pageMicrophone: (event) => {
      const contents = event?.sender;
      const frame = event?.senderFrame;
      const isMainFrame = Boolean(frame) && frame === contents?.mainFrame;
      return allowed(contents, "media", frame?.url ?? "", { isMainFrame, mediaTypes: ["audio"] }) ? "allowed" : "refused";
    },
  };
}

// Both explicit IPC links and window.open must use the same web-only policy.
export function externalWebUrl(rawUrl) {
  if (typeof rawUrl !== "string") throw new Error("A web address is required");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("That web address is invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only web links can be opened");
  if (url.username || url.password) throw new Error("Web links must not include user credentials");
  return url.toString();
}

// A "Connect Microsoft Teams" card (shared/connector-setup.ts) opens only
// the engines' connector pages: grok.com or claude.ai, https, no port, no
// credentials. Checked here again, whatever the page sent (defense in depth).
const CONNECTOR_SETUP_HOSTS = new Set(["grok.com", "claude.ai"]);
export function connectorSetupUrl(rawUrl) {
  const url = new URL(externalWebUrl(rawUrl));
  if (url.protocol !== "https:" || url.port || !CONNECTOR_SETUP_HOSTS.has(url.hostname)) throw new Error("Only grok.com or claude.ai connector pages can be opened here");
  return url.toString();
}

// A mailto: link (an email draft's "Open in mail app") goes to the OS mail
// client, which only pre-fills a draft; nothing is sent without the person.
// Bounded so a hostile page cannot hand the OS an unbounded URL.
export const MAILTO_MAX_LENGTH = 32_768;
export function externalMailUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !/^mailto:/i.test(rawUrl)) throw new Error("Only mail links can be opened here");
  if (rawUrl.length > MAILTO_MAX_LENGTH) throw new Error("That mail link is too long");
  // oxlint-disable-next-line no-control-regex -- control characters never belong in a mail link
  if (/[\u0000-\u001f\u007f]/.test(rawUrl)) throw new Error("That mail link is invalid");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("That mail link is invalid");
  }
  if (url.protocol !== "mailto:") throw new Error("Only mail links can be opened here");
  return url.toString();
}

/** The one policy window.open follows: web links, or a mail draft. */
export function externalOpenUrl(rawUrl) {
  if (typeof rawUrl === "string" && /^mailto:/i.test(rawUrl)) return externalMailUrl(rawUrl);
  return externalWebUrl(rawUrl);
}
