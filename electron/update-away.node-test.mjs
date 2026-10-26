import assert from "node:assert/strict";
import test from "node:test";

import { ACTIVITY_STALE_MS, awayInstallDecision, cleanActiveBots } from "./update-away.mjs";

const base = { status: "downloaded", systemIdle: { state: "idle" }, activeBots: 0, reportedAt: 1000, now: 2000, enabled: true };

test("installs only a downloaded update, when away, with no bot working and a fresh count", () => {
  assert.deepEqual(awayInstallDecision(base), { install: true, reason: "away" });
  assert.equal(awayInstallDecision({ ...base, systemIdle: { state: "locked" } }).install, true);
  assert.equal(awayInstallDecision({ ...base, systemIdle: { state: "active" } }).reason, "present");
  assert.equal(awayInstallDecision({ ...base, systemIdle: { state: "unknown" } }).install, false);
  assert.equal(awayInstallDecision({ ...base, systemIdle: null }).install, false);
  assert.equal(awayInstallDecision({ ...base, status: "downloading" }).install, false);
  assert.equal(awayInstallDecision({ ...base, enabled: false }).reason, "off");
  assert.equal(awayInstallDecision({ ...base, handOff: true }).reason, "hand-off");
});

test("never restarts on a guess: a bot working, a count never reported or gone stale", () => {
  assert.equal(awayInstallDecision({ ...base, activeBots: 1 }).reason, "bots-working");
  assert.equal(awayInstallDecision({ ...base, activeBots: null }).reason, "activity-unknown");
  assert.equal(awayInstallDecision({ ...base, now: base.reportedAt + ACTIVITY_STALE_MS + 1 }).reason, "activity-unknown");
});

test("waiting for the bots needs no absence but the same safe count", () => {
  const waiting = { ...base, enabled: false, waiting: true, systemIdle: { state: "active" } };
  assert.deepEqual(awayInstallDecision(waiting), { install: true, reason: "bots-finished" });
  assert.equal(awayInstallDecision({ ...waiting, activeBots: 3 }).install, false);
  assert.equal(awayInstallDecision({ ...waiting, activeBots: null }).install, false);
});

test("a reported count is a whole number or nothing", () => {
  assert.equal(cleanActiveBots(2.9), 2);
  assert.equal(cleanActiveBots("3"), 3);
  for (const bad of [-1, NaN, "x", undefined, Infinity]) assert.equal(cleanActiveBots(bad), null);
});
