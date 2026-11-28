// Pure draft helpers for customize mode (D-20261127-004, #5443).
// Mutations stay inside one zone; fixed components are never hidden.

import { isHideable } from "./registry";
import type { UiLayoutV1, UsagePlacement, ZoneId, ZoneLayout } from "./types";
import { COMPOSER_BAR_COMPONENT_IDS } from "./types";

function cloneZone(zone: ZoneLayout): ZoneLayout {
  return {
    order: [...zone.order],
    hidden: [...zone.hidden],
    ...(zone.left !== undefined ? { left: zone.left } : {}),
    ...(zone.usagePlacement !== undefined ? { usagePlacement: zone.usagePlacement } : {}),
  };
}

export function cloneLayout(layout: UiLayoutV1): UiLayoutV1 {
  return {
    version: 1,
    zones: {
      composerBar: cloneZone(layout.zones.composerBar),
      sidebar: cloneZone(layout.zones.sidebar),
      conversationHeader: cloneZone(layout.zones.conversationHeader),
      botPage: cloneZone(layout.zones.botPage),
    },
  };
}

function withZone(layout: UiLayoutV1, zoneId: ZoneId, next: ZoneLayout): UiLayoutV1 {
  const out = cloneLayout(layout);
  out.zones[zoneId] = next;
  return out;
}

/** Move one component to an absolute index within its zone order (0..length-1). */
export function moveInZone(layout: UiLayoutV1, zoneId: ZoneId, id: string, toIndex: number): UiLayoutV1 {
  const zone = layout.zones[zoneId];
  const from = zone.order.indexOf(id);
  if (from < 0) return layout;
  const order = [...zone.order];
  order.splice(from, 1);
  const clamped = Math.max(0, Math.min(order.length, toIndex));
  order.splice(clamped, 0, id);
  let left = zone.left;
  if (zoneId === "composerBar" && typeof left === "number") {
    if (from < left && clamped >= left) left = Math.max(0, left - 1);
    else if (from >= left && clamped < left) left = Math.min(order.length, left + 1);
    left = Math.max(0, Math.min(order.length, left));
  }
  return withZone(layout, zoneId, { ...cloneZone(zone), order, ...(left !== undefined ? { left } : {}) });
}

/** Move one step within the zone (keyboard arrows). */
export function nudgeInZone(layout: UiLayoutV1, zoneId: ZoneId, id: string, delta: -1 | 1): UiLayoutV1 {
  const from = layout.zones[zoneId].order.indexOf(id);
  if (from < 0) return layout;
  const to = from + delta;
  if (to < 0 || to >= layout.zones[zoneId].order.length) return layout;
  return moveInZone(layout, zoneId, id, to);
}

/** Hide a hideable component; fixed / unknown non-hideable ids are ignored. */
export function hideInZone(layout: UiLayoutV1, zoneId: ZoneId, id: string): UiLayoutV1 {
  if (!isHideable(zoneId, id)) return layout;
  const zone = layout.zones[zoneId];
  if (zone.hidden.includes(id)) return layout;
  const order = zone.order.filter((entry) => entry !== id);
  let left = zone.left;
  if (zoneId === "composerBar" && typeof left === "number") {
    const from = zone.order.indexOf(id);
    if (from >= 0 && from < left) left = Math.max(0, left - 1);
    left = Math.max(0, Math.min(order.length, left));
  }
  return withZone(layout, zoneId, {
    ...cloneZone(zone),
    order,
    hidden: [...zone.hidden, id],
    ...(left !== undefined ? { left } : {}),
  });
}

/** Restore a hidden component to the end of the visible order (or a given index). */
export function restoreInZone(layout: UiLayoutV1, zoneId: ZoneId, id: string, toIndex?: number): UiLayoutV1 {
  const zone = layout.zones[zoneId];
  if (!zone.hidden.includes(id)) return layout;
  const hidden = zone.hidden.filter((entry) => entry !== id);
  const order = [...zone.order];
  const clamped = toIndex === undefined
    ? order.length
    : Math.max(0, Math.min(order.length, toIndex));
  order.splice(clamped, 0, id);
  return withZone(layout, zoneId, { ...cloneZone(zone), order, hidden });
}

/** composerBar: put a button left or right of the text field. */
export function setComposerSide(layout: UiLayoutV1, id: string, side: "left" | "right"): UiLayoutV1 {
  const zone = layout.zones.composerBar;
  const from = zone.order.indexOf(id);
  if (from < 0) return layout;
  const leftCount = zone.left ?? 0;
  const onLeft = from < leftCount;
  if (side === "left" && onLeft) return layout;
  if (side === "right" && !onLeft) return layout;
  const order = [...zone.order];
  order.splice(from, 1);
  if (side === "left") {
    order.splice(leftCount, 0, id);
    return withZone(layout, "composerBar", { ...cloneZone(zone), order, left: leftCount + 1 });
  }
  const insertAt = Math.max(0, leftCount - 1);
  order.splice(insertAt, 0, id);
  return withZone(layout, "composerBar", {
    ...cloneZone(zone),
    order,
    left: Math.max(0, leftCount - 1),
  });
}

export function setUsagePlacement(layout: UiLayoutV1, placement: UsagePlacement): UiLayoutV1 {
  const zone = layout.zones.composerBar;
  if (zone.usagePlacement === placement) return layout;
  return withZone(layout, "composerBar", { ...cloneZone(zone), usagePlacement: placement });
}

/** Visible composer items for slots (usage omitted from the bar when above/below). */
export function composerVisibleOrder(zone: ZoneLayout): { left: string[]; right: string[] } {
  const placement = zone.usagePlacement ?? "inBar";
  const leftCount = zone.left ?? 0;
  const visible = zone.order.filter((item) => item !== "usage" || placement === "inBar");
  let count = 0;
  for (let i = 0; i < leftCount; i++) {
    const item = zone.order[i];
    if (item && (item !== "usage" || placement === "inBar")) count += 1;
  }
  count = Math.max(0, Math.min(visible.length, count));
  return { left: visible.slice(0, count), right: visible.slice(count) };
}

export function isComposerBarItem(id: string): id is (typeof COMPOSER_BAR_COMPONENT_IDS)[number] {
  return (COMPOSER_BAR_COMPONENT_IDS as readonly string[]).includes(id);
}
