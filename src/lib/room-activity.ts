import type { Message } from "@/state/store";
import { isStatusActivity, isTurnStoppedNotice } from "@/lib/activity-runs";
import { isAppleMobileWebClient, isToolActivityRow } from "@/lib/tool-activity-rows";
import { failedTurnCause } from "../../shared/failed-turn";

/** Whether a room shows this activity chip with tool calls hidden (the
 * default). Failures always show. A bot⇄bot comm chip ("Messaged @Ada") is
 * verbose detail: with tool calls (the details toggle) off it goes with the
 * other steps, matching Grok Bot's clean low-detail chat (JC 2026-10-22); a
 * failed send still shows as a failure. An opened-thread chip stays its own
 * decision: it reads as true here so the room still lays out its row, and
 * ThreadChip hides it when threads are off (src/components/ThreadChip.tsx).
 * iPhone / iPad web matches the native companion: error receipts are tool
 * rows, not failures to always show. */
export function roomActivityVisible(
  message: Message,
  showToolCalls: boolean,
  hideToolReceipts: boolean = isAppleMobileWebClient(),
): boolean {
  const tool = message.tool;
  if (message.kind !== "activity" || !tool) return false;
  if (isTurnStoppedNotice(message)) return false;
  // a Data receipt is a person's own result, never a tool receipt to hide
  if (message.dataResult) return true;
  if (hideToolReceipts) return !isToolActivityRow(message);
  // An opened-thread receipt reads as visible here (ThreadChip then gates it
  // on the threads toggle); a comm chip follows the details toggle below.
  if (message.threadRef || isStatusActivity(message)) return true;
  return tool.ok === false || failedTurnCause(tool.name) !== null || showToolCalls;
}
