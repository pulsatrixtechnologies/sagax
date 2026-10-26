// Client view of the per-job usage traces (server/usage-trace.ts): where each
// job spent its time and its money, read from GET /api/usage/traces (owner or
// usage.view). Pure formatting and a fetch helper; the panel is
// src/components/usage/UsageTraces.tsx. No raw UUID is ever shown: the server
// sends a human label plus the ids for a Copy affordance only.
import { api } from "@/state/store";
import { t } from "@/lib/i18n";

/** One settled turn of a job: time, token counts and cost, as the ledger
 * recorded them. Mirrors server/usage-trace.ts UsageTraceTurn. */
export interface UsageTraceTurn {
  at: string;
  model: string;
  engine: string;
  input: number;
  output: number;
  cachedInput: number;
  costUsd: number | null;
  costSource: "reported" | "estimated" | null;
  durationMs: number | null;
}

export type UsageTraceTriggerKind = "user" | "owner" | "routine" | "bot";

/** One job's trace. Mirrors server/usage-trace.ts UsageJobTrace. */
export interface UsageJobTrace {
  jobId: string;
  threadId: string;
  botId: string;
  botName: string;
  triggerKey: string;
  triggerLabel: string;
  triggerKind: UsageTraceTriggerKind;
  routineId?: string;
  firstAt: string;
  lastAt: string;
  turns: number;
  timedTurns: number;
  durationMs: number;
  input: number;
  output: number;
  cachedInput: number;
  costUsd: number | null;
  estimatedUsd: number | null;
  unpriced: number;
  models: string[];
  steps: UsageTraceTurn[];
}

export interface UsageTraceList {
  from: string;
  to: string;
  jobs: UsageJobTrace[];
  total: {
    jobs: number;
    turns: number;
    durationMs: number;
    costUsd: number | null;
    estimatedUsd: number | null;
    unpriced: number;
    input: number;
    output: number;
  };
  truncated: boolean;
}

/** The whole-ledger traces: every job of the workspace (owner or usage.view).
 * The admin console reads this; the app's personal screen reads fetchMyTraces. */
export function fetchTraces(range: { from: string; to: string }, get: <T>(path: string) => Promise<T> = api): Promise<UsageTraceList> {
  return get<UsageTraceList>(`/api/usage/traces?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
}

/** The signed-in person's OWN traces and nothing else (GET /api/me/usage/traces,
 * open to every member). Settings > Usage reads this so a person sees where
 * their own jobs spent time and money, never another person's. */
export function fetchMyTraces(range: { from: string; to: string }, get: <T>(path: string) => Promise<T> = api): Promise<UsageTraceList> {
  return get<UsageTraceList>(`/api/me/usage/traces?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
}

/** "0 ms", "450 ms", "6.9 s", "51 s", "1 m 40 s", "2 h 5 m": units are
 * language neutral, so one format reads in every locale. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const tenths = Math.round(ms / 100);
  if (tenths < 100) return `${(tenths / 10).toFixed(1).replace(/\.0$/, "")} s`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes} m ${seconds % 60} s` : `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} m` : `${hours} h`;
}

/** The human label for who triggered a job. A person or a routine arrives
 * already named by the server; the machine and bot-to-bot kinds are localized
 * here so the app, not the ledger, owns their wording. */
export function triggerLabelOf(job: Pick<UsageJobTrace, "triggerKind" | "triggerLabel" | "routineId">): string {
  if (job.triggerKind === "owner") return t("usage.trace.trigger.owner");
  if (job.triggerKind === "bot") return t("usage.trace.trigger.bot");
  if (job.triggerKind === "routine") {
    const name = job.triggerLabel.replace(/^Routine:\s*/, "").trim();
    return t("usage.trace.trigger.routine", { name: name || (job.routineId ?? "") });
  }
  return job.triggerLabel;
}

/** New tokens are the input the model actually read this job, cache aside. */
export function freshInput(job: Pick<UsageJobTrace, "input" | "cachedInput">): number {
  return Math.max(0, job.input - job.cachedInput);
}
