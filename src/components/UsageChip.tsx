// The conversation's cost in the chat header, and the last turn's own
// figures in the card the header e2e reads. Retro 98 hides the chip; the
// status bar there shows the same total.
import type { TaskUsage } from "@/state/store";
import { t } from "@/lib/i18n";
import { lastTurnDetail, usageChip, usageDetail } from "@/lib/usage";

export function UsageChip({ usage }: { usage?: TaskUsage }) {
  if (!usage) return null;
  const label = usageChip(usage);
  if (!label) return null;
  const last = lastTurnDetail(usage);
  return (
    <button
      type="button"
      data-testid="usage-chip"
      aria-label={t("chat.usage.costAria", { cost: label })}
      title={t("chat.usage.cardHint")}
      className="inline-flex h-8 items-center rounded-full px-2.5 text-[12px] leading-4 text-ink-secondary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {label}
      <span data-testid="usage-card" className="sr-only">
        {`${t("chat.usage.cardThread")} ${usageDetail(usage)}`}
        {last ? ` ${last}` : ""}
      </span>
    </button>
  );
}
