// Complete capabilities in This bot, Me and Organization. The parent
// offers Organization only to its administrator or local owner.
import type { ReactNode } from "react";
import { Bot, User, Users } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { PluginScope } from "@/lib/plugin-scope";

/** The segmented control of Capabilities (scope, Tailscale's modes): a
 * rounded track, the chosen segment filled with the accent. */
export const SEGMENT_GROUP = "flex w-fit max-w-full items-center gap-0.5 rounded-full border border-border p-0.5";

export function segmentOptionClass(active: boolean, disabled = false): string {
  return cn(
    "flex h-7 min-w-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none disabled:cursor-default",
    active
      ? disabled ? "bg-ink/10 text-ink-secondary" : "bg-accent text-accent-ink"
      : disabled ? "text-ink-tertiary" : "text-ink-secondary hover:bg-hover hover:text-ink",
  );
}

/** Manage's quiet scope (#2104, Grok Bot's look): gray pills side by side,
 * the chosen one a shade lighter, no accent. */
export const QUIET_SEGMENT_GROUP = "flex w-fit max-w-full items-center gap-1";

export function quietSegmentClass(active: boolean, disabled = false): string {
  return cn(
    "flex h-7 min-w-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong motion-reduce:transition-none disabled:cursor-default",
    active ? "bg-ink/[0.12] text-ink" : disabled ? "text-ink-tertiary" : "bg-ink/[0.05] text-ink-secondary hover:bg-ink/10 hover:text-ink",
  );
}

export function ScopeToggle({ scope, botName, onScope, disabled = false, describedBy, organization = true, quiet = false, title }: {
  /** Manage's title row: gray pills, no accent */
  quiet?: boolean;
  /** what the chosen scope means, on hover */
  title?: string;
  scope: PluginScope;
  botName?: string;
  organization?: boolean;
  onScope: (scope: PluginScope) => void;
  /** shown but not in use on this tab (Providers) */
  disabled?: boolean;
  /** the id of the line that says why it is off */
  describedBy?: string;
}) {
  const option = (value: PluginScope, label: string, icon: ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={scope === value}
      disabled={disabled}
      data-plugins-scope-option={value}
      onClick={() => onScope(value)}
      className={quiet ? quietSegmentClass(scope === value, disabled) : segmentOptionClass(scope === value, disabled)}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <div
      role="radiogroup"
      aria-label={t("connectApps.scope.aria")}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      data-plugins-scope={scope}
      data-plugins-scope-disabled={disabled ? "" : undefined}
      className={quiet ? QUIET_SEGMENT_GROUP : SEGMENT_GROUP}
      title={title}
    >
      {botName && option("bot", t("connectApps.scope.bot", { name: botName }), <Bot size={13} aria-hidden="true" className={quiet ? "hidden" : undefined} />)}
      {option("me", t("connectApps.scope.me"), <User size={13} aria-hidden="true" className={quiet ? "hidden" : undefined} />)}
      {organization && option("workspace", t("connectApps.scope.workspace"), <Users size={13} aria-hidden="true" className={quiet ? "hidden" : undefined} />)}
    </div>
  );
}
