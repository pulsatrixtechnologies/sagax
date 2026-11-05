import { CircleAlert, Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

import { sendBlockActionLabel, sendBlockText, type SendBlock } from "@/lib/send-state";

/** The one line above the composer while the bot cannot answer this person
 * (src/lib/send-state.ts): the reason and the one thing to do. */
export function ComposerSendBlock({ block, onConnect, onRetry, onSwitchEngine }: {
  block: SendBlock;
  onConnect: () => void;
  onRetry: () => void;
  /** engine_limit: the model window, where the bot moves to another engine or account. */
  onSwitchEngine?: () => void;
}) {
  // An engine at its limit names its reset, which passes while the line shows.
  const [now, setNow] = useState(() => Date.now());
  const resetsAt = block.limit?.resetsAt;
  useEffect(() => {
    if (typeof resetsAt !== "number") return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [resetsAt]);
  const action = block.action.kind === "connect" ? onConnect : block.action.kind === "switch_engine" ? onSwitchEngine : onRetry;
  const Icon = block.reason === "engine_limit" ? Clock3 : CircleAlert;
  return (
    <div data-composer-send-block={block.reason} role="status" className="mb-2 flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] text-ink-secondary">
      <Icon size={14} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 break-words">{sendBlockText(block, now)}</span>
      {action && <button
        type="button"
        data-composer-send-block-action={block.action.kind}
        className="shrink-0 rounded-md px-2 py-0.5 font-medium text-ink hover:bg-hover"
        onClick={action}
      >
        {sendBlockActionLabel(block)}
      </button>}
    </div>
  );
}
