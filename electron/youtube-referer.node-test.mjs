import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { embedderReferer, isYoutubeEmbedUrl, withYoutubeEmbedReferer } from "./youtube-referer.mjs";

const EMBED = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?controls=1&enablejsapi=1&origin=http%3A%2F%2F127.0.0.1%3A8799";

test("only the YouTube embed document is concerned", () => {
  assert.equal(isYoutubeEmbedUrl(EMBED), true);
  assert.equal(isYoutubeEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"), true);
  assert.equal(isYoutubeEmbedUrl("https://youtube-nocookie.com/embed/x"), true);
  assert.equal(isYoutubeEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), false);
  assert.equal(isYoutubeEmbedUrl("https://www.youtube.com/iframe_api"), false);
  assert.equal(isYoutubeEmbedUrl("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"), false);
  assert.equal(isYoutubeEmbedUrl("http://www.youtube.com/embed/x"), false);
  assert.equal(isYoutubeEmbedUrl("https://www.youtube.com.evil.example/embed/x"), false);
  assert.equal(isYoutubeEmbedUrl("https://evil.example/embed/x?www.youtube.com"), false);
  assert.equal(isYoutubeEmbedUrl("not a url"), false);
});

test("the embedder is an origin, a loopback address named localhost", () => {
  assert.equal(embedderReferer("http://127.0.0.1:8799/?bot=1#x"), "http://localhost:8799/");
  assert.equal(embedderReferer("http://[::1]:8799/chat"), "http://localhost:8799/");
  assert.equal(embedderReferer("https://sagax.example.com/chat/123?q=secret"), "https://sagax.example.com/");
  assert.equal(embedderReferer("http://localhost:5199/"), "http://localhost:5199/");
  assert.equal(embedderReferer("file:///Applications/Sagax.app/index.html"), null);
  assert.equal(embedderReferer("data:text/html,x"), null);
  assert.equal(embedderReferer("about:blank"), null);
  assert.equal(embedderReferer(""), null);
  assert.equal(embedderReferer(undefined), null);
});

test("local window: the IP address Referer becomes localhost (YouTube: video unavailable)", () => {
  const headers = { "User-Agent": "x", Referer: "http://127.0.0.1:8799/" };
  const next = withYoutubeEmbedReferer({ url: EMBED, requestHeaders: headers }, () => null);
  assert.deepEqual(next, { "User-Agent": "x", Referer: "http://localhost:8799/" });
  assert.equal(headers.Referer, "http://127.0.0.1:8799/", "the original headers are left alone");
});

test("organization server: no Referer (Error 153) gets the page's origin", () => {
  const page = "https://sagax.example.com/c/abc?draft=1";
  const fromReferrer = withYoutubeEmbedReferer({ url: EMBED, requestHeaders: {}, referrer: page }, () => null);
  assert.deepEqual(fromReferrer, { Referer: "https://sagax.example.com/" });
  const fromWindow = withYoutubeEmbedReferer({ url: EMBED, requestHeaders: { Accept: "text/html" }, referrer: "" }, () => page);
  assert.deepEqual(fromWindow, { Accept: "text/html", Referer: "https://sagax.example.com/" });
});

test("a valid Referer, another request, or no known page: nothing changes", () => {
  const good = { referer: "https://sagax.example.com/" };
  assert.equal(withYoutubeEmbedReferer({ url: EMBED, requestHeaders: good }, () => "http://127.0.0.1:1/"), good);
  const other = {};
  assert.equal(withYoutubeEmbedReferer({ url: "https://www.youtube.com/youtubei/v1/player", requestHeaders: other }, () => "https://a.example/"), other);
  assert.equal(withYoutubeEmbedReferer({ url: "https://api.example.com/embed/x", requestHeaders: other }, () => "https://a.example/"), other);
  const none = {};
  assert.equal(withYoutubeEmbedReferer({ url: EMBED, requestHeaders: none }, () => null), none);
  assert.equal(withYoutubeEmbedReferer({ url: EMBED, requestHeaders: none }, () => "file:///x/index.html"), none);
});

test("a lower-case referer header is replaced, never doubled", () => {
  const next = withYoutubeEmbedReferer({ url: EMBED, requestHeaders: { referer: "http://127.0.0.1:8799/" } }, () => null);
  assert.deepEqual(next, { Referer: "http://localhost:8799/" });
});

test("main.mjs answers the embed document with this rule, in every build", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.match(main, /import \{ isYoutubeEmbedUrl, withYoutubeEmbedReferer \} from "\.\/youtube-referer\.mjs";/);
  assert.match(main, /if \(isYoutubeEmbedUrl\(details\.url\)\) \{\s*callback\(\{ requestHeaders: withYoutubeEmbedReferer\(details,/);
  assert.match(main, /installRequestHeaderRules\(\{ mutationHeader: app\.isPackaged \}\);/);
  // The mutation capability stays out of unpackaged runs.
  assert.match(main, /ownsTarget = mutationHeader && serverReady && \(target\.protocol === "http:" \|\| target\.protocol === "ws:"\)/);
  // One listener per session: no second onBeforeSendHeaders on the default session.
  assert.equal(main.match(/defaultSession\.webRequest\.onBeforeSendHeaders/g)?.length, 1);
});
