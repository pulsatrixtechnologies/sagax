// The Plugins window's own look (#2104, JC 2026-11-06: identical to Grok
// Bot's Connect Apps): sizes measured on the reference captures (DPR 2,
// /Users/Workspace/artifacts/sagax-plugins-2104/grokbot-ref). Tokens only, so
// the skins still recolour it. Browse Bots and the persona editor keep
// CATEGORY_MODAL.
import { cn } from "@/lib/cn";

export const PLUGINS = {
  /** the window: the reference's #1d1d1d sits on bg-inset */
  frame: "bg-inset",
  /** side gutter of every view */
  gutter: "px-4 sm:px-8",
  /** "Connect Apps", top left of the home view */
  title: "text-[18px] font-normal leading-7 tracking-[-0.005em] text-ink",
  /** "Manage plugins and skills": the big title of a view under the back row */
  bigTitle: "text-[18px] font-normal leading-7 tracking-[-0.005em] text-ink",
  /** "From Sagax", "Recommended for you" */
  sectionTitle: "text-[14.5px] font-normal leading-5 text-ink",
  sectionLink: "text-[12px] text-ink-secondary hover:text-ink",
  /** "Installed", "Accounts", "Tools": gray labels over a list or a card */
  label: "text-[12px] leading-5 text-ink-secondary",
  /** one column of rows, no cards (JC 2026-11-06: "Remove the two columns, stick to one", #2682) */
  grid: "grid grid-cols-1",
  rowName: "block truncate text-[13.5px] leading-5 text-ink",
  rowSub: "block truncate text-[12.5px] leading-5 text-ink-secondary",
  /** a card with a subtle border on the window's own background */
  card: "rounded-[14px] border-[0.5px] border-ink/[0.08] bg-ink/[0.015]",
  cardRow: "flex min-h-[52px] items-center gap-3 px-4 py-3",
  /** the round search of the home view */
  search: "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border-[0.5px] border-ink/10 px-3 focus-within:border-border-strong",
  searchInput: "min-w-0 flex-1 bg-transparent text-[13.5px] leading-5 text-ink placeholder:text-ink-secondary focus:outline-none",
  /** "Bot templates", "Publish", "Cancel": an outlined pill */
  outlinePill: "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-full border border-border px-3.5 text-[13px] text-ink transition-colors hover:bg-hover disabled:opacity-40 motion-reduce:transition-none",
  /** "Add a custom connector", "Uninstall": a filled gray pill */
  fillPill: "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-full bg-ink/[0.06] px-4 text-[13px] text-ink transition-colors hover:bg-ink/10 disabled:opacity-40 motion-reduce:transition-none",
  /** "Add plugin", "Save": the white pill */
  primaryPill: "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium text-app transition-opacity hover:opacity-90 disabled:opacity-30 motion-reduce:transition-none",
  /** "Delete Skill" */
  dangerPill: "inline-flex h-[26px] shrink-0 items-center justify-center gap-2 rounded-full bg-danger/15 px-3 text-[12.5px] text-danger transition-colors hover:bg-danger/25 disabled:opacity-40 motion-reduce:transition-none",
  /** a filled field (skill page) */
  field: "w-full rounded-[12px] bg-card px-3.5 py-2.5 text-[13.5px] leading-5 text-ink placeholder:text-ink-tertiary focus:outline-none focus:ring-1 focus:ring-border-strong disabled:opacity-60",
  /** an outlined field (custom connector) */
  outlineField: "w-full rounded-[12px] border-[0.5px] border-ink/10 bg-transparent px-3.5 py-2.5 text-[13.5px] leading-5 text-ink placeholder:text-ink-tertiary focus:border-border-strong focus:outline-none disabled:opacity-60",
  /** "Bot templates": a hairline pill, a white round mark, the words, a gray arrow */
  textLink: "inline-flex h-8 shrink-0 items-center gap-2 rounded-full border-[0.5px] border-ink/10 pl-2 pr-3 text-[13px] text-ink transition-colors hover:bg-hover motion-reduce:transition-none",
  /** a quiet gray pill of Manage's title row (scope, refresh, + Add) */
  quietPill: "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full bg-ink/[0.06] px-3 text-[12px] text-ink-secondary transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-50 motion-reduce:transition-none",
  fieldLabel: "mb-1.5 block text-[13px] leading-5 text-ink",
} as const;

/** A category pill: gray, the chosen one white with dark text. */
export function pluginChipClass(active: boolean): string {
  return cn(
    "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[13.5px] leading-5 transition-colors motion-reduce:transition-none",
    active ? "bg-ink text-app" : "bg-ink/[0.06] text-ink hover:bg-ink/10",
  );
}

/** A row's Connect / Add / Update button: a gray pill of one width. */
export function pluginActionClass(variant: "fill" | "outline" = "fill"): string {
  return cn(
    "inline-flex h-[26px] min-w-[96px] shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13.5px] leading-5 text-ink transition-colors disabled:opacity-50 motion-reduce:transition-none",
    variant === "fill" ? "bg-ink/[0.06] hover:bg-ink/10" : "border border-border hover:bg-hover",
  );
}
