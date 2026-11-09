/** One finished tool step in a room: the same quiet step row the 1:1 chat
 * uses (StepRow). A row
 * that links somewhere ("Posted in #Standup", a bot⇄bot exchange) opens it,
 * as it would in a 1:1 — a receipt the person cannot follow is only half a
 * receipt. When the linked channel IS this room (an ask made from here is
 * mirrored back into it) there is nowhere to go, so it stays a plain,
 * visible row. A member's failed turn is not a step at all: it is the row a
 * 1:1 chat shows for the same failure, sign-in card and all, for the engine
 * that member ran on. */
import { t } from "@/lib/i18n";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import type { Message } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { FailedTurnRow, PreSendRefusalLine } from "../ChatView.tsx-parts/ErrorRows";
import { InputRequestCard } from "../InputRequestCard";
import { StepRow } from "../StepRow";
import { ThreadChip } from "../ThreadChip";
import { SendReceiptRow } from "../SendReceiptRow";
import { ToolActivity, botNames } from "../ToolActivity";
import { stepLabel } from "@/lib/step-label";
import { botEngine, failedTurnCause, isEngineLimitFailure, isPreSendRefusal } from "@/lib/failed-turn";
import { commIsBotDm } from "@/lib/bot-exchange";

export function RoomToolChip({ message, roomId, live = false }: { message: Message; roomId?: string; live?: boolean }) {
  "use memo";
  const dispatch = useStoreDispatch();
  const storeBots = useStoreSelector((current) => current.bots);
  const instances = useStoreSelector((current) => current.instances);
  const storeGroups = useStoreSelector((current) => current.groups);
  const tool = message.tool;
  if (!tool) return null;
  if (message.inputRequest) return <InputRequestCard message={message} />;
  if (message.sendReceipt) return <SendReceiptRow message={message} />;
  if (message.threadRef) return <ThreadChip message={message} />;
  if (failedTurnCause(tool.name) !== null) {
    // #2013: refused before any prompt went out: a quiet line, not a red card
    if (isPreSendRefusal(tool) && !isEngineLimitFailure(tool)) return <PreSendRefusalLine tool={tool} />;
    const roomThreadId = roomId ? storeGroups.find((group) => group.id === roomId)?.threadId : undefined;
    return <FailedTurnRow tool={tool} engine={botEngine(storeBots.find((b) => b.id === message.from?.botId), instances)} botId={message.from?.botId} threadId={roomThreadId} />;
  }
  const comm = message.comm;
  const nameOf = botNames(storeBots);
  if (!comm) return <ToolActivity tool={tool} nameOf={nameOf} live={live} />;
  const withBot = storeBots.find((b) => b.id === comm.withBotId);
  const avatar = <BotAvatar bot={withBot ?? { name: comm.withName, color: comm.withColor }} state="happy" size={14} animated={false} />;
  // A bot-to-bot DM is read in this column. Selecting it would leave the
  // room, and a chip about this very room has nowhere to go.
  const goes = comm.groupId !== roomId && !commIsBotDm(comm, storeGroups ?? []);
  return (
    <div className="flex justify-start">
      <StepRow
        label={stepLabel(tool, nameOf)}
        phase={tool.ok === false ? "failed" : "done"}
        icon={avatar}
        title={goes ? t("room.openBot", { name: comm.withName }) : undefined}
        onActivate={goes ? () => {
          dispatch({ type: "select", id: comm.groupId });
          const destination = storeGroups.find(g => g.id === comm.groupId);
          if (comm.threadId && destination?.tasks?.some(task => task.threadId === comm.threadId)) {
            dispatch({ type: "switchGroupTask", groupId: comm.groupId, threadId: comm.threadId });
          }
        } : undefined}
      />
    </div>
  );
}
