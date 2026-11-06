// The bot panel's Computer row thumbnail of this computer (2026-11-06): a low
// resolution capture, taken only when macOS already granted Screen Recording.
// The first real capture is what makes macOS ask (see screen:frame in
// main.mjs), so a thumbnail never captures before the grant: no prompt, no
// window, no focus change from a panel refreshing a picture.

/** Size asked from desktopCapturer: twice the 160 px the server serves. */
export const SCREEN_THUMBNAIL_SIZE = Object.freeze({ width: 320, height: 200 });

/** May a thumbnail capture now, without any permission prompt. */
export function screenThumbnailAllowed(platform, screenStatus) {
  if (platform === "win32") return true;
  if (platform === "darwin") return screenStatus === "granted";
  return false;
}

/** One thumbnail of the main screen, or null (not allowed, nothing drawn). */
export async function captureScreenThumbnail({ platform, screenStatus, getSources, hostName, now = Date.now }) {
  if (!screenThumbnailAllowed(platform, screenStatus)) return null;
  const sources = await getSources({ types: ["screen"], thumbnailSize: SCREEN_THUMBNAIL_SIZE });
  const thumbnail = sources?.[0]?.thumbnail;
  // Without the permission macOS hands back an empty picture: that is no frame.
  if (!thumbnail || thumbnail.isEmpty()) return null;
  const jpeg = thumbnail.toJPEG(70);
  if (!jpeg || jpeg.length === 0) return null;
  return { image: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`, at: now(), host: String(hostName ?? "") };
}
