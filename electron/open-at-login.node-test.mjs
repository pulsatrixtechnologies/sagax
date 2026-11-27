import assert from "node:assert/strict";
import test from "node:test";
import { applyLoginItem, choiceDocument, parseChoice } from "./open-at-login.mjs";

test("an unset choice does not touch login items", () => {
  let calls = 0;
  const app = { setLoginItemSettings() { calls += 1; } };
  assert.equal(parseChoice(null), "unset");
  assert.deepEqual(applyLoginItem(app, "unset", "darwin"), { applied: false, openAtLogin: false });
  assert.equal(calls, 0);
});

test("accepting on a Mac turns the login item on, and declining turns it off", () => {
  const seen = [];
  const app = { setLoginItemSettings(value) { seen.push(value); } };
  assert.deepEqual(applyLoginItem(app, "on", "darwin"), { applied: true, openAtLogin: true });
  assert.deepEqual(applyLoginItem(app, "off", "darwin"), { applied: true, openAtLogin: false });
  assert.deepEqual(seen, [
    { openAtLogin: true },
    { openAtLogin: false },
  ]);
  assert.equal(choiceDocument("on"), JSON.stringify({ choice: "on" }));
});

test("other systems never set a login item", () => {
  let calls = 0;
  const app = { setLoginItemSettings() { calls += 1; } };
  assert.deepEqual(applyLoginItem(app, "on", "win32"), { applied: false, openAtLogin: false });
  assert.equal(calls, 0);
});
