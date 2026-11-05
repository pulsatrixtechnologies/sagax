import { CircleAlert, Clock3, Loader2, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { sendBlockActionLabel, sendBlockText, type SendBlock } from "@/lib/send-state";

/** The one line above the composer while the bot cannot answer this person
 * (src/lib/send-state.ts): the reason and the one thing to do. #2013: the
 * engine refusing a turn before any prompt went out says it here too, never
 * as a red card in the chat, with the engine's own words under Details. */
export function ComposerSendBlock({ block, onConnect, onRetry, onSwitchEngine, onResend, onFix }: {
  block: SendBlock;
  onConnect: () => void;
  onRetry: () => void;
  /** engine_limit: the model window, where the bot moves to another engine or account. */
  onSwitchEngine?: () => void;
  /** engine_refused: send the conversation's last message again. */
  onResend?: () => void;
  /** engine_refused with a Fix: Sagax repairs the cause, then sends again. */
  onFix?: () => Promise<void>;
}) {
  // An engine at its limit names its reset, which passes while the line shows.
  const [now, setNow] = useState(() => Date.now());
  const [fixing, setFixing] = useState(false);
  const [fixFailed, setFixFailed] = useState(false);
  const resetsAt = block.limit?.resetsAt;
  useEffect(() => {
    if (typeof resetsAt !== "number") return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [resetsAt]);
  useEffect(() => { setFixFailed(false); }, [block.reason, block.refusal?.cause]);
  const fix = onFix && block.action.kind === "fix" ? () => {
    setFixing(true);
    setFixFailed(false);
    void onFix().catch(() => setFixFailed(true)).finally(() => setFixing(false));
  } : undefined;
  const action = block.action.kind === "connect" ? onConnect
    : block.action.kind === "switch_engine" ? onSwitchEngine
      : block.action.kind === "fix" ? fix
        : block.action.kind === "resend" ? onResend
          : onRetry;
  const Icon = block.reason === "engine_limit" ? Clock3 : block.action.kind === "fix" ? Wrench : CircleAlert;
  const cause = block.refusal?.cause?.trim();
  return (
    <div data-composer-send-block={block.reason} data-composer-send-block-advisory={block.advisory ? "" : undefined} role="status" className="mb-2 flex items-start gap-2 rounded-lg px-3 py-1.5 text-[12px] text-ink-secondary">
      <Icon size={14} aria-hidden className="mt-px shrink-0" />
      <div className="min-w-0 flex-1 break-words">
        <span>{fixFailed ? t("sendBlock.fixFailed") : sendBlockText(block, now)}</span>
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
  );
}
