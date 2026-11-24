import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hasContextMenu, imageMenuItems, textMenuTarget } from "./image-menu-items.mjs";

const MAIN_SOURCE = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
const image = { mediaType: "image", hasImageContents: true, srcURL: "https://sagax.example/api/files/shot.png", x: 120, y: 340, isEditable: false, linkURL: "", misspelledWord: "", selectionText: "" };
const nothing = { mediaType: "none", hasImageContents: false, srcURL: "", x: 1, y: 2, isEditable: false, linkURL: "", misspelledWord: "", selectionText: "" };

test("#5226: a right-click on an image offers Copy Image, which copies the image under the pointer", () => {
  const copied = [];
  const items = imageMenuItems(image, { copyImageAt: (x, y) => copied.push([x, y]) });
  assert.deepEqual(items.map((item) => item.label), ["Copy Image"]);
  items[0].click();
  assert.deepEqual(copied, [[120, 340]]);
  assert.equal(hasContextMenu(image), true);
  // an image alone is not a text target: no wall of disabled Undo, Cut, Paste
  assert.equal(textMenuTarget(image), false);
});

test("an image inside a link, an editable field or a selection keeps the text entries too", () => {
  for (const extra of [{ linkURL: "https://sagax.example/page" }, { isEditable: true }, { selectionText: "words" }, { misspelledWord: "wrod" }]) {
    assert.equal(textMenuTarget({ ...image, ...extra }), true);
    assert.equal(imageMenuItems({ ...image, ...extra }, { copyImageAt() {} }).length, 1);
  }
});

test("no image, a broken image or another media gets no image entry, and nothing actionable gets no menu", () => {
  assert.deepEqual(imageMenuItems(nothing, null), []);
  assert.deepEqual(imageMenuItems({ ...image, hasImageContents: false }, null), []);
  assert.deepEqual(imageMenuItems({ ...image, mediaType: "video" }, null), []);
  assert.equal(hasContextMenu(nothing), false);
  assert.equal(hasContextMenu({ ...nothing, selectionText: "words" }), true);
  assert.equal(hasContextMenu({ ...nothing, isEditable: true }), true);
});

test("the window's context menu is built with the image entries", () => {
  const start = MAIN_SOURCE.indexOf("async function showContextMenu(");
  const body = MAIN_SOURCE.slice(start, MAIN_SOURCE.indexOf("\n}\n", start));
  assert.match(body, /if \(!hasContextMenu\(params\)\) return;/);
  assert.match(body, /imageMenuItems\(params, contents\)/);
  assert.match(body, /if \(textMenuTarget\(params\)\)/);
});
