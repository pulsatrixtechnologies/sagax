// One card in the Approvals list: the bot with its mascot, what it asks,
// a type pill, how long it has waited (green under an hour, amber under a
// day, red beyond) and one line of what it would do. Never an id.
import { Check, KeyRound, Lock } from "lucide-react";
import { memo } from "react";

import { inboxAge, inboxAgeTone, inboxRisky, type InboxApproval } from "../../../shared/approvals-inbox";
import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { inboxPreview, inboxTitle, withoutIds } from "@/lib/approvals-inbox";
import type { Bot } from "@/state/store";

const AGE_STYLE = {
  fresh: "bg-success/12 text-success",
  aging: "bg-warning/14 text-warning",
  stale: "bg-danger/12 text-danger",
} as const;

export function ageLabel(at: number, now: number): string {
  const age = inboxAge(at, now);
  if (age.unit === "now") return t("approvals.age.now");
  return t(`approvals.age.${age.unit}`, { n: age.n });
}

export function AgePill({ at, now }: { at: number; now: number }) {
  const tone = inboxAgeTone(at, now);
  return (
    <span data-age={tone} className={cn("shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums", AGE_STYLE[tone])}>
      {ageLabel(at, now)}
    </span>
  );
}

export function KindPill({ entry }: { entry: Pick<InboxApproval, "kind" | "risk" | "needsKey" | "waitingOn"> }) {
  const risky = inboxRisky(entry);
  return (
    <span
      data-kind={entry.kind}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10.5px] font-medium",
        entry.kind === "question"
          ? "border-accent/35 text-accent-text"
          : risky ? "border-danger/35 text-danger" : "border-hairline/60 text-ink-secondary",
      )}
    >
      {entry.needsKey && <KeyRound size={10} aria-hidden="true" />}
      {t(`approvals.kind.${entry.kind}`)}
    </span>
  );
}

/** The bot's own mascot when this screen knows the bot, else its initial. */
export function InboxAvatar({ bot, name, size }: { bot?: Bot; name: string; size: number }) {
  if (bot) return <BotAvatar bot={bot} size={size} animated={false} />;
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-control text-[12px] font-semibold text-ink-secondary"
    >
      {name.trim().charAt(0).toLocaleUpperCase() || "?"}
    </span>
  );
}

export const ApprovalRow = memo(function ApprovalRow({
  entry,
  bot,
  now,
  selected,
  checked,
  leaving,
  entering,
  onSelect,
  onCheck,
}: {
  entry: InboxApproval;
  bot?: Bot;
  now: number;
  selected: boolean;
  checked: boolean;
  /** answered: slides out, then the list drops it */
  leaving?: boolean;
  /** just arrived: slides in */
  entering?: boolean;
  onSelect: (key: string) => void;
  onCheck: (key: string) => void;
}) {
  const title = inboxTitle(entry);
  const preview = inboxPreview(entry);
  // ticked only when a bulk answer may cover it (a Deny covers a needs-key card)
  const bulkable = entry.decidable && (entry.bulk === true || entry.bulk === "needs-key");
  const where = withoutIds(entry.roomName ?? entry.threadTitle ?? "");
  return (
    <div
      role="option"
      aria-selected={selected}
      data-approval-row={entry.kind}
      data-selected={selected ? "" : undefined}
      onClick={() => onSelect(entry.key)}
      className={cn(
        "group relative flex cursor-default items-start gap-2.5 border-b border-hairline/30 px-3 py-2.5 transition-colors",
        selected ? "bg-accent/10" : "hover:bg-control/60",
        leaving && "approval-row-leave",
        entering && !leaving && "approval-row-enter",
      )}
    >
      {selected && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] rounded-r bg-accent" />}
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={t("approvals.select", { title })}
        disabled={!bulkable}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          onCheck(entry.key);
        }}
        className={cn(
          "mt-2 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
          checked ? "border-accent bg-accent text-accent-ink" : "border-hairline bg-transparent group-hover:border-ink-tertiary",
          !bulkable && "invisible",
        )}
      >
        {checked && <Check size={11} strokeWidth={3} aria-hidden="true" />}
      </button>
      <InboxAvatar bot={bot} name={entry.botName} size={30} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">{entry.botName}</span>
          {entry.confidential && <Lock size={11} aria-label={t("approvals.confidential")} className="shrink-0 text-ink-secondary" />}
          {where && <span className="min-w-0 truncate text-[11.5px] text-ink-tertiary">· {where}</span>}
          <span className="ml-auto" />
          <AgePill at={entry.at} now={now} />
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[13.5px] leading-5 text-ink">{title}</span>
          <KindPill entry={entry} />
        </div>
        {(preview || !entry.decidable) && (
          <div className="mt-0.5 truncate font-mono text-[11.5px] leading-4 text-ink-secondary">
            {!entry.decidable
              ? <span className="font-sans">{entry.waitingOn === "admin" ? t("approvals.waitingAdmin") : t("approvals.waitingOn", { name: entry.waitingOnName ?? entry.ownerName ?? t("approval.someone") })}</span>
              : preview}
          </div>
        )}
      </div>
    </div>
  );
});
