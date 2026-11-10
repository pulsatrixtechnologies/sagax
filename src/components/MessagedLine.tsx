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
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { mausInk, type MausColor } from "@/lib/mascot";
import { conjunctionParts, MESSAGED_LINE_SHOWN, messagedLineNames, type MessagedLineItem, type MessagedRecipient } from "@/lib/messaged-line";
import { QUIET_LINE, QUIET_LINE_ROW, QuietLineParty } from "./ConversationLink";

const TeammateExchangeSheet = lazy(() => import("./TeammateExchangeSheet"));

const MORE_BUTTON = "-mx-1 shrink-0 rounded-full px-1 font-medium text-ink hover:bg-raised";

function inkColor(color: string | undefined): MausColor {
  return color && mausInk(color) ? (color as MausColor) : "blue";
}

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
  const [expanded, setExpanded] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { shown, others } = messagedLineNames(line.recipients, expanded);
  const othersLabel = others > 0 ? t(others === 1 ? "chat.messagedOthers.one" : "chat.messagedOthers.other", { count: others }) : null;
  const parts = conjunctionParts(shown.length + (othersLabel ? 1 : 0), activeLocale());
  // opened: the whole list, then the control that folds it back
  const foldable = expanded && line.recipients.length > MESSAGED_LINE_SHOWN;
  const open = openKey ? line.recipients.find((recipient) => recipient.key === openKey) : undefined;
  const openThread = open ? exchangeThread(open, groups) : undefined;
  const openBot = open ? bots.find((bot) => bot.id === open.comm.withBotId) : undefined;
  const name = (recipient: MessagedRecipient) => {
    const bot = bots.find((candidate) => candidate.id === recipient.comm.withBotId);
    const color = inkColor(bot?.color ?? recipient.comm.withColor);
    const face = bot ?? { name: recipient.comm.withName, color };
    const party = (
      <QuietLineParty bot={face} agentId={recipient.comm.withBotId} name={recipient.comm.withName} color={color} tone="neutral" nameClassName="min-w-0 max-w-[16rem] truncate" />
    );
    const thread = exchangeThread(recipient, groups);
    // No thread to read: the name is still said, it opens nothing.
    if (!thread) {
      return (
        <span key={recipient.key} data-testid="messaged-line-recipient" title={recipient.comm.withName} className="flex min-w-0 items-center gap-1.5">
          {party}
        </span>
      );
    }
    return (
      <button
        key={recipient.key}
        type="button"
        data-testid="messaged-line-recipient"
        title={recipient.comm.withName}
        aria-label={t("sendReceipt.open", { name: recipient.comm.withName })}
        onClick={() => setOpenKey(recipient.key)}
        className="-mx-1 flex min-w-0 items-center gap-1.5 rounded-full px-1 hover:bg-raised"
      >
        {party}
      </button>
    );
  };
  return (
    <div className={QUIET_LINE_ROW} data-testid="messaged-line" data-mid={line.messages[0]?.id}>
      <div className={cn(QUIET_LINE, "min-w-0 max-w-full", expanded ? "flex-wrap justify-center" : "overflow-hidden whitespace-nowrap")}>
        <span className="shrink-0">{t("chat.messaged")}</span>
        {parts.map((part, index) => {
          if (part.type === "literal") {
            // the row's gap stands for the spaces; a comma hugs the name before it
            const words = part.value.trim();
            return <span key={`l${index}`} className={cn("shrink-0", words.startsWith(",") && "-ml-1.5")}>{words}</span>;
          }
          const recipient = shown[part.index];
          if (recipient) return name(recipient);
          return (
            <button
              key="others"
              type="button"
              data-testid="messaged-line-more"
              aria-expanded={false}
              title={line.recipients.slice(shown.length).map((entry) => entry.comm.withName).join(", ")}
              onClick={() => setExpanded(true)}
              className={MORE_BUTTON}
            >
              {othersLabel}
            </button>
          );
        })}
        {foldable && (
          <button
            type="button"
            data-testid="messaged-line-more"
            aria-expanded={true}
            onClick={() => setExpanded(false)}
            className={MORE_BUTTON}
          >
            {t("chat.showLess")}
          </button>
        )}
      </div>
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
    </div>
  );
});
