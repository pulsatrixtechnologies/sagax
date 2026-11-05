// Pure placement for the agent cursor when the desktop spans several displays.
// Cua Driver's macOS overlay still covers only NSScreen.mainScreen (trycua/cua#5336);
// Sagax draws a secondary overlay on the display that actually contains the point.

/** @typedef {{ id: number, bounds: { x: number, y: number, width: number, height: number } }} CursorDisplay */
/** @typedef {{ x: number, y: number }} CursorPoint */

export const SECONDARY_CURSOR_SIZE = 48;
/** Hotspot of the drawn arrow, in local overlay pixels (tip near top-left). */
export const SECONDARY_CURSOR_HOTSPOT = Object.freeze({ x: 6, y: 4 });

export function pointInBounds(point, bounds) {
  if (!point || !bounds) return false;
  const { x, y } = point;
  const { x: left, y: top, width, height } = bounds;
  if (![x, y, left, top, width, height].every(Number.isFinite)) return false;
  return x >= left && x < left + width && y >= top && y < top + height;
}

/** Display that contains `point`, preferring the smallest area on a seam. */
export function displayContainingPoint(point, displays) {
  if (!point || !Array.isArray(displays) || displays.length === 0) return null;
  let best = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const display of displays) {
    const bounds = display?.bounds;
    if (!pointInBounds(point, bounds)) continue;
    const area = Math.max(0, bounds.width) * Math.max(0, bounds.height);
    if (area < bestArea) {
      best = display;
      bestArea = area;
    }
  }
  return best;
}

export function localPointOnDisplay(point, bounds) {
  if (!point || !bounds) return null;
  if (![point.x, point.y, bounds.x, bounds.y].every(Number.isFinite)) return null;
  return { x: point.x - bounds.x, y: point.y - bounds.y };
}

/**
 * Decide whether Sagax must draw its own cursor (secondary display) and where.
 * Primary stays with Cua Driver's native overlay.
 */
export function planSecondaryAgentCursor(point, displays, primaryDisplayId) {
  const empty = {
    show: false,
    suppressNativeOnPrimaryEdge: false,
    displayId: null,
    local: null,
    windowBounds: null,
  };
  if (!point || !Array.isArray(displays) || displays.length < 2) return empty;
  if (![point.x, point.y].every(Number.isFinite)) return empty;

  const primary =
    displays.find((display) => display?.id === primaryDisplayId) ??
    displays.find((display) => pointInBounds({ x: 0, y: 0 }, display?.bounds)) ??
    displays[0];
  const host = displayContainingPoint(point, displays);
  if (!host?.bounds) return empty;

  const onPrimary = primary != null && host.id === primary.id;
  if (onPrimary) return empty;

  const local = localPointOnDisplay(point, host.bounds);
  if (!local) return empty;

  const size = SECONDARY_CURSOR_SIZE;
  const windowBounds = {
    x: Math.round(point.x - SECONDARY_CURSOR_HOTSPOT.x),
    y: Math.round(point.y - SECONDARY_CURSOR_HOTSPOT.y),
    width: size,
    height: size,
  };

  return {
    show: true,
    // Cua still paints into the main-screen pixmap and pins a ghost on the edge
    // when the real point is past the right or bottom of the primary display.
    suppressNativeOnPrimaryEdge: true,
    displayId: host.id,
    local,
    windowBounds,
  };
}

/** True when a multi-display desktop needs the Sagax secondary cursor helper. */
export function needsSecondaryAgentCursor(platform, displays) {
  return platform === "darwin" && Array.isArray(displays) && displays.length > 1;
}
