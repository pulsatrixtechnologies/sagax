import type { GroupGoalRunStatus } from "../../shared/group-goal-run.ts";
import type { ProactiveMode } from "../../shared/proactive-mode.ts";
import type { RoutineAccess, RoutineRetryCause, RoutineRunHandoff } from "../../shared/routines.ts";
/** `cloud` runs the agent itself inside the bot's Boat VM. `maus` keeps
 * using the provider selected on the MAUS and only borrows its configured
 * computer tools, if any. */
export type RoutineRunOn = "maus" | "cloud";

export type RoutineTarget = "bot" | "room-goal";

export type RoutineGoalStatus = Exclude<GroupGoalRunStatus, "working">;

export interface RoutineContextAttachment {
  id: string;
  kind: "file" | "image";
  name: string;
  path: string;
  size: number;
}

export type RoutineRunTrigger = "schedule" | "manual" | "webhook" | "proactive";

export type RoutineRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  /** Flow refused run init (previous unclosed / unknown routine / run_exists). */
  | "blocked"
  | "cancelled"
  | "missed"
  /** The pre-check found nothing to do: no turn, no message, no notice. */
  | "nothing_to_report";

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  /** Snapshot the work so an edited/deleted definition cannot rewrite history. */
  prompt?: string;
  /** Snapshot of the legacy calendar/display length. */
  durationMinutes?: number;
  /** Snapshot of the optional active-work safety cap. */
  timeoutMinutes?: number;
  attachments?: RoutineContextAttachment[];
  target: RoutineTarget;
  /** Slice 6: the routine's runAs when this run was created. */
  runAs?: string;
  /** Exact terminal room outcome. `status` remains the scheduler lifecycle
   * while this preserves blocked/needs-input/limit semantics and closes the
   * cross-file crash-recovery gap with the room's goal card. */
  goalStatus?: RoutineGoalStatus;
  /** Snapshot the room as well as the coordinator so edited definitions do
   * not redirect already-queued team work. */
  groupId?: string;
  botId: string;
  runOn: RoutineRunOn;
  scheduledFor: number;
  status: RoutineRunStatus;
  manual: boolean;
  /** Slice 6, fix 2: a run Perspicax rate limited stays queued until this
   * time (ms), retried at most ROUTINE_ADMIT_MAX_ATTEMPTS times. */
  admitAfter?: number;
  admitAttempts?: number;
  /** First tick a queued run was skipped because its target bot or room was
   * busy. Deferral behind a busy target is unbounded, so this timestamp is
   * what surfaces the wait instead of leaving the run looking freshly queued. */
  deferredAt?: number;
  /** When the one-per-run deferral notice was raised, so restarts and repeat
   * ticks stay quiet. */
  deferredNoticeAt?: number;
  /** Set when the run used its one automatic second start, and why. */
  retried?: RoutineRetryCause;
  /** A queued run starts no earlier than this. */
  retryAt?: number;
  /** When its current wait began; read only while the run is waiting. */
  waitingSince?: number;
  /** Times a restart cut this run and the next start resumed it in place
   * (at most once; a second cut fails it with ROUTINE_RESTARTED). */
  restartResumes?: number;
  /** Why this receipt exists. Kept optional so version-1 files migrate in place. */
  triggerSource?: RoutineRunTrigger;
  /** "app": a connected-app event started it; "wait": a wait's follow-up did
   * (its triggerSource stays "webhook", an outside event). */
  eventSource?: "app" | "wait";
  webhookId?: string;
  deliveryId?: string;
  /** Snapshot the routine's reporting destination. Execution remains on the
   * separate `threadId` so recurring work never contaminates chat context. */
  sourceThreadId?: string;
  /** Where this run reports (its routine's destination, else the bot's main
   * thread when the run was made), never redirected by later edits. */
  resultsThreadId?: string;
  threadId?: string;
  startedAt?: number;
  finishedAt?: number;
  output?: string;
  /** Human-readable reason the detached execution is waiting. */
  attention?: string;
  /** Why a `nothing_to_report` run had nothing to do. */
  quietReason?: string;
  /** 2026-10-22: a completed run whose final message had nothing for the
   * person (server/routines/routine-report.ts): nothing is posted to their chat. */
  quiet?: true;
  error?: string;
  cost?: number | null;
  denials?: string[];
  /** 2026-10-26: what the routine's watch saw change (bounded, data), read
   * by the run's turn inside its fence (server/routines/routine-watch.ts). Set when
   * the watch woke the run, so a restart before the turn keeps the wake. */
  watchNote?: string;
  /** 2026-10-11: what the organization memory (Perspicax's duplicate
   * detector) said before the run started, when it found similar work. */
  memoryHint?: RoutineMemoryHint;
  /** 2026-10-26: this failure paused its routine (failed runs in a row). */
  autoPaused?: { failures: number };
  /** 2026-10-30: a proactive wake (server/proactive/proactive-wake.ts), not a routine:
   * the mode it was started in, the hops of the chain that led to it,
   * confined when an email woke it, accepted when a legacy proposal was
   * answered yes, dryRuns the write plans recorded before ordinary approval. */
  proactive?: RoutineRunProactive;
  /** 2026-11-01: the run completed, but not all of it went right (a step
   * the bot reported as failed or partial, a tool that kept failing, an
   * engine error, a teammate whose work failed). The reason, for the person:
   * shown as "Completed with problems", never a plain success. */
  problems?: string;
  /** 2026-11-03: the teammates this run handed work to and their threads. */
  handedTo?: RoutineRunHandoff[];
  /** 2026-11-01: a person started this run (Run now, run_routine from
   * their conversation): its card shows in the conversation from the start,
   * queued and running included, so they see what started. */
  startedBy?: "person";
  /** 2026-11-01: what a waiting run waits on: its teammates' work (the run
   * settles when that work ends, even without another turn), or absent for
   * a question or approval for the person. */
  waitingOn?: "teammates";
  /** Snapshot of the routine's confined access for this run. */
  access?: RoutineAccess;
  /** Items its routine's checks handed this run, so they are kept or released once it ends. */
  checkKey?: string;
  createdAt: number;
  seenAt?: number;
}

export interface ProactiveDryRunEntry {
  /** When the dry run was recorded (ms). */
  at: number;
  /** Tool or command the write would call. */
  tool: string;
  /** Short plan line (no secrets). */
  summary: string;
}

export interface RoutineRunProactive {
  mode: ProactiveMode;
  hops: number;
  sources: string[];
  confined?: true;
  accepted?: true;
  /** Write plans recorded before ordinary approval ran them. */
  dryRuns?: ProactiveDryRunEntry[];
  /** 2026-11-02 (peer inbox, second pass): a wake on teammates' messages
   * (source peer) is never quiet; this is its report when the bot gave
   * none (who wrote, about what: server/proactive/proactive-wake.ts peerWakeDigest). */
  peerDigest?: string;
  /** 2026-11-02: never quiet (a teammate's message or a post in a two-bot
   * DM: server/proactive/proactive-wake.ts wakeAlwaysReports). */
  alwaysReport?: true;
}

/** Similar work the organization memory knew of before a run (organization
 * server, server/memory/perspicax-memory.ts). Pointers and readable facts only. */
export interface RoutineMemoryHint {
  turn: string;
  checkedAt: number;
  duplicates: Array<{ hintId: string; pointer: string; day: string; who: string; score: number; readable: boolean; intent?: string; link?: string }>;
}
