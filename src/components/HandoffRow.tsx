// A bot-to-bot hand-off in the unified chat (threads off, 2026-11-09): the
// "Sent to <teammate>" receipt reads "● Asked <teammate>(brief) ⎿", the
// brief folded under it, and the teammate's verdict (PASS / FAIL and its
// reply, folded) joins the same row when the result comes back, live. A
// result whose receipt is not in this page shows as its own row. Never a
// thread link: everything stays in this chat (#2901). The teammate's chat
// gets the same row for an ask it received, with the asker's face.
import { memo } from "react";
import type { Message } from "@/state/store";
import { useStoreSelector } from "@/state/store-selector";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { LocaleKey } from "@/locales";
import {
  briefLine,
  handoffPhase,
  handoffReceiptIn,
  handoffRequestId,
  handoffResultId,
  handoffResultIn,
  handoffVerdict,
  type HandoffVerdict,
} from "@/lib/handoff-row";
import { StepRow } from "./StepRow";
import { BotAvatar } from "./Avatar";
import { useChatRows } from "./ChatView.tsx-parts/types";
import type { MausColor } from "@/lib/mascot";

const KEY = "text-[11px] text-ink-tertiary";
const BLOCK = "max-h-52 overflow-auto rounded-md bg-inset px-2 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap break-words text-ink";

function VerdictTag({ verdict }: { verdict: HandoffVerdict }) {
  return (
    <span
      data-testid="handoff-verdict"
      data-verdict={verdict}
      className={cn("shrink-0 text-[11px] font-semibold", verdict === "PASS" ? "text-success" : "text-danger")}
    >
      · {verdict}
    </span>
  );
}

/** What the teammate sent back: its reply, or why there is none. */
function resultText(result: Message): string {
  return result.tool?.output?.trim() || result.tool?.name || "";
}

export const HandoffRow = memo(function HandoffRow({ message }: { message: Message }) {
  "use memo";
  const { bots, botId } = useChatRows();
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
  // the result is drawn in its receipt's row
  if (answersId && joined) return null;
  // The teammate's own chat (an ask it received): the row names and shows
  // who asked.
  const incoming = ref.botId === botId && !answersId;
  const face = incoming ? message.from?.botId : ref.botId;
  const teammate = bots.find((bot) => bot.id === face);
  const name = teammate?.name ?? message.from?.name ?? ref.title;
  const icon = (
    <BotAvatar
      bot={teammate ?? { name, color: (message.from?.color ?? "blue") as MausColor }}
      state="happy"
      size={14}
      animated={false}
    />
  );

  if (answersId) {
    // a result on its own: its label already says who and how it went
    const reply = resultText(message);
    const verdict = message.tool?.ok === false ? undefined : handoffVerdict(tool.output);
    return (
      <div className="flex justify-start">
        <StepRow
          testId="handoff-row"
          data={{ "data-handoff": answersId, "data-handoff-side": "result" }}
          label={tool.name}
          phase={tool.ok === false ? "failed" : "done"}
          icon={icon}
          extra={verdict ? <VerdictTag verdict={verdict} /> : undefined}
        >
          {reply && reply !== tool.name ? (
            <div className="py-1" data-testid="handoff-result">
              <div className={cn(KEY, "mb-0.5")}>{t("step.detail.result")}</div>
              <div className={BLOCK}>{reply}</div>
            </div>
          ) : undefined}
        </StepRow>
      </div>
    );
  }

  const brief = tool.input?.trim();
  const reason = tool.output?.trim();
  const phase = handoffPhase(message, result);
  const verdict = result && result.tool?.ok !== false ? handoffVerdict(result.tool?.output) : undefined;
  const reply = result ? resultText(result) : "";
  return (
    <div className="flex justify-start">
      <StepRow
        testId="handoff-row"
        data={{ "data-handoff": requestId ?? ref.threadId, "data-handoff-side": incoming ? "incoming" : "request", "data-handoff-phase": phase }}
        label={incoming ? t("approval.askedByBot", { name }) : t(`step.ask.${phase}` as LocaleKey, { names: name })}
        // short, so the teammate's name never truncates: the whole brief is folded below
        target={briefLine(brief ?? reason, 56)}
        title={brief ?? reason}
        phase={phase}
        icon={icon}
        extra={verdict ? <VerdictTag verdict={verdict} /> : undefined}
      >
        {() => (
          <div className="space-y-2 py-1 text-[12px] text-ink-secondary" data-testid="handoff-detail">
            {brief && (
              <div data-testid="handoff-brief">
                <div className={cn(KEY, "mb-0.5")}>{t("toolDetail.input")}</div>
                <div className={BLOCK}>{brief}</div>
              </div>
            )}
            {reason && reason !== brief && <p className="text-[12px] text-ink">{reason}</p>}
            {result && (
              <div data-testid="handoff-result">
                <div className={cn(KEY, "mb-0.5")}>
                  {t("step.detail.result")}
                  {result.tool?.ok === false ? <span className="text-danger"> · {result.tool.name}</span> : null}
                </div>
                {reply && reply !== result.tool?.name && <div className={BLOCK}>{reply}</div>}
              </div>
            )}
          </div>
        )}
      </StepRow>
    </div>
  );
});
