import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SECONDARY_CURSOR_HOTSPOT,
  SECONDARY_CURSOR_SIZE,
  displayContainingPoint,
  localPointOnDisplay,
  needsSecondaryAgentCursor,
  planSecondaryAgentCursor,
  pointInBounds,
} from "./agent-cursor-displays.mjs";

const PRIMARY = { id: 1, bounds: { x: 0, y: 0, width: 1728, height: 1117 } };
const RIGHT = { id: 2, bounds: { x: 1728, y: 0, width: 3008, height: 1692 } };
const BELOW = { id: 3, bounds: { x: 0, y: 1117, width: 1728, height: 1117 } };
const LEFT = { id: 4, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } };
const ABOVE = { id: 5, bounds: { x: -227, y: -1080, width: 1920, height: 1080 } };

test("pointInBounds accepts the left/top edge and rejects the right/bottom edge", () => {
  assert.equal(pointInBounds({ x: 0, y: 0 }, PRIMARY.bounds), true);
  assert.equal(pointInBounds({ x: 1727, y: 1116 }, PRIMARY.bounds), true);
  assert.equal(pointInBounds({ x: 1728, y: 0 }, PRIMARY.bounds), false);
  assert.equal(pointInBounds({ x: 0, y: 1117 }, PRIMARY.bounds), false);
  assert.equal(pointInBounds({ x: Number.NaN, y: 0 }, PRIMARY.bounds), false);
});

test("displayContainingPoint picks the secondary to the right of the primary", () => {
  const host = displayContainingPoint({ x: 3541, y: 508 }, [PRIMARY, RIGHT]);
  assert.equal(host?.id, RIGHT.id);
});

test("displayContainingPoint picks a display below or at negative X/Y", () => {
  assert.equal(displayContainingPoint({ x: 200, y: 1500 }, [PRIMARY, BELOW])?.id, BELOW.id);
  assert.equal(displayContainingPoint({ x: -100, y: 40 }, [PRIMARY, LEFT])?.id, LEFT.id);
  assert.equal(displayContainingPoint({ x: 733, y: -540 }, [PRIMARY, ABOVE])?.id, ABOVE.id);
});

test("localPointOnDisplay is relative to the display origin", () => {
  assert.deepEqual(localPointOnDisplay({ x: 3541, y: 508 }, RIGHT.bounds), { x: 1813, y: 508 });
  assert.deepEqual(localPointOnDisplay({ x: 733, y: -540 }, ABOVE.bounds), { x: 960, y: 540 });
});

test("planSecondaryAgentCursor stays off on the primary display", () => {
  const plan = planSecondaryAgentCursor({ x: 860, y: 560 }, [PRIMARY, RIGHT], PRIMARY.id);
  assert.equal(plan.show, false);
  assert.equal(plan.windowBounds, null);
});

test("planSecondaryAgentCursor shows an overlay on a right-hand secondary display", () => {
  const point = { x: 3541, y: 508 };
  const plan = planSecondaryAgentCursor(point, [PRIMARY, RIGHT], PRIMARY.id);
  assert.equal(plan.show, true);
  assert.equal(plan.suppressNativeOnPrimaryEdge, true);
  assert.equal(plan.displayId, RIGHT.id);
  assert.deepEqual(plan.local, { x: 1813, y: 508 });
  assert.deepEqual(plan.windowBounds, {
    x: point.x - SECONDARY_CURSOR_HOTSPOT.x,
    y: point.y - SECONDARY_CURSOR_HOTSPOT.y,
    width: SECONDARY_CURSOR_SIZE,
    height: SECONDARY_CURSOR_SIZE,
  });
});

test("planSecondaryAgentCursor covers below, left and above secondaries", () => {
  assert.equal(planSecondaryAgentCursor({ x: 100, y: 1200 }, [PRIMARY, BELOW], PRIMARY.id).show, true);
  assert.equal(planSecondaryAgentCursor({ x: -50, y: 20 }, [PRIMARY, LEFT], PRIMARY.id).displayId, LEFT.id);
  assert.equal(planSecondaryAgentCursor({ x: 733, y: -540 }, [PRIMARY, ABOVE], PRIMARY.id).displayId, ABOVE.id);
});

test("planSecondaryAgentCursor stays off with one display or bad input", () => {
  assert.equal(planSecondaryAgentCursor({ x: 10, y: 10 }, [PRIMARY], PRIMARY.id).show, false);
  assert.equal(planSecondaryAgentCursor(null, [PRIMARY, RIGHT], PRIMARY.id).show, false);
  assert.equal(planSecondaryAgentCursor({ x: 10, y: 10 }, null, PRIMARY.id).show, false);
});

test("needsSecondaryAgentCursor is macOS multi-display only", () => {
  assert.equal(needsSecondaryAgentCursor("darwin", [PRIMARY, RIGHT]), true);
  assert.equal(needsSecondaryAgentCursor("darwin", [PRIMARY]), false);
  assert.equal(needsSecondaryAgentCursor("win32", [PRIMARY, RIGHT]), false);
  assert.equal(needsSecondaryAgentCursor("linux", [PRIMARY, RIGHT]), false);
});
