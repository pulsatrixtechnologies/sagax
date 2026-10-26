// A rounded stat tile: grey label on top, a large value, an optional
// progress ring (a success rate), an optional link arrow that makes the
// whole tile clickable, and room under the value for a small chart
// (MiniBars). Same contract as the Perspicax console's `StatCard` (its spec,
// section 8.0); data in props only.
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
  /** 0 to 1: draws a progress ring beside the value. */
  ring?: number;
  children?: ReactNode;
  testId?: string;
}

function Ring({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" role="img" aria-label={`${Math.round(clamped * 100)} %`} className="shrink-0">
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-control" />
      <circle
        cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={`${clamped * c} ${c}`} transform="rotate(-90 18 18)" className="text-success"
      />
    </svg>
  );
}

export function StatCard({ label, value, hint, href, ring, children, testId }: StatCardProps) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-[12px] text-ink-secondary">
        <span className="truncate">{label}</span>
        {href && <ArrowUpRight size={13} aria-hidden className="shrink-0" />}
      </span>
      <span className="flex items-center justify-between gap-3">
        <span className="text-[20px] font-semibold leading-7 text-ink tabular-nums">{value}</span>
        {ring !== undefined && <Ring value={ring} />}
      </span>
      {hint && <span className="text-[11.5px] text-ink-tertiary">{hint}</span>}
      {children}
    </>
  );
  const frame = "flex min-w-0 flex-col gap-1 rounded-xl border border-hairline bg-card px-3.5 py-3";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" data-testid={testId} className={cn(frame, "hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60")}>{body}</a>
  ) : (
    <div data-testid={testId} className={frame}>{body}</div>
  );
}
