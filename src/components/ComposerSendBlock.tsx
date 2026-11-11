import { CircleAlert, Loader2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { sendBlockActionLabel, sendBlockText, type SendBlock } from "@/lib/send-state";

import { ComposerNoticeBand } from "./WorkplaceNotice";

/** The one line above the composer while the bot cannot answer this person
 * (src/lib/send-state.ts): the reason and the one thing to do. #2013: the
 * engine refusing a turn before any prompt went out says it here too, never
 * as a red card in the chat, with the engine's own words under Details.
 * #3552: a usage limit is never one of its reasons; the conversation's one
 * line and the model picker's dot say it. */
export function ComposerSendBlock({ block, onConnect, onRetry, onResend, onFix }: {
  block: SendBlock;
  onConnect: () => void;
  onRetry: () => void;
  /** engine_refused: send the conversation's last message again. */
  onResend?: () => void;
  /** engine_refused with a Fix: Sagax repairs the cause, then sends again. */
  onFix?: () => Promise<void>;
}) {
  const [fixing, setFixing] = useState(false);
  const [fixFailed, setFixFailed] = useState(false);
  useEffect(() => { setFixFailed(false); }, [block.reason, block.refusal?.cause]);
  const fix = onFix && block.action.kind === "fix" ? () => {
    setFixing(true);
    setFixFailed(false);
    void onFix().catch(() => setFixFailed(true)).finally(() => setFixing(false));
  } : undefined;
  const action = block.action.kind === "connect" ? onConnect
    : block.action.kind === "fix" ? fix
      : block.action.kind === "resend" ? onResend
        : onRetry;
  const Icon = block.action.kind === "fix" ? Wrench : CircleAlert;
  const cause = block.refusal?.cause?.trim();
  // On the composer's opaque ground, in the dock's flow (JC 2026-11-06: it was
  // transparent over the transcript and the messages read through it). The
  // transcript's bottom padding follows the dock, so the thread ends above it.
  return (
    <ComposerNoticeBand>
    <div data-composer-send-block={block.reason} data-composer-send-block-advisory={block.advisory ? "" : undefined} role="status" className="flex items-start gap-2 rounded-lg border border-hairline/40 bg-raised px-3 py-1.5 text-[12px] text-ink-secondary">
      <Icon size={14} aria-hidden className="mt-px shrink-0" />
      <div className="min-w-0 flex-1 break-words">
        <span>{fixFailed ? t("sendBlock.fixFailed") : sendBlockText(block)}</span>
        {cause && (
          <details className="mt-0.5 text-[11.5px]">
            <summary className="cursor-pointer select-none">{t("chat.error.details")}</summary>
            <p dir="auto" className="mt-0.5 break-words">{cause}</p>
          </details>
        )}
      </div>
      {action && <button
        type="button"
        data-composer-send-block-action={block.action.kind}
        disabled={fixing}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 font-medium text-ink hover:bg-hover disabled:opacity-60"
        onClick={action}
      >
        {fixing && <Loader2 size={12} aria-hidden className="animate-spin" />}
        {sendBlockActionLabel(block)}
      </button>}
    </div>
    </ComposerNoticeBand>
  );
}
