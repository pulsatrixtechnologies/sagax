// The app's one small tooltip bubble: a `role="tooltip"` wired to its trigger
// with aria-describedby. Inside a `TipHost` it opens on hover and on focus
// within; with `open` it is shown by the caller (a trigger that tracks its
// own focus). Used by the nudge button, a row's state icon and a skill row's
// "shared" mark: one look, one place.
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** The wrapper of a trigger and its bubble: the group the bubble opens with. */
export function TipHost({ children, className, ...rest }: { children: ReactNode; className?: string } & Record<`data-${string}`, string | undefined>) {
  return <span {...rest} className={cn("group/tip relative inline-flex", className)}>{children}</span>;
}

export function TipBubble({ id, children, open, variant = "dark", wide = false, className, ...rest }: {
  id: string;
  children: ReactNode;
  /** shown by the caller (otherwise by hover and focus within the TipHost) */
  open?: boolean;
  /** "dark": the reference's dark bubble; "panel": the popover surface */
  variant?: "dark" | "panel";
  /** may wrap (a sentence) instead of one line */
  wide?: boolean;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <span
      id={id}
      {...rest}
      role="tooltip"
      className={cn(
        "pointer-events-none absolute right-0 bottom-[calc(100%+4px)] z-30 text-[12px] shadow-md",
        variant === "dark" ? "rounded-md bg-[#1c1c1e] px-2 py-1.5 text-white ring-1 ring-white/15" : "rounded-lg bg-panel px-2.5 py-1.5 text-ink shadow-xl ring-1 ring-ink/10 popover-surface",
        wide ? "w-max max-w-[300px] leading-4" : "whitespace-nowrap leading-none",
        open === undefined ? "opacity-0 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100" : open ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {children}
    </span>
  );
}
