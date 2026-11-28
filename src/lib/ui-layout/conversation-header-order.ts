// Conversation header zone order helpers (D-20261127-004, #5443 PR2).

import { orderedOf } from "./ordered-of";
import type { ZoneLayout } from "./types";
import { CONVERSATION_HEADER_COMPONENT_IDS } from "./types";

const CONTROL_IDS = ["botPanel", "exportMenu", "liveCall", "tasks"] as const;

export function conversationHeaderHidden(zone: ZoneLayout, id: string): boolean {
  return zone.hidden.includes(id);
}

/** Right-side control ids in zone order, skipping hidden and unknown. */
export function conversationHeaderControlOrder(zone: ZoneLayout): string[] {
  return orderedOf(zone, CONTROL_IDS);
}

export function conversationHeaderTitleVisible(zone: ZoneLayout): boolean {
  return !zone.hidden.includes("title");
}

export function isConversationHeaderComponent(id: string): boolean {
  return (CONVERSATION_HEADER_COMPONENT_IDS as readonly string[]).includes(id);
}
