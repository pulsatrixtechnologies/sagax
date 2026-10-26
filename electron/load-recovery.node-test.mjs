// 2026-10-19 (Windows, after an update): a black window with only "Not
// Found". The window now waits for a whole bundle and retries a failed load
// behind a loading page, then shows a readable error with "Try again".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createLoadRecovery,
  isAppPage,
  loadErrorPage,
  loadingPage,
  loadOutcome,
  RETRY_DELAYS_MS,
  referencedAssets,
  uiBundleState,
  waitForUiBundle,
} from "./load-recovery.mjs";

const LOCAL = "http://127.0.0.1:8799";
const ORG = "https://sagax.example.test";
const decode = (url) => decodeURIComponent(url.slice("data:text/html;charset=utf-8,".length));

test("only this app's page is taken over: never the API, a file, or another origin", () => {
  for (const url of [`${LOCAL}/`, `${LOCAL}/pair?code=x`, `${ORG}/`, `${ORG}/bots/abc`]) assert.equal(isAppPage(url, [LOCAL, ORG]), true, url);
  for (const url of [`${LOCAL}/api/health`, `${LOCAL}/assets/index.js`, `${ORG}/auth/callback`, "https://example.com/", "data:text/html,x", "nonsense"]) {
    assert.equal(isAppPage(url, [LOCAL, ORG]), false, url);
  }
});

test("an HTTP error or a refused connection is retried; a sign-in or an abort is not", () => {
  assert.equal(loadOutcome({ httpStatus: 200 }), "ok");
  assert.equal(loadOutcome({ httpStatus: 404 }), "retry");
  assert.equal(loadOutcome({ httpStatus: 502 }), "retry");
  assert.equal(loadOutcome({ httpStatus: 401 }), "ignore");
  assert.equal(loadOutcome({ httpStatus: 403 }), "ignore");
  assert.equal(loadOutcome({ errorCode: -102 }), "retry");
  assert.equal(loadOutcome({ errorCode: -6 }), "retry");
  assert.equal(loadOutcome({ errorCode: -3 }), "ignore");
});

test("server not ready, then answering: loading page between attempts, then success resets", () => {
  const recovery = createLoadRecovery();
  // 404 twice at start (files not yet there), then 200
  assert.deepEqual(recovery.next(), { kind: "retry", delayMs: RETRY_DELAYS_MS[0], attempt: 1 });
  assert.deepEqual(recovery.next(), { kind: "retry", delayMs: RETRY_DELAYS_MS[1], attempt: 2 });
  recovery.reset();
  assert.equal(recovery.attempts, 0);
  assert.equal(recovery.next().delayMs, RETRY_DELAYS_MS[0]);
  const html = decode(loadingPage({ language: "fr" }));
  assert.match(html, /Ouverture de Sagax…/);
  assert.doesNotMatch(html, /Not Found/i);
});

test("a lasting failure ends on a readable error page with Try again, never a raw Not Found", () => {
  const recovery = createLoadRecovery({ delays: [10, 20, 40] });
  const steps = [recovery.next(), recovery.next(), recovery.next(), recovery.next()];
  assert.deepEqual(steps.map((step) => step.kind), ["retry", "retry", "retry", "give-up"]);
  assert.ok(steps.slice(1, 3).every((step, index) => step.delayMs > steps[index].delayMs), "the delay grows");
  const fr = decode(loadErrorPage({ language: "fr", retryUrl: `${LOCAL}/` }));
  assert.match(fr, /Sagax n&#39;a pas pu s&#39;ouvrir/);
  assert.match(fr, new RegExp(`<a href="${LOCAL}/" autofocus>Réessayer</a>`));
  assert.doesNotMatch(fr, /<script/);
  const en = decode(loadErrorPage({ language: "en", retryUrl: `${LOCAL}/?a="b"` }));
  assert.match(en, />Try again</);
  assert.match(en, /href="http:\/\/127\.0\.0\.1:8799\/\?a=&quot;b&quot;"/, "the address is escaped");
  for (const text of [fr, en]) assert.doesNotMatch(text, /[–—]/);
});

test("the bundle is whole only with its page, every asset it names and the server's entry", () => {
  const html = '<script type="module" src="/assets/index-A.js"></script><link rel="modulepreload" href="/assets/store-B.js"><link rel="icon" href="/app-icon.svg">';
  assert.deepEqual(referencedAssets(html), ["assets/index-A.js", "assets/store-B.js"]);
  const root = path.join(path.sep, "app", "resources");
  const files = new Set([path.join(root, "ui", "assets", "index-A.js"), path.join(root, "server", "desktop-entry.mjs")]);
  const state = (present, page = html) => uiBundleState({
    resourcesPath: root,
    exists: (file) => present.has(file),
    readFile: () => { if (page === null) throw new Error("ENOENT"); return page; },
  });
  assert.deepEqual(state(files), { complete: false, missing: ["ui/assets/store-B.js"] });
  files.add(path.join(root, "ui", "assets", "store-B.js"));
  assert.deepEqual(state(files), { complete: true, missing: [] });
  assert.deepEqual(state(files, null).missing, ["ui/index.html"]);
});

test("at start: waits while an update copies its files, then goes on", async () => {
  let checks = 0;
  let waiting = 0;
  let clock = 0;
  const result = await waitForUiBundle({
    check: () => ({ complete: ++checks >= 3, missing: checks >= 3 ? [] : ["ui/index.html"] }),
    onWaiting: () => { waiting += 1; },
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  });
  assert.deepEqual(result, { complete: true, missing: [], waited: true });
  assert.equal(waiting, 1);
  assert.equal(checks, 3);
});

test("at start: a bundle that never completes gives up after the timeout", async () => {
  let clock = 0;
  const result = await waitForUiBundle({
    check: () => ({ complete: false, missing: ["server/desktop-entry.mjs"] }),
    intervalMs: 1000,
    timeoutMs: 5000,
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  });
  assert.equal(result.complete, false);
  assert.equal(result.waited, true);
  assert.ok(clock >= 5000 && clock <= 6000);
});

test("a whole bundle starts at once, without the loading screen's install line", async () => {
  let waiting = false;
  const result = await waitForUiBundle({ check: () => ({ complete: true, missing: [] }), onWaiting: () => { waiting = true; }, sleep: () => assert.fail("no wait") });
  assert.deepEqual(result, { complete: true, missing: [], waited: false });
  assert.equal(waiting, false);
});

test("main wires both guards", () => {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(app\.isPackaged\) installLoadRecovery\(win\);/);
  assert.match(source, /await waitForUiBundle\(\{\s*check: \(\) => uiBundleState\(\{ resourcesPath: process\.resourcesPath \}\)/);
  assert.match(source, /startupScreen\?\.fail\(`\$\{strings\.bundleTitle\}\. \$\{strings\.bundleBody\}`\)/);
});

test("an HTTP error with an empty body (Chromium -379) is retried too", () => {
  assert.equal(loadOutcome({ errorCode: -379 }), "retry");
});
