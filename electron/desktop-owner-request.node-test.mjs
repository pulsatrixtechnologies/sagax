import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createRedirectLedger, createRequestEndHub, isAppServerRequest, targetsAppServer } from "./desktop-owner-request.mjs";

const PORT = 8799;
const APP = `http://127.0.0.1:${PORT}`;
const req = (over) => ({ url: `${APP}/api/bots`, resourceType: "xhr", referrer: `${APP}/`, requestHeaders: {}, ...over });

test("only the server's own port on 127.0.0.1 is a target", () => {
  assert.equal(targetsAppServer(`${APP}/api/bots`, PORT), true);
  assert.equal(targetsAppServer(`ws://127.0.0.1:${PORT}/api/terminal/sessions/x/ws`, PORT), true);
  assert.equal(targetsAppServer("http://127.0.0.1:8800/api/bots", PORT), false);
  assert.equal(targetsAppServer(`https://127.0.0.1:${PORT}/api/bots`, PORT), false);
  assert.equal(targetsAppServer(`http://localhost:${PORT}/api/bots`, PORT), false);
  assert.equal(targetsAppServer("not a url", PORT), false);
});

test("the app's own calls and resources carry it", () => {
  assert.equal(isAppServerRequest(req({}), PORT), true);
  assert.equal(isAppServerRequest(req({ resourceType: "other", url: `${APP}/api/events` }), PORT), true);
  assert.equal(isAppServerRequest(req({ resourceType: "image", url: `${APP}/api/threads/t/messages/m/file?preview=1&ref=3`, referrer: `${APP}/chat` }), PORT), true);
  // a WebSocket handshake names its page in Origin
  assert.equal(isAppServerRequest(req({ resourceType: "webSocket", url: `ws://127.0.0.1:${PORT}/api/terminal/sessions/x/ws`, referrer: "", requestHeaders: { Origin: APP } }), PORT), true);
  assert.equal(isAppServerRequest(req({ resourceType: "mainFrame", url: `${APP}/`, referrer: "" }), PORT), true);
  // the app's page preview frame (no Referer by its own policy)
  assert.equal(isAppServerRequest(req({ resourceType: "subFrame", url: `${APP}/pages/preview/p/1`, referrer: "", frame: { url: `${APP}/pages/preview/p/1`, parent: { url: `${APP}/` } } }), PORT), true);
});

test("a load that message content names never carries it, even toward the server's port", () => {
  // a bare picture or a media segment drawn with no Referer
  assert.equal(isAppServerRequest(req({ resourceType: "image", url: `${APP}/api/bots`, referrer: "" }), PORT), false);
  assert.equal(isAppServerRequest(req({ resourceType: "media", url: `${APP}/api/media/x.ts`, referrer: "" }), PORT), false);
  // a frame of another origin (a page, a widget document) asking the port
  assert.equal(isAppServerRequest(req({ referrer: "https://evil.example/", requestHeaders: { Origin: "https://evil.example" } }), PORT), false);
  assert.equal(isAppServerRequest(req({ referrer: "", requestHeaders: { Origin: "null" } }), PORT), false);
  assert.equal(isAppServerRequest(req({ resourceType: "subFrame", referrer: "", frame: { url: `${APP}/x`, parent: { url: "https://evil.example/" } } }), PORT), false);
  assert.equal(isAppServerRequest(req({ resourceType: "subFrame", referrer: "", frame: null }), PORT), false);
  // another port, another host
  assert.equal(isAppServerRequest(req({ url: "http://127.0.0.1:9999/api/bots" }), PORT), false);
});

// #4764 review: an external .mp4 (or playlist, or the expiry probe) that
// answers 302 toward the app's port arrives with the app's Referer.
test("a request redirected toward the server from elsewhere never carries it: media, xhr, fetch", () => {
  const external = "https://media.example.test/clip.mp4";
  for (const [id, resourceType, requestHeaders] of [
    [101, "media", {}],
    [102, "xhr", { Origin: "null" }],
    [103, "xhr", {}],
  ]) {
    const ledger = createRedirectLedger();
    ledger.noteRedirect({ id, url: external, redirectURL: `${APP}/api/bots` }, PORT);
    const redirected = req({ id, resourceType, url: `${APP}/api/bots`, referrer: `${APP}/`, requestHeaders });
    assert.equal(isAppServerRequest(redirected, PORT, ledger), false, `${resourceType} ${JSON.stringify(requestHeaders)}`);
    // another request of the app, never redirected, still carries it
    assert.equal(isAppServerRequest(req({ id: id + 1000 }), PORT, ledger), true);
  }
  // a redirect from the app's own server (its own 302) keeps it
  const own = createRedirectLedger();
  own.noteRedirect({ id: 7, url: `${APP}/api/old`, redirectURL: `${APP}/api/new` }, PORT);
  assert.equal(isAppServerRequest(req({ id: 7, url: `${APP}/api/new` }), PORT, own), true);
});

// M-20261120-026: the app's page is served with `referrer-policy: no-referrer`
// (server/static-ui.ts PAGE_HEADERS) and Chromium sends no Origin on a
// same-origin GET fetch (measured in real Chromium and in Electron 44 against a
// server answering like the app's). The session check at launch carried
// neither header, lost the capability and PairPage opened on the app's own
// server. webRequest's `initiatorOrigin` names the origin that issued the
// request; a page controls neither it nor the redirect ledger above.
test("a same-origin GET with no Origin and no Referer is still the app's call, by its initiator", () => {
  // the session check at launch (`GET /api/auth/session`) and every other
  // fetch, stream and file preview of the app's own page: no Origin (GET),
  // no Referer (no-referrer page)
  assert.equal(isAppServerRequest(req({ url: `${APP}/api/auth/session`, referrer: "", initiatorOrigin: APP }), PORT), true);
  assert.equal(isAppServerRequest(req({ resourceType: "other", url: `${APP}/api/events`, referrer: "", initiatorOrigin: APP }), PORT), true);
  assert.equal(isAppServerRequest(req({ resourceType: "image", url: `${APP}/api/threads/t/messages/m/file?preview=1&ref=3`, referrer: "", initiatorOrigin: APP }), PORT), true);
  // an origin that is not the app's stays refused, opaque ("null", a
  // sandboxed bot page) or not; an absent initiator behaves like before
  assert.equal(isAppServerRequest(req({ referrer: "", initiatorOrigin: "https://evil.example" }), PORT), false);
  assert.equal(isAppServerRequest(req({ referrer: "", initiatorOrigin: "null" }), PORT), false);
  assert.equal(isAppServerRequest(req({ referrer: "", initiatorOrigin: null }), PORT), false);
  assert.equal(isAppServerRequest(req({ referrer: "" }), PORT), false);
  // an Origin header stays the answer even against a matching initiator
  assert.equal(isAppServerRequest(req({ referrer: "", initiatorOrigin: APP, requestHeaders: { Origin: "https://evil.example" } }), PORT), false);
  // and a request redirected toward the port from elsewhere stays refused
  const ledger = createRedirectLedger();
  ledger.noteRedirect({ id: 42, url: "https://media.example.test/clip.mp4" }, PORT);
  assert.equal(isAppServerRequest(req({ id: 42, resourceType: "media", referrer: "", initiatorOrigin: APP }), PORT, ledger), false);
});

test("Origin: null is never made up for by the app's Referer", () => {
  assert.equal(isAppServerRequest(req({ referrer: `${APP}/`, requestHeaders: { Origin: "null" } }), PORT), false);
  assert.equal(isAppServerRequest(req({ referrer: `${APP}/`, requestHeaders: { origin: "https://evil.example" } }), PORT), false);
  assert.equal(isAppServerRequest(req({ referrer: "", requestHeaders: { Origin: APP } }), PORT), true);
});

// #4810: a long video keeps its id marked however many other requests
// redirect meanwhile; the id goes only when its own request ends.
test("a redirected request stays marked until it ends, with no size limit", () => {
  const ledger = createRedirectLedger();
  ledger.noteRedirect({ id: 1, url: "https://media.example.test/clip.mp4" }, PORT);
  for (let id = 2; id < 10_002; id++) ledger.noteRedirect({ id, url: "https://x.example/a" }, PORT);
  assert.equal(ledger.startedElsewhere({ id: 1 }), true, "the long video's id is still marked");
  assert.equal(isAppServerRequest(req({ id: 1, resourceType: "media" }), PORT, ledger), false);
  const hub = createRequestEndHub();
  hub.subscribe((_kind, details) => ledger.forget(details));
  hub.dispatch("completed", { id: 1 });
  hub.dispatch("error", { id: 2 });
  assert.equal(ledger.startedElsewhere({ id: 1 }), false);
  assert.equal(ledger.startedElsewhere({ id: 2 }), false);
  assert.equal(ledger.size, 9_999);
});

test("the end-of-request hub feeds every subscriber, one failing or leaving never stops the others", () => {
  const hub = createRequestEndHub();
  const seen = [];
  hub.subscribe(() => { throw new Error("boom"); });
  const leave = hub.subscribe((kind, details) => seen.push(`a:${kind}:${details.id}`));
  hub.subscribe((kind, details) => seen.push(`b:${kind}:${details.id}`));
  hub.dispatch("completed", { id: 5 });
  leave();
  hub.dispatch("error", { id: 6 });
  assert.deepEqual(seen, ["a:completed:5", "b:completed:5", "b:error:6"]);
});

test("the header rule of main.mjs goes through this check", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const rule = main.slice(main.indexOf("function installRequestHeaderRules"), main.indexOf("function installRequestHeaderRules") + 2600);
  assert.match(rule, /webRequest\.onBeforeRedirect\(\(details\) => redirects\.noteRedirect\(details, SERVER_PORT\)\)/);
  // forgotten at the end of each request, through the shared hub
  assert.match(rule, /requestEndHub\.subscribe\(\(_kind, details\) => redirects\.forget\(details\)\)/);
  assert.match(rule, /webRequest\.onCompleted\(\(details\) => requestEndHub\.dispatch\("completed", details\)\)/);
  assert.match(rule, /webRequest\.onErrorOccurred\(\(details\) => requestEndHub\.dispatch\("error", details\)\)/);
  // no other code replaces the default session's end-of-request listeners
  assert.doesNotMatch(main, /defaultSession\.webRequest\.onCompleted\(null\)/);
  const redeem = main.slice(main.indexOf("function watchSignInRedeem"), main.indexOf("function watchSignInRedeem") + 2600);
  assert.match(redeem, /requestEndHub\.subscribe\(/);
  assert.match(rule, /isAppServerRequest\(details, SERVER_PORT, redirects\)/);
  assert.doesNotMatch(rule, /target\.hostname === "127\.0\.0\.1"/);
});
