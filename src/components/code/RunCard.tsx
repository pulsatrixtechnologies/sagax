// One run as a row (the Code list) or a compact line (the card under a bot's
// message). The contract is the Perspicax console's `RunCard` (its spec,
// section 8.0): same props, same rendering; data in props only, no network.
//
// Row: a left card (`N files`, `+X` green, `-Y` red, a state pill), then the
// title, a blue dot when unread, and a grey line: PR state, model, repo, age.
import { CircleDot, GitBranch, GitMerge, GitPullRequest, GitPullRequestDraft, Hourglass, Loader2, OctagonX, Square } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { CloudAgentPrState, RunPill } from "../../../shared/cloud-agents.ts";
import { RUN_WORKING_STATES } from "../../../shared/cloud-agents.ts";
import { compactAge } from "@/lib/code-runs";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

export interface RunCardProps {
  title: string;
  /** The run's Perspicax state (RunState). */
  state: string;
  pr?: { number: number; state: CloudAgentPrState };
  stats?: { files: number; added: number; removed: number };
  model?: string;
  repo?: string;
  updatedAt: Date;
  unread?: boolean;
  onOpen: () => void;
  compact?: boolean;
  /** Now, for the age (tests pin it). */
  now?: number;
  testId?: string;
}

/** The pill from the state and the PR (the PR wins once merged). */
export function runCardPill(state: string, pr?: { state: CloudAgentPrState }): RunPill {
  if (pr?.state === "merged") return "merged";
  if (RUN_WORKING_STATES.has(state)) return "running";
  if (state === "queued" || state === "waiting_for_approval") return "waiting";
  if (state === "failed" || state === "expired") return "failed";
  if (pr?.state === "draft") return "draft";
  if (pr?.state === "open") return "open";
  if (state === "stopped") return "stopped";
  return "branch";
}

const PILL: Record<RunPill, { icon: LucideIcon; tone: string }> = {
  merged: { icon: GitMerge, tone: "bg-accent/15 text-accent-text" },
  draft: { icon: GitPullRequestDraft, tone: "bg-control text-ink-secondary" },
  open: { icon: GitPullRequest, tone: "bg-success/15 text-success" },
  branch: { icon: GitBranch, tone: "bg-control text-ink-secondary" },
  running: { icon: Loader2, tone: "bg-control text-ink" },
  waiting: { icon: Hourglass, tone: "bg-warning/15 text-warning" },
  failed: { icon: OctagonX, tone: "bg-danger/15 text-danger" },
  stopped: { icon: Square, tone: "bg-control text-ink-secondary" },
};

export function pillLabel(pill: RunPill): string {
  return t(`code.pill.${pill}` as "code.pill.merged");
}

export function RunPillBadge({ pill, small = false }: { pill: RunPill; small?: boolean }) {
  const { icon: Icon, tone } = PILL[pill];
  return (
    <span data-run-pill={pill} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium", small ? "px-1.5 py-px text-[10.5px]" : "px-2 py-0.5 text-[11px]", tone)}>
      <Icon size={small ? 10 : 11} aria-hidden className={cn(pill === "running" && "animate-spin motion-reduce:animate-none")} />
      {pillLabel(pill)}
    </span>
  );
}

export function formatAge(updatedAt: Date, now: number): string {
  const { n, unit } = compactAge(updatedAt.getTime(), now);
  return t(`code.age.${unit}` as "code.age.min", { n });
}

/** `1.1k` above a thousand, the number below. */
export function compactCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(value);
}

function prLine(pr: RunCardProps["pr"]): { icon: LucideIcon; label: string } {
  if (!pr) return { icon: GitBranch, label: t("code.pr.none") };
  const icon = pr.state === "merged" ? GitMerge : pr.state === "draft" ? GitPullRequestDraft : pr.state === "closed" ? CircleDot : GitPullRequest;
  return { icon, label: t(`code.pr.${pr.state}` as "code.pr.open", { number: pr.number }) };
}

export function RunCard({ title, state, pr, stats, model, repo, updatedAt, unread, onOpen, compact = false, now = Date.now(), testId }: RunCardProps) {
  const pill = runCardPill(state, pr);
  const line = prLine(pr);
  const LineIcon = line.icon;
  const age = formatAge(updatedAt, now);
  const meta = (
    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-secondary">
      <LineIcon size={12} aria-hidden className="shrink-0" />
      <span className="sr-only">{line.label}</span>
      {model && <span className="truncate">{model}</span>}
      {repo && <span className="truncate text-ink-tertiary">{repo}</span>}
      <span className="shrink-0 text-ink-tertiary">{age}</span>
    </span>
  );
  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid={testId ?? "run-card-compact"}
        aria-label={t("code.card.openAria", { title })}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <RunPillBadge pill={pill} small />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{title}</span>
        {unread && <span aria-label={t("code.unread")} className="size-1.5 shrink-0 rounded-full bg-unread" />}
        {stats && (stats.added > 0 || stats.removed > 0) && (
          <span className="shrink-0 text-[11.5px] tabular-nums">
            <span className="text-success">+{compactCount(stats.added)}</span>{" "}
            <span className="text-danger">-{compactCount(stats.removed)}</span>
          </span>
        )}
        <span className="shrink-0 text-[11.5px] text-ink-tertiary">{age}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={testId ?? "run-card"}
      aria-label={t("code.card.openAria", { title })}
      className="group flex w-full min-w-0 items-center gap-4 rounded-xl px-2 py-2 text-left hover:bg-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <span className="flex h-[56px] w-[118px] shrink-0 flex-col justify-between rounded-lg border border-hairline bg-card px-2 py-1.5">
        <span className="flex items-center justify-between gap-1 whitespace-nowrap text-[10.5px] tabular-nums">
          {stats ? (
            <>
              <span className="text-ink-secondary">{stats.files === 1 ? t("code.card.files.one") : t("code.card.files", { n: stats.files })}</span>
              <span>
                <span className="text-success">+{compactCount(stats.added)}</span>{" "}
                <span className="text-danger">-{compactCount(stats.removed)}</span>
              </span>
            </>
          ) : <span className="text-ink-tertiary">{t("code.card.noChanges")}</span>}
        </span>
        <span className="flex justify-center"><RunPillBadge pill={pill} /></span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium text-ink">{title}</span>
          {unread && <span aria-label={t("code.unread")} data-unread className="size-1.5 shrink-0 rounded-full bg-unread" />}
        </span>
        {meta}
      </span>
    </button>
  );
}
