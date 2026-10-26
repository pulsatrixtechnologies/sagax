// The vendored electron-updater, pinned by configureUpdateFeed, against a
// mocked GitHub: every request must stay on Sagax's own releases, the stable
// channel reads /releases/latest, and the pre-release opt-in reads the feed.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { UPDATE_FEED, configureUpdateFeed, isOurReleaseUrl, readUpdatePrefs, updateChannel, writeUpdatePrefs } from "./update-feed.mjs";

const require = createRequire(import.meta.url);

function loadUpdater() {
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === "electron") return {};
    return original.call(this, request, ...rest);
  };
  try {
    return require("./vendor/electron-updater.cjs");
  } finally {
    Module._load = original;
  }
}

const RELEASES = "https://github.com/pulsatrixtechnologies/sagax/releases";
const atom = (tags) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">${tags
  .map((tag) => `<entry><id>${tag}</id><updated>2026-10-01T00:00:00Z</updated><link rel="alternate" type="text/html" href="${RELEASES}/tag/${tag}"/><title>${tag}</title><content type="html">notes</content></entry>`)
  .join("")}</feed>`;
const channelFile = (version) => `version: ${version}
files:
  - url: Sagax-${version}.zip
    sha512: ${"a".repeat(86)}==
    size: 1
path: Sagax-${version}.zip
sha512: ${"a".repeat(86)}==
releaseDate: '2026-10-01T00:00:00.000Z'
`;

function mockGitHub() {
  const requests = [];
  const executor = {
    async request(options) {
      const url = `${options.protocol}//${options.hostname}${options.path}`;
      requests.push(url);
      if (url === `${RELEASES}.atom`) return atom(["pulsa-v0.4.0-beta.1", "pulsa-v0.3.0"]);
      if (url === `${RELEASES}/latest`) return JSON.stringify({ tag_name: "pulsa-v0.3.0" });
      const file = url.match(/\/releases\/download\/pulsa-v([^/]+)\/latest[^/]*\.yml$/);
      if (file) return channelFile(file[1]);
      throw new Error(`unexpected request ${url}`);
    },
  };
  return { requests, executor };
}

function newUpdater(dir) {
  const { AppUpdater } = loadUpdater();
  const app = {
    version: "0.2.0",
    name: "Sagax",
    isPackaged: true,
    appUpdateConfigPath: join(dir, "app-update.yml"),
    userDataPath: dir,
    baseCachePath: dir,
    whenReady: () => Promise.resolve(),
    onQuit() {},
    quit() {},
    relaunch() {},
  };
  const updater = new AppUpdater(null, app);
  updater.logger = null;
  updater.autoDownload = false;
  return updater;
}

for (const allowPrerelease of [false, true]) {
  test(`a check (${allowPrerelease ? "pre-releases" : "stable"}) only reaches our releases`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-update-feed-"));
    try {
      const updater = newUpdater(dir);
      const github = mockGitHub();
      updater.httpExecutor = github.executor;
      configureUpdateFeed(updater, { allowPrerelease });
      const result = await updater.checkForUpdates();
      assert.equal(result.updateInfo.version, allowPrerelease ? "0.4.0-beta.1" : "0.3.0");
      assert.equal(result.isUpdateAvailable, true);
      assert.ok(github.requests.length > 0);
      for (const url of github.requests) assert.ok(isOurReleaseUrl(url), `left our releases: ${url}`);
      if (!allowPrerelease) assert.ok(github.requests.includes(`${RELEASES}/latest`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("the feed is Sagax's GitHub repository, nothing else", () => {
  assert.deepEqual({ ...UPDATE_FEED }, { provider: "github", owner: "pulsatrixtechnologies", repo: "sagax" });
  assert.equal(isOurReleaseUrl(`${RELEASES}/download/pulsa-v0.3.0/latest-mac.yml`), true);
  assert.equal(isOurReleaseUrl("https://github.com/milind-soni/OpenMausBot/releases/latest"), false);
  assert.equal(isOurReleaseUrl("https://github.com/pulsatrixtechnologies/sagax-evil/releases"), false);
  assert.equal(isOurReleaseUrl("http://github.com/pulsatrixtechnologies/sagax/releases"), false);
  assert.equal(isOurReleaseUrl("https://cloud.openmausbot.com/update"), false);
});

test("the pre-release opt-in is off unless saved on", () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-update-prefs-"));
  try {
    assert.deepEqual(readUpdatePrefs(dir), { allowPrerelease: false, autoInstallWhenAway: false });
    writeUpdatePrefs(dir, { allowPrerelease: true });
    assert.deepEqual(readUpdatePrefs(dir), { allowPrerelease: true, autoInstallWhenAway: false });
    writeUpdatePrefs(dir, { allowPrerelease: "yes", autoInstallWhenAway: true });
    assert.deepEqual(readUpdatePrefs(dir), { allowPrerelease: false, autoInstallWhenAway: true });
    assert.equal(updateChannel({ allowPrerelease: true }), "nightly");
    assert.equal(updateChannel({}), "stable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function publishBlock(yml) {
  return String(yml).replace(/\r\n/g, "\n").match(/^publish:\n((?:[ \t-].*\n)+)/m)?.[1] ?? "";
}

test("electron-builder publishes to the same repository", async () => {
  const { readFileSync } = await import("node:fs");
  const yml = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
  const publish = publishBlock(yml);
  assert.match(publish, /provider: github/);
  assert.match(publish, /owner: pulsatrixtechnologies/);
  assert.match(publish, /repo: sagax/);
  assert.doesNotMatch(publish, /provider: (generic|s3|spaces|keygen|bitbucket|snapStore)/);
});

test("the publish block matches a CRLF checkout the way GitHub Actions Windows writes it", () => {
  const yml = "appId: com.openmausbot.app\r\npublish:\r\n  - provider: github\r\n    owner: pulsatrixtechnologies\r\n    repo: sagax\r\n";
  const publish = publishBlock(yml);
  assert.match(publish, /provider: github/);
  assert.match(publish, /owner: pulsatrixtechnologies/);
  assert.match(publish, /repo: sagax/);
});
