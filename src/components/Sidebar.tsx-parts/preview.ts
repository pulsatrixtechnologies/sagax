// Bot row preview line (extracted from Sidebar.tsx, #1383).
import { approvalCardOutcome } from "../ApprovalCard";
import { peerLine } from "@/lib/peer-message";
import { activityPreview, botEngine } from "@/lib/failed-turn";
import { t } from "@/lib/i18n";
import { questionCardTitle } from "@/lib/question-card-title";
import { lastSpokenLine } from "@/lib/receipts";
import { citationPreviewText } from "@/lib/citations";
import { plainPreviewText } from "@/lib/plain-preview";
import { isClientCancellation } from "../../../shared/client-cancel";
import type { Bot, InstanceInfo, Message } from "@/state/store";

/** 2026-11-09: "Waiting for you" says on what (the card's question or
 * approval, WireBot.waitingOn); a server without it keeps the plain line. */
export function waitingLine(bot: Pick<Bot, "waitingOn">): string {
  const text = bot.waitingOn?.text.trim();
  return text ? t("sidebar.preview.waitingFor", { text }) : t("sidebar.preview.waiting");
}

/** "Waiting on a teammate" names who (WireBot.waitingOnTeammates). */
export function teammateWaitLine(bot: Pick<Bot, "waitingOnTeammates">): string {
  const names = (bot.waitingOnTeammates ?? []).filter((name) => name.trim());
  return names.length ? t("sidebar.preview.waitingOnNamed", { names: names.join(", ") }) : t("sidebar.preview.waitingOnTeammate");
}

/** `visible` is the bot's visible branch (visibleMessages), which the row
 * already works out once per transcript. */
export function preview(bot: Bot, visible: Message[], instances: InstanceInfo[]): string {
  if (bot.activity === "waiting-on-you") return waitingLine(bot);
  if (bot.waitingForTeammates) return teammateWaitLine(bot);
  if (bot.busy) return t("sidebar.preview.working");
  // the visible branch's tail — bot.messages holds every fork, so its last
  // entry can belong to a version the user switched away from — read past
  // the harness's receipts (digest, compaction) to the reply a person reads
  // (#2081) and past a run receipt with nothing to read: the preview is the
  // bot's last words, never "Routine ... failed"
  const last = lastSpokenLine(visible);
  if (!last) return "";
  // a finished run's report is the bot's message (#2081): its first line
  if (last.kind === "routine.run" && last.routineRun?.summary) return plainPreviewText(citationPreviewText(last.routineRun.summary));
  // what the bot left for the person reads as the bot's own words, never
  // "<bot> has a question for you:" (#2081)
  if (last.attention?.items.length) return plainPreviewText(last.attention.items[0]!.text);
  // a settled approval card says what happened, as the card itself does;
  // its title is the question it asked, which nobody is waiting on now
  // #4093: a question card with no title reads as its first question, so
  // the row keeps its second line as the reference's rows do
  if (last.kind === "options" && last.card) {
    return (last.card.requestId && last.card.tool && !last.card.questionRequest && approvalCardOutcome(last.card))
      || questionCardTitle(last.card)
      || plainPreviewText(last.card.questionRequest?.questions[0]?.question ?? last.card.subtitle ?? "");
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
