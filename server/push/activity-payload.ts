// APNs request for ActivityKit Live Activity updates and ends.
// Headers and body follow Apple's documentation:
// "Starting and updating Live Activities with ActivityKit push notifications"
//
//   apns-push-type: liveactivity
//   apns-topic: <bundleId>.push-type.liveactivity
//   apns-priority: 5 (opportunistic) or 10 (immediate; budgeted)
//
// Payload aps:
//   timestamp (unix seconds), event ("update" | "end"),
//   content-state (BotActivityContent JSON),
//   optional stale-date, dismissal-date, relevance-score (unix seconds / number).
import type { ApnsRequest } from "./payload.ts";
import {
  liveActivityRelevance,
  type LiveActivityContentState,
} from "./activity-content.ts";

export type LiveActivityEvent = "update" | "end";

export interface LiveActivityPushInput {
  event: LiveActivityEvent;
  contentState: LiveActivityContentState;
  bundleId: string;
  nowMs: number;
  /** Unix seconds after which the card is stale. */
  staleDateSec?: number;
  /** Unix seconds when the card leaves the lock screen (end only). */
  dismissalDateSec?: number;
  /** Higher shows first in the Dynamic Island. Default from content kind. */
  relevanceScore?: number;
  /** 10 for needsYou / end; 5 for routine working updates (Apple budget). */
  priority?: 5 | 10;
}

/** Topic for Live Activity pushes: bundle id + Apple's suffix. */
export function liveActivityTopic(bundleId: string): string {
  const id = bundleId.trim();
  return id.endsWith(".push-type.liveactivity") ? id : `${id}.push-type.liveactivity`;
}

/** Build one ActivityKit push request (headers + JSON body). */
export function buildLiveActivityRequest(input: LiveActivityPushInput): ApnsRequest {
  const timestamp = Math.floor(input.nowMs / 1000);
  const relevance = input.relevanceScore ?? liveActivityRelevance(input.contentState.kind);
  const aps: Record<string, unknown> = {
    timestamp,
    event: input.event,
    "content-state": input.contentState,
    "relevance-score": relevance,
  };
  if (input.staleDateSec !== undefined && Number.isFinite(input.staleDateSec)) {
    aps["stale-date"] = Math.floor(input.staleDateSec);
  }
  if (input.event === "end" && input.dismissalDateSec !== undefined && Number.isFinite(input.dismissalDateSec)) {
    aps["dismissal-date"] = Math.floor(input.dismissalDateSec);
  }
  const priority = input.priority ?? (input.event === "end" || input.contentState.kind === "needsYou" ? 10 : 5);
  const body = JSON.stringify({ aps });
  return {
    headers: {
      "apns-push-type": "liveactivity",
      "apns-topic": liveActivityTopic(input.bundleId),
      "apns-priority": String(priority),
      // updates may wait; an end should still arrive within a day
      "apns-expiration": String(timestamp + (input.event === "end" ? 24 * 60 * 60 : 60 * 60)),
    },
    body,
  };
}
