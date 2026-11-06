import test from "node:test";
import assert from "node:assert/strict";

import { captureScreenThumbnail, screenThumbnailAllowed, SCREEN_THUMBNAIL_SIZE } from "./screen-thumbnail.mjs";

const picture = (empty = false) => ({ isEmpty: () => empty, toJPEG: () => Buffer.from([0xff, 0xd8, 0xff]) });

test("macOS captures only once Screen Recording is granted, Windows always, Linux never", () => {
  assert.equal(screenThumbnailAllowed("darwin", "granted"), true);
  for (const status of ["denied", "not-determined", "restricted", "unknown", undefined]) assert.equal(screenThumbnailAllowed("darwin", status), false);
  assert.equal(screenThumbnailAllowed("win32", undefined), true);
  assert.equal(screenThumbnailAllowed("linux", "granted"), false);
});

test("no capture is asked before the grant (no permission prompt)", async () => {
  let asked = 0;
  const getSources = async () => { asked += 1; return [{ thumbnail: picture() }]; };
  assert.equal(await captureScreenThumbnail({ platform: "darwin", screenStatus: "not-determined", getSources }), null);
  assert.equal(asked, 0);
});

test("a granted capture is a small JPEG data URL with its time and host", async () => {
  let asked;
  const getSources = async (options) => { asked = options; return [{ thumbnail: picture() }]; };
  const shot = await captureScreenThumbnail({ platform: "darwin", screenStatus: "granted", getSources, hostName: "Mac.local", now: () => 42 });
  assert.deepEqual(asked, { types: ["screen"], thumbnailSize: SCREEN_THUMBNAIL_SIZE });
  assert.deepEqual(shot, { image: "data:image/jpeg;base64,/9j/", at: 42, host: "Mac.local" });
});

test("an empty picture is no frame", async () => {
  const getSources = async () => [{ thumbnail: picture(true) }];
  assert.equal(await captureScreenThumbnail({ platform: "win32", getSources }), null);
  assert.equal(await captureScreenThumbnail({ platform: "win32", getSources: async () => [] }), null);
});
