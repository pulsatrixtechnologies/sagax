// Sidebar zone order helpers (D-20261127-004, #5443).

import type { ZoneLayout } from "./types";
import { SIDEBAR_KNOWN_COMPONENT_IDS } from "./types";

const HEAD_IDS = new Set(["collapse", "search", "new"]);

/** Head button ids in zone order, skipping hidden. */
export function sidebarHeadOrder(zone: ZoneLayout): string[] {
  const hidden = new Set(zone.hidden);
  const ordered = zone.order.filter((id) => HEAD_IDS.has(id) && !hidden.has(id));
  // Fill any missing visible head ids in default order.
  for (const id of ["collapse", "search", "new"]) {
    if (!hidden.has(id) && !ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

export function sidebarComponentHidden(zone: ZoneLayout, id: string): boolean {
  return zone.hidden.includes(id);
}

/** Merge live section ids into the zone order (keep known chrome, append new sections). */
export function mergeSidebarSections(zone: ZoneLayout, sectionIds: string[]): ZoneLayout {
  const hidden = new Set(zone.hidden);
  const known = new Set<string>(SIDEBAR_KNOWN_COMPONENT_IDS);
  const existing = new Set(zone.order);
  const order = [...zone.order];
  for (const id of sectionIds) {
    if (existing.has(id) || hidden.has(id)) continue;
    // Insert sections before accountUsage when present.
    const at = order.indexOf("accountUsage");
    if (at >= 0) order.splice(at, 0, id);
    else order.push(id);
    existing.add(id);
    known.add(id);
  }
  return { ...zone, order };
}

/** Section ids for the list: live ids, filtered by hidden, sorted by zone order. */
export function orderedSidebarSections(zone: ZoneLayout, sectionIds: string[]): string[] {
  const hidden = new Set(zone.hidden);
  const live = sectionIds.filter((id) => !hidden.has(id));
  const rank = new Map(zone.order.map((id, index) => [id, index]));
  return [...live].sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a)! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b) ? rank.get(b)! : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return live.indexOf(a) - live.indexOf(b);
  });
}
