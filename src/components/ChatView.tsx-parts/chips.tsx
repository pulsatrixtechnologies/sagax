import { AttentionCard } from "../AttentionCard";
import { memo, useContext } from "react";
import { LiveToolsContext } from "@/hooks/use-live-tool-ids";
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
import { answerPersonRequest, cardPlace, InputRequestCard, skipPersonRequest } from "../InputRequestCard";
import { RenameTitle } from "../RenameTitle";
import { delegateModelLabel } from "../DelegationList";
import { RoutineRunCard } from "../RoutineRunCard";
import { BotAvatar } from "../Avatar";
import { normalizeState } from "@/lib/mascot";
import { ToolActivity, botNames } from "../ToolActivity";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { WakeFeedback, useOwnsBot } from "../WakeFeedback";
import { WatchAlertExits, watchAlertOf } from "../WatchAlertExits";
import { useChatRows } from "./types";
import { routineResultFolded } from "@/lib/routine-result-stack";

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
  const { bots, dispatch, botDmIds, threadId, botId } = useChatRows(), liveTools = useContext(LiveToolsContext);
  const tool = message.tool;
  if (!tool) return null;
  if (message.inputRequest) return <InputRequestCard message={message} threadId={threadId} conversationBotId={botId} />;
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
export function AttentionRow({ message, threadId, botId }: { message: Message; threadId?: string; /** the bot that owns this conversation */ botId?: string }) {
  "use memo";
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  const showThreads = useShowThreads();
  const card = message.attention;
  const owner = useStoreSelector((state) => state.bots.find((candidate) => candidate.id === card?.botId));
  // #3457: a watch alert carries its two exits; the bot's owner only
  const watchAlert = watchAlertOf(message.routineRun);
  const ownsWatch = useOwnsBot(card?.botId);
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
      // #3438: then the card is marked handled, so the pinned card over the
      // composer and this one settle together
      onReply={showThreads ? undefined : (text) => answerPersonRequest(card, text, cardPlace(card, message, threadId, botId))}
      // #3471: skipped without an answer, the waiting work told so
      onSkip={showThreads || !threadId ? undefined : () => skipPersonRequest({ botId: botId ?? card.botId, threadId, messageId: message.id }, dispatch, message)}
    />
    {/* #2694: the bot's owner says what to bring less, here as on Today */}
    <div className="flex flex-wrap items-start gap-x-1">
      <WakeFeedback botId={card.botId} topic={message.routineRun?.wakeTopic ?? "attention"} value={card.feedback} threadId={threadId} messageId={message.id} choices={watchAlert ? WATCH_FEEDBACK : undefined} />
      {watchAlert && ownsWatch && <WatchAlertExits watches={watchAlert} />}
    </div>
    </div>
  );
}

/** A watch alert's own exits replace the row's "never" (it stopped those
 * watches too); the thumbs and « Moins de ça » stay. */
const WATCH_FEEDBACK = ["up", "down", "less"] as const;

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
  // #3581: a result a newer one follows folds to its row (one card per stack)
  const folded = useStoreSelector((state) => {
    const owner = state.bots.find((candidate) => candidate.id === botId) ?? state.groups.find((group) => group.id === botId);
    return routineResultFolded(owner?.messages ?? [], message.id);
  });
  // #2694: a heartbeat or an email or calendar wake is rated once it has finished.
  // #3990: only what it suggested to the person (a result): never under a
  // run's state (with problems, works again, a failure, a streak's summary)
  const rated = run?.wakeTopic && run.status === "completed" && !run.problems && !run.recovered && !run.repeat ? run.wakeTopic : undefined;
  // #3457: every alert of a chosen watch carries « Arrêter cette veille » and
  // « Arrêter ce domaine », for the bot's owner, at once
  const watchAlert = watchAlertOf(run);
  const ownsWatch = useOwnsBot(ownerId);
  return (
    <div className="flex min-w-0 flex-col gap-1">
    <RoutineRunCard
      message={message}
      bot={owner}
      folded={folded}
      botOf={(id) => bots.find((candidate) => candidate.id === id)}
      onResume={onResume}
      onOpen={run?.runId ? () => openRoutineRun(dispatch, { runId: run.runId, routineId: run.routineId, ...(message.from?.botId ? { botId: message.from.botId } : {}), report: { text: run.summary ?? "", at: message.at } }) : undefined}
      // 2026-11-05 (#2096): Stop on the run itself while it is live.
      onStop={run?.runId ? () => dispatch({ type: "cancelRoutineRun", runId: run.runId }) : undefined}
      // 2026-11-03: a run that handed work to a teammate links that thread;
      // threads shown only (#2081): one conversation names the teammate, no link.
      onOpenThread={showThreads ? (botId, threadId) => { openThread(dispatch, { botId, threadId }, getState(), showThreads); } : undefined}
      // 2026-11-06: each teammate's row names the model it works on.
      modelOf={(id, threadId) => delegateModelLabel(bots.find((candidate) => candidate.id === id), instances, threadId)}
    />
    {(rated || (watchAlert && ownsWatch)) && (
      <div className="flex flex-wrap items-start gap-x-1">
        {rated && <WakeFeedback botId={ownerId} topic={rated} value={run?.feedback} threadId={threadId} messageId={message.id} choices={watchAlert ? WATCH_FEEDBACK : undefined} />}
        {watchAlert && ownsWatch && <WatchAlertExits watches={watchAlert} />}
      </div>
    )}
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
        {(bot.description ?? "") || t("chat.emptyPrompt")}
      </div>
    </div>
  );
}

/** The settled transcript, memoized as one unit: it renders when any
 * message on the branch or the chat's ChatRows change. Each row inside is
 * memoized on its own message, so a patched tool chip renders that chip and
 * nothing else. */
