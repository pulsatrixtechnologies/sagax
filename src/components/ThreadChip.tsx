// The receipt a bot leaves when it opens a thread, "Opened thread #QA PR
// 245 on Scout", drawn as the same centered "Go to conversation" line a
// collapsed bot-to-bot exchange uses (ConversationLink). Clicking shows that
// thread; it never redirects work (openThread). Like a comm chip it stays
// visible with Tool calls hidden: it is the only trace, where the person is
// reading, that a new thread now exists. When the thread has since been
// deleted the receipt is not drawn at all (lib/dead-thread-chips).
import { openThread, useStore, type Message } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { navigationTargetGone } from "@/lib/dead-thread-chips";
import { ConversationLink } from "./ConversationLink";
import { HandoffRow } from "./HandoffRow";
import { isHandoff } from "@/lib/handoff-row";
import type { MausColor } from "@/lib/mascot";

export function ThreadChip({ message }: { message: Message }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const ref = message.threadRef;
  const tool = message.tool;
  if (!ref || !tool) return null;
  // Threads off (Settings > Appearance): the single stream shows no thread
  // row or link in the chat (2026-10-22). A hand-off to a teammate still
  // shows, in place: "Asked <teammate>" with its brief and the teammate's
  // verdict folded under it (HandoffRow, 2026-11-09, #2901: nothing
  // invisible). Its thread stays reachable from the bot panel.
  if (!showThreads) return isHandoff(message) ? <HandoffRow message={message} /> : null;
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

