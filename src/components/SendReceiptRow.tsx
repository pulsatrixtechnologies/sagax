// A send_to_bot receipt in the sender's chat (#3246): « Sent to <Bot> »
// with the state of the recipient's thread (queued, read, waiting on the
// person, done, failed) and, once settled, a short summary of the reply.
// Clicking it opens the read-only bot-to-bot sheet (TeammateExchangeSheet,
// #3247) over this chat: never a separate thread panel (unified chat).
import { lazy, memo, Suspense, useState } from "react";
import type { Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { LocaleKey } from "@/locales";
import type { StepPhase } from "@/lib/step-label";
import { briefLine } from "@/lib/handoff-row";
import { isSettledSend, type SendState } from "../../shared/send-receipt";
import { StepRow } from "./StepRow";
import { BotAvatar } from "./Avatar";
import { useStoreSelector, shallowEqual } from "@/state/store-selector";
import type { MausColor } from "@/lib/mascot";

const TeammateExchangeSheet = lazy(() => import("./TeammateExchangeSheet"));

function phaseOf(state: SendState): StepPhase {
  if (state === "failed") return "failed";
  return isSettledSend(state) ? "done" : "running";
}

export const SendReceiptRow = memo(function SendReceiptRow({ message }: { message: Message }) {
  "use memo";
  const [open, setOpen] = useState(false);
  const receipt = message.sendReceipt;
  // Sender and recipient by id: a room's receipt names its sender (from),
  // a 1:1 chat's is the open bot's (the recipient thread's opener).
  const [teammate, sender] = useStoreSelector((state) => [
    state.bots.find((bot) => bot.id === receipt?.botId),
    state.bots.find((bot) => bot.id === (message.from?.botId ?? receipt?.senderId)),
  ] as const, shallowEqual);
  if (!receipt) return null;
  const name = teammate?.name ?? message.threadRef?.title ?? receipt.botId;
  const gone = message.threadRef?.gone === true;
  const brief = message.tool?.input?.trim();
  const detail = receipt.summary ?? brief;
  const state = t(`sendReceipt.state.${receipt.state}` as LocaleKey);
  return (
    <div className="flex justify-start">
      <StepRow
        testId="send-receipt"
        data={{ "data-send-receipt": receipt.id, "data-send-state": receipt.state }}
        label={t("sendReceipt.sentTo", { name })}
        target={detail ? briefLine(detail, 56) : undefined}
        title={detail}
        phase={phaseOf(receipt.state)}
        icon={<BotAvatar bot={teammate ?? { name, color: "blue" as MausColor }} state="happy" size={14} animated={false} />}
        extra={
          <span
            data-testid="send-receipt-state"
            className={cn("shrink-0 text-[11px]", receipt.state === "failed" ? "text-danger" : "text-ink-tertiary")}
          >
            · {state}
          </span>
        }
        ariaLabel={gone ? undefined : t("sendReceipt.open", { name })}
        onActivate={gone ? undefined : () => setOpen(true)}
      />
      {open && (
        <Suspense fallback={null}>
          <TeammateExchangeSheet
            owner={sender ? { id: sender.id, name: sender.name, color: sender.color } : undefined}
            teammate={{ id: receipt.botId, name, color: teammate?.color }}
            threadId={receipt.threadId}
            task={brief ? briefLine(brief, 120) : undefined}
            bots={[sender, teammate].filter((bot): bot is NonNullable<typeof bot> => Boolean(bot))}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
});
