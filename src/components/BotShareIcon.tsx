// The mark after a bot's name in the sidebar (#2615), as Grok Bot draws a
// shared bot: two people, "Shared with others" on hover. A bot that only
// talks with someone inside a group ("Partially shared") wears the same two
// people with the second one dotted. Lucide's Users paths, so both read as
// the icon family the rest of the sidebar uses.
import { t } from "@/lib/i18n";
import type { BotShareState } from "@/lib/bot-share-state";
import { cn } from "@/lib/cn";

/** Hover text and accessible name: "Shared with others", or "Partially
 * shared" over the group it lives in (its name, else how many). */
export function botShareLabel(state: BotShareState): string {
  if (state.kind === "shared") return t("sidebar.bot.shared");
  const where = state.count === 1 && state.names[0]
    ? t("sidebar.bot.partiallySharedIn", { name: state.names[0] })
    : t("sidebar.bot.partiallySharedMany", { count: state.count });
  return `${t("sidebar.bot.partiallyShared")}\n${where}`;
}

export function BotShareIcon({ state, size = 14, className }: { state: BotShareState; size?: number; className?: string }) {
  const label = botShareLabel(state);
  const partial = state.kind === "partial";
  return (
    <span data-bot-share={state.kind} role="img" aria-label={label.replace("\n", ", ")} title={label}
      className={cn("inline-flex shrink-0 items-center text-sidebar-ink-secondary", className)}>
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <g strokeDasharray={partial ? "1 3.2" : undefined}>
          <path d="M16 3.128a4 4 0 0 1 0 7.744" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        </g>
      </svg>
    </span>
  );
}
