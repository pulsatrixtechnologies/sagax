// A list that is loading, drawn as the shape of its rows (#2595): grey bars
// where the rows will land, so the surface keeps its height and nothing jumps
// when the data arrives, instead of a spinner line that the list then pushes
// away. The bars breathe on opacity only; reduced motion holds them still.
// The label stays in the status region for screen readers (and tests).
import { cn } from "@/lib/cn";

/** One grey bar, the building block. */
export function SkeletonBar({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block rounded-md bg-hover", className)} />;
}

/** Rows in the shape of a list: a square (an icon or a thumbnail) and two
 * lines, or `card` for rows that sit in their own rounded card. */
export function SkeletonRows({
  label,
  rows = 3,
  variant = "list",
  className,
}: {
  label: string;
  rows?: number;
  variant?: "list" | "card";
  className?: string;
}) {
  return (
    <div role="status" data-skeleton="" className={cn("flex flex-col", variant === "card" ? "gap-2" : "", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          // later rows a little lighter, the way a list fades out below the fold
          style={{ opacity: 1 - index * 0.18 }}
          className={cn(
            "flex min-w-0 items-center gap-2.5",
            variant === "card" ? "rounded-xl bg-card px-3 py-2.5" : "border-b border-hairline-weak py-2 last:border-b-0",
          )}
        >
          <SkeletonBar className="size-7 shrink-0 animate-pulse rounded-lg motion-reduce:animate-none" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <SkeletonBar className="h-2.5 w-[55%] animate-pulse motion-reduce:animate-none" />
            <SkeletonBar className="h-2 w-[30%] animate-pulse motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}
