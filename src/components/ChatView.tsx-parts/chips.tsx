import { AttentionCard } from "../AttentionCard";
import { memo } from "react";
import { api, openRoutineRun, openThread, type Bot, type Message } from "@/state/store";
import { useStoreDispatch, useStoreGetter, useStoreSelector, shallowEqual } from "@/state/store-selector";
import { useAdvancedMode } from "@/lib/interface-mode";
import { readableError } from "@/lib/plain-error";
import type { PeerLine } from "@/lib/peer-message";
import { autoWorkerLine } from "@/lib/auto-model";
import { toolPlace, type EffectivePlace } from "@/lib/place";
import { StepRow } from "../StepRow";
import { stepLabel } from "@/lib/step-label";
import { ThreadChip } from "../ThreadChip";
import { SendReceiptRow } from "../SendReceiptRow";
import { InputRequestCard } from "../InputRequestCard";
import { RenameTitle } from "../RenameTitle";
import { delegateModelLabel } from "../DelegationList";
import { RoutineRunCard } from "../RoutineRunCard";
import { BotAvatar } from "../Avatar";
import { normalizeState } from "@/lib/mascot";
import { ToolActivity, botNames } from "../ToolActivity";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { WakeFeedback } from "../WakeFeedback";
import { useChatRows } from "./types";
import { botDescriptionText } from "@/lib/system-bot-copy";

export function PeerLabel({ peer, autoModel }: { peer: PeerLine; autoModel?: Message["autoModel"] }) {
  "use memo";
  const { bots } = useChatRows();
  const author =
    bots.find((b) => b.id === peer.botId) ?? bots.find((b) => b.name === peer.name);
  const how =
    peer.delivery === "ai_client"
      ? t("chat.peer.viaAiClient")
      : peer.delivery === "delegate_bot"
      ? t("chat.peer.delegated")
      : peer.delivery === "start_thread"
        ? t("chat.peer.openedThread")
        : peer.delivery === "coordinate_bots"
          ? t("chat.peer.requested")
          : peer.delivery === "relayed_reply"
            ? t("chat.peer.replied")
          : t("chat.peer.asked");
  return (
    <div className="mb-1 flex items-center gap-1.5 pl-0.5" data-testid="peer-label">
      <BotAvatar
        bot={author ?? { name: peer.name, color: "blue" }}
        state={normalizeState(author?.mascotExpression) ?? "happy"}
        size={16}
        motion="none"
        motionKey={0}
        animated={false}
      />
      <span className="text-[11px] font-medium text-ink-secondary">{peer.delivery === "ai_client" ? t("chat.peer.aiClientName") : peer.name}</span>
      <span className="text-[11px] text-ink-tertiary">· {how}</span>
      {/* Auto: the model this delegated work runs on, and its class. */}
      {autoModel?.role === "worker" && (
        <span data-peer-auto-model className="min-w-0 truncate text-[11px] text-ink-tertiary">· {autoWorkerLine(autoModel)}</span>
      )}
    </div>
  );
}

/** A tool run as a quiet step row (StepRow), or a receipt that opens a conversation. */
export const ActivityChip = memo(function ActivityChip({ message, place = "auto" }: { message: Message; place?: EffectivePlace }) {
  "use memo";
  const { bots, dispatch, botDmIds, liveTools } = useChatRows();
  const tool = message.tool;
  if (!tool) return null;
  if (message.inputRequest) return <InputRequestCard message={message} />;
  if (message.sendReceipt) return <SendReceiptRow message={message} />;
  if (message.threadRef) return <ThreadChip message={message} />;
  // bot⇄bot comm chip: a DM is read in this column (the exchange sheet), not
  // by selecting that channel. A Posted-in-room receipt still opens the room.
  const comm = message.comm;
  if (comm) {
    const withBot = bots.find((b) => b.id === comm.withBotId);
    const stay = botDmIds.has(comm.groupId);
    return (
      <div className="flex justify-start">
        <StepRow
          testId="bot-comm-chip"
          label={stepLabel(tool, botNames(bots))}
          // 2026-10-21 (parité 1C): what it sent, after "Messaged @X"
          target={comm.direction !== "received" && comm.text ? comm.text : undefined}
          phase={tool.ok === false ? "failed" : "done"}
          icon={<BotAvatar bot={withBot ?? { name: comm.withName, color: comm.withColor }} state="happy" size={14} animated={false} />}
          title={stay ? undefined : t("chat.openConversationWith", { name: comm.withName })}
          onActivate={stay ? undefined : () => dispatch({ type: "select", id: comm.groupId })}
        />
      </div>
    );
  }
  // 2026-11-05 (JC): no role notice in the chat (rows saved before stay hidden)
  if (tool.roleNotice) return null;
  return <ToolActivity tool={tool} live={liveTools.has(message.id)} place={toolPlace(tool.name, place)} nameOf={botNames(bots)} />;
});

/** A routine run's receipt. View run opens the run's detail (2026-10-29),
 * a run of a deleted routine too, to read. */

/** What a bot's turn elsewhere left for the person (2026-11-05): its card,
 * with the thread it was said in and the run it came from one click away. */
export function AttentionRow({ message, threadId }: { message: Message; threadId?: string }) {
  "use memo";
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  const showThreads = useShowThreads();
  const card = message.attention;
  const owner = useStoreSelector((state) => state.bots.find((candidate) => candidate.id === card?.botId));
  if (!card) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
    <AttentionCard
      card={card}
      bot={owner}
      // one conversation (#2081): no thread is a destination; the person answers in place
      onOpenThread={showThreads ? (botId, threadId) => { openThread(dispatch, { botId, threadId }, getState(), showThreads); } : undefined}
      onOpenRun={(runId) => openRoutineRun(dispatch, { runId })}
      // the answer is the person's own message into the thread the bot asked in (coordinator.answer)
      onReply={showThreads ? undefined : async (text) => {
        await api(`/api/bots/${card.botId}/messages`, { method: "POST", body: JSON.stringify({ text, threadId: card.threadId, sendId: crypto.randomUUID() }) });
      }}
    />
    {/* #2694: the bot's owner says what to bring less, here as on Today */}
    <WakeFeedback botId={card.botId} topic={message.routineRun?.wakeTopic ?? "attention"} value={card.feedback} threadId={threadId} messageId={message.id} />
    </div>
  );
}

export function RoutineRunRow({ message, botId, threadId, onResume }: { message: Message; botId: string; threadId?: string; onResume?: () => void }) {
  "use memo";
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  const showThreads = useShowThreads();
  const run = message.routineRun;
  // 2026-11-04: the card leads with the bot's mascot, and a teammate it
  // handed work to shows its own.
  // Only the bots this card draws, so another bot's change leaves it be.
  const ownerId = message.from?.botId ?? botId;
  const bots = useStoreSelector((state) => {
    const ids = new Set([ownerId, ...(run?.handedTo ?? []).map((entry) => entry.botId)]);
    return state.bots.filter((candidate) => ids.has(candidate.id));
  }, shallowEqual);
  const owner = bots.find((candidate) => candidate.id === ownerId);
  const instances = useStoreSelector((state) => state.instances);
  // #2694: a heartbeat or an email or calendar wake is rated once it has finished
  const rated = run?.wakeTopic && run.status !== "running" && run.status !== "queued" && run.status !== "waiting" ? run.wakeTopic : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
    <RoutineRunCard
      message={message}
      bot={owner}
      botOf={(id) => bots.find((candidate) => candidate.id === id)}
      onResume={onResume}
      onOpen={run?.runId ? () => openRoutineRun(dispatch, { runId: run.runId, routineId: run.routineId }) : undefined}
      // 2026-11-05 (#2096): Stop on the running card itself; the card shows it while the run is live.
      onStop={run?.runId ? () => dispatch({ type: "cancelRoutineRun", runId: run.runId }) : undefined}
      // 2026-11-03: a run that handed work to a teammate links that thread;
      // threads shown only (#2081): one conversation names the teammate, no link.
      onOpenThread={showThreads ? (botId, threadId) => { openThread(dispatch, { botId, threadId }, getState(), showThreads); } : undefined}
      // 2026-11-06: each teammate's row names the model it works on.
      modelOf={(id, threadId) => delegateModelLabel(bots.find((candidate) => candidate.id === id), instances, threadId)}
    />
    {rated && <WakeFeedback botId={ownerId} topic={rated} value={run?.feedback} threadId={threadId} messageId={message.id} />}
    </div>
  );
}

/** A conversation with nothing in it yet: its name and a prompt. */
export function EmptyChat({ bot }: { bot: Bot }) {
  const dispatch = useStoreDispatch();
  const advanced = useAdvancedMode();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
      {/* No mascot here: the header already shows the bot (2026-10-16).
          Simple mode renames in the bot's settings only. */}
      {!advanced ? <div className="text-[17px] font-semibold text-ink">{bot.name}</div> : <RenameTitle
        value={bot.name}
        onCommit={(name) => {
          if (window.ogb?.remoteClient?.active) {
            void api(`/api/bots/${bot.id}/profile`, { method: "PATCH", body: JSON.stringify({ name }) })
              .then(({ bot: updated }) => dispatch({ type: "botPatched", bot: updated }))
              .catch((cause) => dispatch({ type: "error", message: readableError(cause) }));
          } else {
            dispatch({ type: "updateBot", botId: bot.id, patch: { name } });
          }
        }}
        className="text-[17px] font-semibold text-ink"
        inputClassName="rounded bg-inset px-1.5 py-0.5 text-center text-[17px] font-semibold"
      />}
      <div className="max-w-[360px] text-[14px] text-ink-secondary">
        {botDescriptionText(bot) || t("chat.emptyPrompt")}
      </div>
    </div>
  );
}

/** The settled transcript, memoized as one unit: it renders when any
 * message on the branch or the chat's ChatRows change. Each row inside is
 * memoized on its own message, so a patched tool chip renders that chip and
 * nothing else. */
