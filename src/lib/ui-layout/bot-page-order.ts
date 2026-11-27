// Bot page zone order helpers (D-20261127-004, #5443 PR2).

import type { ZoneLayout } from "./types";
import { BOT_PAGE_COMPONENT_IDS } from "./types";

const PROFILE_TAB_IDS = ["tab:general", "tab:outcomes", "tab:knowledge", "tab:stats"] as const;
const GENERAL_CARD_IDS = ["card:settings", "card:channels", "card:accounts", "card:more"] as const;
const PANEL_TAB_IDS = ["panel:activity", "panel:library", "panel:coding"] as const;

export function botPageHidden(zone: ZoneLayout, id: string): boolean {
  return zone.hidden.includes(id);
}

function orderedOf(zone: ZoneLayout, known: readonly string[]): string[] {
  const hidden = new Set(zone.hidden);
  const knownSet = new Set(known);
  const ordered = zone.order.filter((id) => knownSet.has(id) && !hidden.has(id));
  for (const id of known) {
    if (!hidden.has(id) && !ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

/** Profile tab component ids still visible, in zone order. */
export function botProfileTabOrder(zone: ZoneLayout): string[] {
  return orderedOf(zone, PROFILE_TAB_IDS);
}

/** General card ids still visible, in zone order. */
export function botGeneralCardOrder(zone: ZoneLayout): string[] {
  return orderedOf(zone, GENERAL_CARD_IDS);
}

/** Bot panel tab component ids still visible, in zone order. */
export function botPanelTabOrder(zone: ZoneLayout): string[] {
  return orderedOf(zone, PANEL_TAB_IDS);
}

/** Map profile tab id (`general`) ↔ component id (`tab:general`). */
export function profileTabComponentId(tab: string): string {
  return `tab:${tab}`;
}

export function profileTabFromComponentId(id: string): string | null {
  return id.startsWith("tab:") ? id.slice(4) : null;
}

export function panelTabComponentId(tab: string): string {
  return `panel:${tab}`;
}

export function panelTabFromComponentId(id: string): string | null {
  return id.startsWith("panel:") ? id.slice(6) : null;
}

export function generalCardComponentId(card: string): string {
  return `card:${card}`;
}

export function isBotPageComponent(id: string): boolean {
  return (BOT_PAGE_COMPONENT_IDS as readonly string[]).includes(id);
}

export { PROFILE_TAB_IDS, GENERAL_CARD_IDS, PANEL_TAB_IDS };
