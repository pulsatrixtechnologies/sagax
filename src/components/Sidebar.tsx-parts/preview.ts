// Bot row preview line (extracted from Sidebar.tsx, #1383).
import { approvalCardOutcome } from "../ApprovalCard";
import { peerLine } from "@/lib/peer-message";
import { activityPreview, botEngine } from "@/lib/failed-turn";
import { t } from "@/lib/i18n";
import { lastNonReceipt } from "@/lib/receipts";
import { citationPreviewText } from "@/lib/citations";
import { plainPreviewText } from "@/lib/plain-preview";
import { isClientCancellation } from "../../../shared/client-cancel";
import type { Bot, InstanceInfo, Message } from "@/state/store";

/** `visible` is the bot's visible branch (visibleMessages), which the row
 * already works out once per transcript. */
export function preview(bot: Bot, visible: Message[], instances: InstanceInfo[]): string {
  if (bot.activity === "waiting-on-you") return t("sidebar.preview.waiting");
  if (bot.waitingForTeammates) return t("sidebar.preview.waitingOnTeammate");
  if (bot.busy) return t("sidebar.preview.working");
  // the visible branch's tail — bot.messages holds every fork, so its last
  // entry can belong to a version the user switched away from — read past
  // the harness's receipts (digest, compaction) to the reply a person reads
  const last = lastNonReceipt(visible);
  if (!last) return "";
  // a settled approval card says what happened, as the card itself does;
  // its title is the question it asked, which nobody is waiting on now
  if (last.kind === "options" && last.card) {
    return (last.card.requestId && last.card.tool && !last.card.questionRequest && approvalCardOutcome(last.card)) || last.card.title;
  }
  // a failed turn reads as the chat row says it, never "error: …"
  if (last.kind === "activity" && last.tool) return activityPreview(last.tool, botEngine(bot, instances), last.dataResult);
  if (last.kind === "screen") return t("sidebar.preview.screenFrame");
  // one line of what the reply says, never the Markdown that draws it
  // (`**[repo](https://…)**` reads as "repo")
  const peer = peerLine(last);
  if (peer) return `${peer.name}: ${plainPreviewText(peer.body)}`;
  if (last.role !== "user" && isClientCancellation(last.text ?? "")) return t("chat.turnStopped");
  return plainPreviewText(citationPreviewText(last.text ?? ""));
}
