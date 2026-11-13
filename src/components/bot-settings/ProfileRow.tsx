// One row of a bot profile card: the look of the profile's Channels and Bot
// accounts rows (BotProfilePage's CardRow). A line icon, the name in 14px,
// a grey line under it, the control at the right, and what the control
// unfolds under the row. For the Knowledge tab and "What it does", drawn
// under SettingsSurfaceProvider surface="plain".
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function ProfileRow({
  icon,
  label,
  state,
  action,
  children,
  wrap,
  className,
  onOpen,
  openLabel,
  muted,
  ...data
}: {
  icon?: ReactNode;
  label: ReactNode;
  /** The grey line under the name. */
  state?: ReactNode;
  /** The control at the right: a PILL, a Switch, a CountPill. */
  action?: ReactNode;
  /** What the row unfolds under it. */
  children?: ReactNode;
  /** Long text (a sentence, a path): wrapped, never cut. */
  wrap?: boolean;
  className?: string;
  /** The row opens a detail (a pushed page): the icon and the two lines are
   * one button, Enter opens it, the action stays its own control (#4148). */
  onOpen?: () => void;
  /** The open button's accessible name when the name alone is not enough. */
  openLabel?: string;
  /** An item that is off: the name in the grey weight. */
  muted?: boolean;
} & { [key: `data-${string}`]: string | undefined }) {
  const hasState = state !== undefined && state !== null && state !== false && state !== "";
  const lines = (
    <span className="flex min-w-0 flex-1 flex-col">
      <span data-profile-row-label="" className={cn("text-[14px] leading-5", muted ? "text-ink-secondary" : "text-ink", wrap ? "break-words" : "truncate")}>{label}</span>
      {hasState && <span data-profile-row-state="" className={cn("text-[12px] leading-4 text-ink-secondary", wrap ? "break-words" : "truncate")}>{state}</span>}
    </span>
  );
  return (
    <div {...data} className={cn("flex flex-col", className)}>
      <div className={cn("flex items-center gap-3 px-4", hasState || action ? "min-h-[56px] py-2.5" : "min-h-[44px] py-2", onOpen && "rounded-2xl transition-colors hover:bg-hover motion-reduce:transition-none")}>
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={openLabel}
            data-profile-row-open=""
            className="-my-2.5 flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-lg py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            {icon && <span className="flex size-5 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-5" aria-hidden="true">{icon}</span>}
            {lines}
          </button>
        ) : (
          <>
            {icon && <span className="flex size-5 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-5" aria-hidden="true">{icon}</span>}
            {lines}
          </>
        )}
        {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
      </div>
      {children && <div className="px-4 pb-3 pt-1">{children}</div>}
    </div>
  );
}

/** A sentence of a plain card, one per row (Does, Can reach, Won't). */
export function ProfileLine({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <p className={cn("flex min-h-[44px] items-center break-words px-4 py-2.5 text-[14px] leading-5", muted ? "text-ink-secondary" : "text-ink")}>{children}</p>;
}
