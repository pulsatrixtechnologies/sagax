// The Referer of a picture the chat draws from an address a message wrote.
//
// An absolute address (a bare picture URL, an author-written image, a GIF
// host) loads with no Referer: the app's desktop window adds its owner
// capability only to a request whose page is the app
// (electron/desktop-owner-request.mjs), so a picture a message aims at the
// local server's own port never carries it, and the page's address never
// leaves for another site. The app's own pictures are relative /api paths
// and keep theirs.

/** Whether mounting an <img> with this source makes a network request to an
 * address written as absolute (http, https or protocol-relative). */
export function isExternalImageSource(src: string): boolean {
  const value = src.trim();
  // The URL parser removes embedded ASCII tab/LF/CR and treats backslashes as
  // slashes for special schemes. Normalize those parser quirks before deciding
  // whether mounting the image would make a network request.
  const networkSpelling = value.replace(/[\t\n\r]/g, "").replace(/\\/g, "/");
  // Chromium canonicalizes special-scheme variants such as `https:host/x`,
  // `https:/host/x`, and backslash spellings into network requests. Treat the
  // whole scheme family as remote before an <img> can mount.
  return networkSpelling.startsWith("//") || /^https?:/i.test(networkSpelling);
}

/** `no-referrer` for an absolute address, the default otherwise. */
export function contentReferrerPolicy(src: string): "no-referrer" | undefined {
  return isExternalImageSource(src) ? "no-referrer" : undefined;
}
