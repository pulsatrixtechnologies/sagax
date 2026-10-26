// "mise à jour de l'app" (2026-10-20): an app update keeps the desktop's
// organization sign-in. The update path empties the HTTP cache once
// (startup-cache-eviction.mjs) and never the cookie jar or the storage that
// hold the session; the jar is flushed to disk before the quit.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { flushSessionCookies } from "./session-persistence.mjs";
import { evictStartupCacheOnce } from "./startup-cache-eviction.mjs";

/** A stand-in for Electron's default session: a cookie jar, origin storage, an HTTP cache. */
function fakeSession() {
  const state = {
    cookies: new Map([["omb_session_443_abc", "sgx_sess_kept"]]),
    storage: new Set(["localstorage", "indexdb"]),
    cache: 3,
    flushed: 0,
    cleared: [],
  };
  return {
    state,
    clearCache: async () => { state.cache = 0; },
    clearStorageData: async (options) => { state.cleared.push(options); state.cookies.clear(); },
    cookies: { flushStore: async () => { state.flushed += 1; } },
  };
}

test("mise à jour de l'app : la session du bureau survit au changement de version", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-update-"));
  try {
    const session = fakeSession();
    // the old build ran and quit for its update: the jar was flushed
    await evictStartupCacheOnce({ userData, currentVersion: "0.5.25", clearCache: () => session.clearCache() });
    assert.equal(await flushSessionCookies(session), true);
    assert.equal(session.state.flushed, 1);
    // the new build's first launch
    session.state.cache = 5;
    const result = await evictStartupCacheOnce({ userData, currentVersion: "0.6.0", clearCache: () => session.clearCache() });
    assert.equal(result.reason, "version-change");
    assert.equal(result.cleared, true);
    assert.equal(session.state.cache, 0);
    // the sign-in is still there: no storage or cookie clear on that path
    assert.deepEqual(session.state.cleared, []);
    assert.equal(session.state.cookies.get("omb_session_443_abc"), "sgx_sess_kept");
    assert.deepEqual([...session.state.storage], ["localstorage", "indexdb"]);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("the main process empties only the HTTP cache at startup and flushes the jar before a quit or an update", () => {
  const main = fs.readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const boot = main.slice(main.indexOf("await evictStartupCacheOnce({"), main.indexOf("await evictStartupCacheOnce({") + 400);
  assert.match(boot, /clearCache: \(\) => session\.defaultSession\.clearCache\(\)/);
  assert.doesNotMatch(boot, /clearStorageData|cookies\.remove/);
  const onUpdate = main.slice(main.indexOf('nativeAutoUpdater.on("before-quit-for-update"'), main.indexOf('nativeAutoUpdater.on("before-quit-for-update"') + 400);
  assert.match(onUpdate, /flushSessionCookies\(session\.defaultSession/);
  const beforeQuit = main.slice(main.indexOf('app.on("before-quit"'), main.indexOf("function releaseDesktopDataDirLease"));
  assert.match(beforeQuit, /flushSessionCookies\(session\.defaultSession/);
});

test("a flush that fails or hangs never blocks the quit", async () => {
  assert.equal(await flushSessionCookies({ cookies: { flushStore: async () => { throw new Error("io"); } } }), false);
  const started = Date.now();
  assert.equal(await flushSessionCookies({ cookies: { flushStore: () => new Promise(() => {}) } }, { timeoutMs: 50 }), true);
  assert.ok(Date.now() - started < 1_000);
  assert.equal(await flushSessionCookies(null), false);
});
