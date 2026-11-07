import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { DEFAULT_RULE_SET_ID, type RuleSetWire } from "@/lib/rule-sets";
import { PILL } from "../../SettingsPrimitives";

// Settings' grey pill (2026-10-16).
export const buttonCls = PILL;
export const iconButtonCls = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-30";

/** A set's name as shown: the default set is "Rules" in the person's language. */
export function ruleSetLabel(set: Pick<RuleSetWire, "id" | "name">): string {
  return set.name ?? (set.id === DEFAULT_RULE_SET_ID ? t("persona.rules.sets.defaultName") : set.id);
}

/** A thin bar: how full a budget is (the fuller of lines and bytes), red
 * past it. */
export function Gauge({ lines, bytes, maxLines, maxBytes, label }: { lines: number; bytes: number; maxLines: number; maxBytes: number; label: string }) {
  const ratio = Math.max(maxLines > 0 ? lines / maxLines : 0, maxBytes > 0 ? bytes / maxBytes : 0);
  const percent = Math.round(ratio * 100);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 w-full overflow-hidden rounded-full bg-control"
    >
      <div
        className={cn("h-full rounded-full", ratio > 1 ? "bg-danger" : ratio > 0.85 ? "bg-warning" : "bg-accent")}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  );
}
