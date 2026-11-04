// A passing banner over the chat for a notice that is never a row
// (shared/transient-notices.ts): a routine run that failed, a routine's
// access card. It leaves on its own after a few seconds, when the person
// closes it, or (access) once the routine has run again; it never comes back.
// 2026-10-26: the failure that paused its routine also leaves (or never
// shows) once that routine is back on (`settled`).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { t } from "@/lib/i18n";
import { pickTransientNotice, readShownNotices, rememberShownNotices, transientNoticeSettled } from "@/lib/transient-notice";
import { isFailedRoutineRunNotice, TRANSIENT_NOTICE_RULES } from "../../shared/transient-notices";
import type { Message } from "@/state/store";

export function TransientNotice({ messages, render, settled }: {
  messages: readonly Message[];
  /** Settled outside the messages (an auto-paused routine back on). */
  settled?: (message: Message) => boolean;
  /** The notice's own content: the routine run line, the access card. */
  render: (message: Message, close: () => void) => ReactNode;
}) {
  const shown = useRef<Set<string> | null>(null);
  const [active, setActive] = useState<Message[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const remembered = shown.current ??= readShownNotices();
    const remaining = active.filter((message) => !transientNoticeSettled(message, messages) && !settled?.(message));
    if (remaining.length !== active.length) {
      setActive(remaining);
      return;
    }
    // While one failure is visible, later failures join that same banner.
    // Access cards keep their own content and settlement rules.
    if (active.length && !active.every(isFailedRoutineRunNotice)) return;
    const now = Date.now();
    let next: Message | null = active[0] ?? pickTransientNotice(messages, now, remembered);
    while (next && settled?.(next)) {
      rememberShownNotices(remembered, [next.id]);
      next = pickTransientNotice(messages, now, remembered);
    }
    if (!next) return;
    const incoming = isFailedRoutineRunNotice(next)
      ? messages.filter((message) => isFailedRoutineRunNotice(message) && !remembered.has(message.id) && now - message.at <= TRANSIENT_NOTICE_RULES.freshMs)
      : [next];
    if (!incoming.length) return;
    rememberShownNotices(remembered, incoming.map((message) => message.id));
    const visible = incoming.filter((message) => !settled?.(message));
    if (visible.length) setActive([...active, ...visible]);
  }, [messages, active, settled]);

  const firstId = active[0]?.id;
  useEffect(() => {
    if (!firstId) { setExpanded(false); return; }
    const timer = setTimeout(() => setActive([]), TRANSIENT_NOTICE_RULES.visibleMs);
    return () => clearTimeout(timer);
  }, [firstId]);

  if (!active.length) return null;
  const close = () => setActive([]);
  const content = (message: Message) => render(message, () => setActive((current) => current.filter((item) => item.id !== message.id)));

  return (
    <div className="w-full px-5" data-transient-notice={firstId}>
      <div role="status" className="mb-2 flex items-start gap-2 rounded-lg border border-hairline/40 bg-panel px-3 py-2 text-[13px] text-ink-secondary">
        <div className="min-w-0 flex-1">
          {active.length === 1 ? content(active[0]!) : (
            <details data-grouped-run-failures open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
              <summary className="cursor-pointer font-medium text-danger">{t("routines.failures.grouped", { count: active.length })}</summary>
              {expanded && <div className="mt-2 space-y-2">{active.map((message) => <div key={message.id}>{content(message)}</div>)}</div>}
            </details>
          )}
        </div>
        <button type="button" onClick={close} aria-label={t("common.close")} className="shrink-0 rounded p-0.5 hover:text-ink">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
