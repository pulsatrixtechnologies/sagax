// Duty-cycled activity indicators. A spinner repaints every vsync for its
// whole lifetime; these dots step through a few opacity holds per cycle.
// Long-lived indicators must stay this cheap.
import { cn } from "@/lib/cn";

export function WorkingDots({ size = 4, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("flex items-center gap-1", className)} aria-hidden="true">
      {[0, 200, 400].map((delay) => (
        <span
          key={delay}
          className="animate-status-pulse rounded-full bg-current"
          style={{ width: size, height: size, animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
