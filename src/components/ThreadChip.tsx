// The receipt a bot leaves when it opens a thread, "Opened thread #QA PR
// 245 on Scout", drawn as the same centered "Go to conversation" line a
// collapsed bot-to-bot exchange uses (ConversationLink). Clicking shows that
// thread; it never redirects work (openThread). Like a comm chip it stays
// visible with Tool calls hidden: it is the only trace, where the person is
// reading, that a new thread now exists. When the thread has since been
// deleted the receipt is not drawn at all (lib/dead-thread-chips).
//
// #3581: threads off, a notice another bot's thread surfaced ("Message from
// <bot>: #title") is the names line of every trace between bots.
import { openThread, useStore, type Message } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { navigationTargetGone } from "@/lib/dead-thread-chips";
import { ConversationLink } from "./ConversationLink";
import { HandoffRow, IncomingLine } from "./HandoffRow";
import { incomingEntry } from "@/lib/incoming-line";
import { isHandoff } from "@/lib/handoff-row";
import { stepLabel } from "@/lib/step-label";
import type { MausColor } from "@/lib/mascot";
import { Box } from "lucide-react";
import { StepRow } from "./StepRow";

/** Receipts of work the bot sent into one of its threads or coding
 * sessions: drawn "Messaged <title>" in the single stream. */
const MESSAGED = /^(?:Opened thread|Resumed thread|Parallel task) #/;

/** Threads off: the receipt as a plain step, "Messaged" + cube + the
 * session title. No link and no "Open thread" (unified chat). */
export function ThreadReceiptRow({ message }: { message: Message }) {
  const ref = message.threadRef;
  const tool = message.tool;
  if (!ref || !tool) return null;
  const messaged = MESSAGED.test(tool.name ?? "");
  const label = messaged ? t("chat.messaged") : stepLabel(tool);
  return (
    <StepRow
      label={label}
      target={messaged ? ref.title || undefined : undefined}
      icon={<Box size={13} className="shrink-0" aria-hidden="true" />}
      testId="thread-receipt"
      data={{ "data-thread-receipt": ref.threadId }}
    />
  );
}

export function ThreadChip({ message }: { message: Message }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const ref = message.threadRef;
  const tool = message.tool;
  if (!ref || !tool) return null;
  // Threads off (Settings > Appearance): the single stream shows no thread
  // link in the chat (2026-10-22). A hand-off to a teammate shows in place:
  // "Asked <teammate>" with its brief and the teammate's verdict folded
  // under it (HandoffRow, 2026-11-09, #2901). Every other receipt shows as
  // a plain step, "Messaged <session>" (nothing invisible): hiding it made
  // the bot's work in a coding session vanish from the chat.
  if (!showThreads) {
    if (isHandoff(message)) return <HandoffRow message={message} />;
    // #3581: a notice another bot's thread surfaced here: "Message from [face] Bot B"
    const notice = incomingEntry(message, "", []);
    if (notice?.verb === "messageFrom") {
      const self = state.bots.find((candidate) => candidate.id === ref.botId);
      return <IncomingLine line={{ verb: notice.verb, entries: [notice] }} self={self} bots={state.bots} mid={message.id} />;
    }
    return <ThreadReceiptRow message={message} />;
  }
  if (navigationTargetGone(message, state)) return null;
  const bot = state.bots.find((candidate) => candidate.id === ref.botId);
  const group = bot ? undefined : state.groups.find((candidate) => candidate.id === ref.botId);
  const name = bot?.name ?? group?.name ?? ref.title;
  const color = (bot?.color ?? "blue") as MausColor;
  return (
    <ConversationLink
      bot={bot ?? { name, color }}
      name={name}
      color={color}
      attributes={{ "data-thread-chip": ref.threadId }}
      title={ref.title ? t("chat.openThread", { title: ref.title }) : t("chat.goToConversation")}
      onClick={() => openThread(dispatch, ref, state, showThreads)}
    />
  );
}

