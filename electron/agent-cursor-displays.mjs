// Pure placement for the agent cursor when the desktop spans several displays.
// Cua Driver's macOS overlay still covers only NSScreen.mainScreen (trycua/cua#5336);
// Sagax draws a secondary overlay on the display that actually contains the point.
//
// Coordinate space: Electron display.bounds and Cua get_cursor_position share global
// DIP / top-left points (negative origins allowed). scaleFactor converts screenshot
// physical pixels on a given display into that DIP space; overlay window bounds stay
// in DIP so mixed-DPI layouts place correctly.

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} CursorBounds
 * @typedef {{ id: number, bounds: CursorBounds, scaleFactor?: number }} CursorDisplay
 * @typedef {{ x: number, y: number }} CursorPoint
 */

export const SECONDARY_CURSOR_SIZE = 48;
/** Hotspot of the drawn arrow, in local overlay pixels (tip near top-left). */
export const SECONDARY_CURSOR_HOTSPOT = Object.freeze({ x: 6, y: 4 });

/** Safe scale factor for a display (missing or non-positive → 1). */
export function displayScale(display) {
  const scale = Number(display?.scaleFactor);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Strip Electron display objects down to id, DIP bounds and scaleFactor. */
export function normalizeCursorDisplays(displays) {
  if (!Array.isArray(displays)) return [];
  const out = [];
  for (const display of displays) {
    const bounds = display?.bounds;
    if (!bounds) continue;
    const { x, y, width, height } = bounds;
    if (![x, y, width, height].every(Number.isFinite)) continue;
    const id = Number(display.id);
    if (!Number.isFinite(id)) continue;
    out.push({
      id,
      bounds: { x, y, width, height },
      scaleFactor: displayScale(display),
    });
  }
  return out;
}

/** Axis-aligned union of display DIP bounds (for a spanning overlay). */
export function unionDisplayBounds(displays) {
  if (!Array.isArray(displays) || displays.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const display of displays) {
    const bounds = display?.bounds;
    if (!bounds) continue;
    const { x, y, width, height } = bounds;
    if (![x, y, width, height].every(Number.isFinite)) continue;
    any = true;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  if (!any) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Convert a screenshot pixel on one display into global DIP.
 * Screenshot buffers are physical pixels; Electron placement uses DIP.
 */
export function screenshotPixelToGlobalDip(pixel, display) {
  if (!pixel || !display?.bounds) return null;
  if (![pixel.x, pixel.y, display.bounds.x, display.bounds.y].every(Number.isFinite)) return null;
  const scale = displayScale(display);
  return {
    x: display.bounds.x + pixel.x / scale,
    y: display.bounds.y + pixel.y / scale,
  };
}

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
 * Primary stays with Cua Driver's native overlay. `point` is global DIP.
 */
export function planSecondaryAgentCursor(point, displays, primaryDisplayId) {
  const empty = {
    show: false,
    suppressNativeOnPrimaryEdge: false,
    displayId: null,
    scaleFactor: null,
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
    scaleFactor: displayScale(host),
    local,
    windowBounds,
  };
}

/** True when a multi-display desktop needs the Sagax secondary cursor helper. */
export function needsSecondaryAgentCursor(platform, displays) {
  return platform === "darwin" && Array.isArray(displays) && displays.length > 1;
}
