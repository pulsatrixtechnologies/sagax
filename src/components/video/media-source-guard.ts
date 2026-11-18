// A media address that came from a message (a bot's link, a video card, a
// playlist's segment) is never loaded by the player when it names the app's
// own origin as an absolute address: on the desktop that origin is the local
// server, and a request from the app page toward it carries the app's owner
// capability (electron/desktop-owner-request.mjs). The app's own sources are
// relative (`/api/media/proxy/<token>`), so nothing it plays is refused.

function appOrigin(): string | null {
  try {
    return typeof window === "undefined" ? null : window.location.origin;
  } catch {
    return null;
  }
}

/** Whether `url` is written as an absolute address (scheme or `//`) whose
 * origin is the app's. A relative path is the app's own source: false. */
export function isAppOriginAddress(url: string, origin: string | null = appOrigin()): boolean {
  if (!origin || origin === "null") return false;
  const value = url.trim().replace(/[\t\n\r]/g, "").replace(/\\/g, "/");
  if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return false;
  try {
    return new URL(value, origin).origin === origin;
  } catch {
    return false;
  }
}

/** The address a player may load, or null for one it must never load. */
export function playableAddress(url: string | undefined | null): string | null {
  if (!url) return null;
  return isAppOriginAddress(url) ? null : url;
}
