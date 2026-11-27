// Conversation header zone order helpers (D-20261127-004, #5443 PR2).

import type { ZoneLayout } from "./types";
import { CONVERSATION_HEADER_COMPONENT_IDS } from "./types";

const CONTROL_IDS = new Set(["botPanel", "exportMenu", "liveCall", "tasks"]);

export function conversationHeaderHidden(zone: ZoneLayout, id: string): boolean {
  return zone.hidden.includes(id);
}

/** Right-side control ids in zone order, skipping hidden and unknown. */
export function conversationHeaderControlOrder(zone: ZoneLayout): string[] {
  const hidden = new Set(zone.hidden);
  const ordered = zone.order.filter((id) => CONTROL_IDS.has(id) && !hidden.has(id));
  for (const id of ["botPanel", "exportMenu", "liveCall", "tasks"]) {
    if (!hidden.has(id) && !ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

export function conversationHeaderTitleVisible(zone: ZoneLayout): boolean {
  return !zone.hidden.includes("title");
}

export function isConversationHeaderComponent(id: string): boolean {
  return (CONVERSATION_HEADER_COMPONENT_IDS as readonly string[]).includes(id);
}
