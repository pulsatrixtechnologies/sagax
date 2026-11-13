import type { Message } from "@/state/store";
import { isTurnStoppedNotice } from "@/lib/activity-runs";
import { activityRowShown, isAppleMobileWebClient } from "@/lib/tool-activity-rows";

/** Whether a room draws this step's chip. Settings > Tool calls is the
 * chat's one rule (activityRowShown, #4171); this only adds the room's
 * layout: a room draws a chip for a step (a row with a tool), and a stopped
 * turn's notice stays out of it as it stays out of the chat's list. An
 * opened-thread chip reads as shown here; ThreadChip then gates it on the
 * threads toggle (src/components/ThreadChip.tsx). */
export function roomActivityVisible(
  message: Message,
  showToolCalls: boolean,
  appleMobileWeb: boolean = isAppleMobileWebClient(),
): boolean {
  if (message.kind !== "activity" || !message.tool) return false;
  if (isTurnStoppedNotice(message)) return false;
  return activityRowShown(message, showToolCalls, appleMobileWeb);
}
