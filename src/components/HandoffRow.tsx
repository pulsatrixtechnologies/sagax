// A bot-to-bot hand-off in the unified chat (threads off): the quiet
// centered line every bot-to-bot trace uses (#3289, BotNamesLine), never a
// left-aligned step row. The sender's chat reads "Asking [face] Olive" while
// the teammate works and "Asked [face] Olive" once its answer is in (a run of
// receipts folds into one line, lib/ask-line); the teammate's chat reads
// "[face] Wren asked “first words”"; an answer whose receipt is not on this
// page reads "[face] Olive answered". A request stopped before an answer, or
// one that could not be sent, stays said on the line. A name opens the
// exchange (the brief, the answer) as the bot-to-bot sheet over this column:
// never a thread link, everything stays in this chat (#2901).
import { lazy, memo, Suspense, useState } from "react";
import type { Message } from "@/state/store";
import { useStoreSelector } from "@/state/store-selector";
import { t } from "@/lib/i18n";
import { handoffReceiptIn, handoffRequestId, handoffResultId, handoffResultIn } from "@/lib/handoff-row";
import { askEntry } from "@/lib/ask-line";
import { AskLine } from "./AskLine";
import { ActorLine } from "./BotNamesLine";
import { useChatRows } from "./ChatView.tsx-parts/types";

const TeammateExchangeSheet = lazy(() => import("./TeammateExchangeSheet"));

export const HandoffRow = memo(function HandoffRow({ message }: { message: Message }) {
  "use memo";
  const { bots, botId } = useChatRows();
  const [open, setOpen] = useState(false);
  const requestId = handoffRequestId(message);
  const answersId = handoffResultId(message);
  // The open conversation's transcript: the result that answers this
  // receipt, or (for a result) whether its receipt is drawn above.
  const result = useStoreSelector((state) => {
    if (!requestId) return undefined;
    const owner = state.bots.find((bot) => bot.id === botId) ?? state.groups.find((group) => group.id === botId);
    return handoffResultIn(owner?.messages ?? [], requestId);
  });
  const joined = useStoreSelector((state) => {
    if (!answersId) return false;
    const owner = state.bots.find((bot) => bot.id === botId) ?? state.groups.find((group) => group.id === botId);
    return handoffReceiptIn(owner?.messages ?? [], answersId);
  });
  const ref = message.threadRef;
  const tool = message.tool;
  if (!ref || !tool) return null;
  // the result is drawn in its receipt's line
  if (answersId && joined) return null;
  const self = bots.find((bot) => bot.id === botId);
  // The teammate's own chat (an ask it received): the line names who asked.
  const incoming = ref.botId === botId && !answersId;
  if (!incoming && !answersId) {
    const entry = askEntry(message, result ? [result] : [], bots);
    return (
      <AskLine
        asks={[entry]}
        self={self}
        bots={bots}
        mid={message.id}
        data={{ "data-handoff": requestId ?? ref.threadId, "data-handoff-side": "request", "data-handoff-phase": entry.state }}
      />
    );
  }
  const actorId = incoming ? message.from?.botId : ref.botId;
  const actor = bots.find((bot) => bot.id === actorId);
  const name = actor?.name ?? message.from?.name ?? ref.title;
  const color = actor?.color ?? message.from?.color;
  const failed = answersId ? tool.ok === false : result?.tool?.ok === false;
  // the asker wrote the user-role lines of the exchange, the teammate answered
  const asker = incoming ? actor ?? { id: actorId ?? "", name, color: color ?? "blue" } : self;
  const teammate = incoming ? self : actor;
  return (
    <ActorLine
      testId="handoff-line"
      party={{ key: actorId ?? name, botId: actorId, name, color, onOpen: () => setOpen(true) }}
      verb={t(incoming ? "chat.askLine.incoming" : "chat.askLine.answered")}
      words={incoming ? tool.input : tool.ok === false ? undefined : tool.output}
      bots={bots}
      tail={failed ? t("chat.askLine.trace.stopped") : undefined}
      tailTone="danger"
      mid={message.id}
      data={{ "data-handoff": (answersId ?? requestId ?? ref.threadId), "data-handoff-side": incoming ? "incoming" : "result" }}
    >
      {open && (
        <Suspense fallback={null}>
          <TeammateExchangeSheet
            owner={asker ? { id: asker.id, name: asker.name, color: asker.color as never } : undefined}
            teammate={{ id: ref.botId, name: teammate?.name ?? ref.title, color: teammate?.color }}
            threadId={ref.threadId}
            task={incoming ? tool.input : undefined}
            bots={bots.filter((bot) => bot.id === ref.botId || bot.id === asker?.id)}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </ActorLine>
  );
});
