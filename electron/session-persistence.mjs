// The organization server's session cookie must outlive an app update and a
// quit (2026-10-20, JC: never signed out by an update). The cookie is a
// persistent one (Max-Age, re-issued on use) in the default session's jar
// under userData, which an update never touches; the startup eviction
// (startup-cache-eviction.mjs) empties the HTTP cache only. What remained is
// Chromium writing the jar lazily: a cookie set or renewed seconds before an
// update's quit could be lost. So the jar is flushed before every quit.

/** Write the cookie jar to disk now. Never throws; resolves within `timeoutMs`. */
export async function flushSessionCookies(electronSession, { log, timeoutMs = 2_000 } = {}) {
  const cookies = electronSession?.cookies;
  if (typeof cookies?.flushStore !== "function") return false;
  let timer;
  try {
    await Promise.race([
      Promise.resolve(cookies.flushStore()),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); timer.unref?.(); }),
    ]);
    return true;
  } catch (error) {
    log?.(`cookie jar flush failed: ${error?.message ?? error}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
