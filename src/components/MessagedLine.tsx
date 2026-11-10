// A turn that wrote to other bots, as one centered quiet line (#3270):
// "Messaged [face] Osprey and [face] test". The same row, faces and names
// as the collapsed bot exchange's line (ConversationLink), with no bubble,
// no chevron and no "@". More than three recipients: the first three, then
// "and N others", which shows the whole list and then folds it back. The
// line is neutral: names in the app's ink, only the faces carry color
// (#3275). A name opens the exchange in a sheet over this column, never
// another conversation (unified chat).
import { lazy, memo, Suspense, useState } from "react";
import type { Bot, Group } from "@/state/store";
import { t } from "@/lib/i18n";
import type { MessagedLineItem, MessagedRecipient } from "@/lib/messaged-line";
import { NamesLine, type LineParty } from "./BotNamesLine";

const TeammateExchangeSheet = lazy(() => import("./TeammateExchangeSheet"));

/** The thread holding the exchange: the chip's own, else its pair channel's. */
function exchangeThread(recipient: MessagedRecipient, groups: readonly Pick<Group, "id" | "threadId">[]): string | undefined {
  return recipient.comm.threadId ?? groups.find((group) => group.id === recipient.comm.groupId)?.threadId;
}

export const MessagedLine = memo(function MessagedLine({ line, self, bots, groups }: {
  line: MessagedLineItem;
  /** The bot that wrote: it opens each exchange's sheet. */
  self?: Pick<Bot, "id" | "name" | "color">;
  bots: readonly Bot[];
  groups: readonly Pick<Group, "id" | "threadId">[];
}) {
  "use memo";
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = openKey ? line.recipients.find((recipient) => recipient.key === openKey) : undefined;
  const openThread = open ? exchangeThread(open, groups) : undefined;
  const openBot = open ? bots.find((bot) => bot.id === open.comm.withBotId) : undefined;
  // No thread to read: the name is still said, it opens nothing.
  const parties: LineParty[] = line.recipients.map((recipient) => ({
    key: recipient.key,
    botId: recipient.comm.withBotId,
    name: recipient.comm.withName,
    color: recipient.comm.withColor,
    ...(exchangeThread(recipient, groups) ? { onOpen: () => setOpenKey(recipient.key) } : {}),
  }));
  return (
    <NamesLine testId="messaged-line" verb={t("chat.messaged")} parties={parties} bots={bots} mid={line.messages[0]?.id}>
      {open && openThread && (
        <Suspense fallback={null}>
          <TeammateExchangeSheet
            owner={self}
            teammate={{ id: open.comm.withBotId, name: open.comm.withName, color: openBot?.color ?? open.comm.withColor }}
            threadId={openThread}
            task={open.comm.text}
            bots={[...(self ? bots.filter((bot) => bot.id === self.id) : []), ...(openBot ? [openBot] : [])]}
            onClose={() => setOpenKey(null)}
          />
        </Suspense>
      )}
    </NamesLine>
  );
});
