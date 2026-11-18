import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { isAppServerRequest, targetsAppServer } from "./desktop-owner-request.mjs";

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

test("the header rule of main.mjs goes through this check", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const rule = main.slice(main.indexOf("function installRequestHeaderRules"), main.indexOf("function installRequestHeaderRules") + 1600);
  assert.match(rule, /isAppServerRequest\(details, SERVER_PORT\)/);
  assert.doesNotMatch(rule, /target\.hostname === "127\.0\.0\.1"/);
});
