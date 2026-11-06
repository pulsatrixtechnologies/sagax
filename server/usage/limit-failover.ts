// Automatic backup when an engine's usage limit refuses a turn (port of
// OpenMausBot #3074 "continue on the backup engine" and #2754 "when an
// engine runs out", adapted to the rule of 2026-10-19: no card, the turn
// continues at once on another engine the person really has).
//
//   - Which engines may take over is the host's (server/usage/limit-failover-host.ts):
//     the engines a turn of this speaker could run on (sign-ins, keys,
//     the organization's engines, allowedEngines, the approval mode and the
//     organization's policy). Accounts of the same provider are a pool (#2192).
//   - The order is deterministic: same-provider accounts (more headroom
//     first), then the bot's own backups (Settings, automatic recovery), then
//     the organization's default engine, then the catalog.
//   - An engine known to be at its limit for this payer is skipped, so two
//     spent engines never pass a turn back and forth.
//   - The thread's choice is not changed for good: once the reset has passed
//     (the engine's own time, else a prudent estimate), the next turn goes
//     back to the engine the thread was on.
//   - With no engine to take over, the message (or the routine) is sent
//     again once the limit resets, once.
import { readFileSync } from "node:fs";

import { AFTER_RESET_MS } from "../../shared/limit-failover.ts";
import type { ModelSelection } from "../../shared/wire.ts";
import { writeFileAtomic } from "../atomic.ts";

/** An engine instance with one of these keys bills each use instead of drawing on a subscription's limit. */
const PAY_PER_USE_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "CURSOR_API_KEY"];

export type LimitEngine = { instanceId: string; driverKind: string };

/** True when both engines are accounts of the same provider (same driver). */
export function sameProvider(from: LimitEngine, to: LimitEngine): boolean {
  return from.driverKind === to.driverKind;
}

/** An engine instance that bills each use (a pay-per-use key, as its access
 * or in its environment) instead of drawing on a plan's limit. Port of
 * OpenMausBot 3ed90a037 `billsEachUse`. */
export function billsEachUse(config?: { environment?: Record<string, string>; access?: string }): boolean {
  return config?.access === "api" || PAY_PER_USE_KEYS.some((key) => Boolean(config?.environment?.[key]?.trim()));
}

/** Whether `to` may take over a turn `from`'s usage limit refused. Never the
 * same engine instance. Other accounts of the same provider (subscriptions
 * or keys the payer holds) are a rotation pool (#2192): try them before
 * another provider. A pay-per-use key on the same driver stays allowed. */
export function limitBackupAllowed(from: LimitEngine, to: LimitEngine, _toConfig?: { environment?: Record<string, string>; access?: string }): boolean {
  return to.instanceId !== from.instanceId;
}

/** An engine a turn of this speaker may run on, as the host checked it. */
export interface LimitCandidate extends LimitEngine {
  /** The models this payer may pick on it, the default first when allowed. */
  models: string[];
  defaultModel?: string;
}

/** The engine that takes over, or null. Same-provider accounts first (#2192),
 * then the bot's own backups and the organization's default, then the catalog.
 * Within a pool, lower plan used-percent (more headroom) wins when known.
 * A catalog fallthrough never picks a pay-per-use engine the person did not
 * choose as a backup (3ed90a037). */
export function pickLimitBackup(input: {
  from: LimitEngine;
  preferred: ReadonlyArray<{ instanceId: string; model?: string }>;
  candidates: readonly LimitCandidate[];
  blocked: (instanceId: string) => boolean;
  config: (instanceId: string) => { environment?: Record<string, string>; access?: string } | undefined;
  /** Plan used percent 0–100 for this instance when known; null when unknown. */
  usedPercent?: (instanceId: string) => number | null;
  /** Instance ids to skip even when not blocked (empty-reply next-pool pick). */
  skip?: readonly string[];
  /** Only same-provider accounts (proactive near-limit rotation). */
  sameProviderOnly?: boolean;
}): ModelSelection | null {
  const skip = new Set(input.skip ?? []);
  const usable = (candidate: LimitCandidate) => !skip.has(candidate.instanceId) && !input.blocked(candidate.instanceId) &&
    limitBackupAllowed(input.from, candidate, input.config(candidate.instanceId)) && candidate.models.length > 0 &&
    (!input.sameProviderOnly || sameProvider(input.from, candidate));
  const modelOf = (candidate: LimitCandidate, wanted?: string) => wanted && candidate.models.includes(wanted) ? wanted
    : candidate.defaultModel && candidate.models.includes(candidate.defaultModel) ? candidate.defaultModel : candidate.models[0]!;
  const selectionOf = (candidate: LimitCandidate, wanted?: string): ModelSelection =>
    ({ instanceId: candidate.instanceId, model: modelOf(candidate, wanted) });
  const headroom = (instanceId: string): number => {
    const used = input.usedPercent?.(instanceId);
    return used === null || used === undefined ? 50 : used;
  };
  const byHeadroom = (left: LimitCandidate, right: LimitCandidate) => headroom(left.instanceId) - headroom(right.instanceId);
  const pickPool = (preferSame: boolean): ModelSelection | null => {
    for (const entry of input.preferred) {
      const candidate = input.candidates.find((engine) => engine.instanceId === entry.instanceId);
      if (candidate && usable(candidate) && (!preferSame || sameProvider(input.from, candidate))) {
        return selectionOf(candidate, entry.model);
      }
    }
    const catalog = input.candidates
      .filter((candidate) => usable(candidate) && !billsEachUse(input.config(candidate.instanceId))
        && (!preferSame || sameProvider(input.from, candidate)))
      .sort(byHeadroom);
    const next = catalog[0];
    return next ? selectionOf(next) : null;
  };
  if (input.sameProviderOnly) return pickPool(true);
  return pickPool(true) ?? pickPool(false);
}

/** A thread moved to `to` because `from`'s usage limit refused it. */
export interface LimitFailover {
  botId: string;
  threadId: string;
  from: ModelSelection;
  to: ModelSelection;
  /** When `from`'s limit resets (said or estimated). */
  resetsAt: number;
  /** `resetsAt` is Sagax's estimate: the engine named no reset (2026-11-02). */
  estimated?: true;
  /** No hold on `from`'s engine reaches `resetsAt`: the limit that moved the
   * conversation off bound only `from`'s model (Claude's limitScope "model":
   * its extra-usage credits, its family's weekly window). That engine taking
   * turns again, even answering one on another model, says nothing of
   * `from`'s own limit, which holds until `resetsAt` (2026-11-02). */
  modelOnly?: true;
  at: number;
}

/** Something to start again once a limit resets, when nothing could take over. */
export type LimitResume = (
  | { kind: "message"; botId: string; threadId: string; messageId: string; speaker?: unknown; trigger?: unknown }
  | { kind: "routine"; routineId: string }
) & {
  /** The engine whose reset it waits for. */
  engine: string;
  at: number;
  /** Already put off once because the thread was busy. */
  retry?: true;
};

/** `estimated`: the engine named no reset, so `until` is Sagax's estimate
 * (a line never presents it as the engine's own time). */
interface Block { key: string; until: number; estimated?: true }
interface Fired { key: string; at: number }

interface Saved {
  failovers: LimitFailover[];
  blocks: Block[];
  resumes: LimitResume[];
  /** What a reset already started again: a message once, a routine at most
   * once per ROUTINE_RESUME_COOLDOWN_MS, so a balance that never comes back
   * is not retried for ever. */
  fired: Fired[];
}

/** A routine waits for a reset at most once in this window. */
export const ROUTINE_RESUME_COOLDOWN_MS = 12 * 60 * 60_000;

function resumeKey(resume: LimitResume): string {
  return resume.kind === "message" ? `message:${resume.messageId}` : `routine:${resume.routineId}`;
}

const MAX_ROWS = 500;
/** A message is sent again by the backup at most this many times (A, then B, then C). */
export const MAX_RESENDS = 3;

function load(file: string): Saved {
  const empty: Saved = { failovers: [], blocks: [], resumes: [], fired: [] };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Saved>;
    const failovers = Array.isArray(raw.failovers) ? raw.failovers.filter((row): row is LimitFailover =>
      typeof row?.botId === "string" && typeof row?.threadId === "string" && typeof row?.from?.instanceId === "string" &&
      typeof row?.to?.instanceId === "string" && Number.isFinite(row?.resetsAt) && Number.isFinite(row?.at)) : [];
    const blocks = Array.isArray(raw.blocks) ? raw.blocks.filter((row): row is Block => typeof row?.key === "string" && Number.isFinite(row?.until)) : [];
    const resumes = Array.isArray(raw.resumes) ? raw.resumes.filter((row): row is LimitResume => Number.isFinite(row?.at) &&
      ((row?.kind === "message" && typeof row.botId === "string" && typeof row.threadId === "string" && typeof row.messageId === "string") ||
        (row?.kind === "routine" && typeof row.routineId === "string"))) : [];
    const fired = Array.isArray(raw.fired) ? raw.fired.filter((row): row is Fired => typeof row?.key === "string" && Number.isFinite(row?.at)) : [];
    return { failovers, blocks, resumes, fired };
  } catch {
    return empty;
  }
}

export interface LimitFailoverStoreDeps {
  /** The JSON file (DATA_DIR/limit-failovers.json); null keeps it in memory. */
  file: string | null;
  now: () => number;
  /** Delay before going back after a reset; AFTER_RESET_MS by default. */
  afterResetMs?: number;
}

/** The state: which threads are on a backup, which engines are at their
 * limit for which payer, and what waits for a reset. */
export class LimitFailoverStore {
  private readonly deps: LimitFailoverStoreDeps;
  private state: Saved;
  /** Per message: how many times a backup took it over. Memory only. */
  private readonly resends = new Map<string, number>();

  constructor(deps: LimitFailoverStoreDeps) {
    this.deps = deps;
    this.state = deps.file ? load(deps.file) : { failovers: [], blocks: [], resumes: [], fired: [] };
  }

  get afterResetMs(): number {
    return this.deps.afterResetMs ?? AFTER_RESET_MS;
  }

  private static key(payer: string, instanceId: string): string {
    return `${payer}\u0000${instanceId}`;
  }

  /** This engine refuses this payer's turns until `until`. A later reset
   * wins. `estimated`: the engine named no reset and `until` is Sagax's. */
  block(payer: string, instanceId: string, until: number, estimated = false): void {
    const key = LimitFailoverStore.key(payer, instanceId);
    const earlier = this.state.blocks.find((row) => row.key === key);
    if (earlier && earlier.until >= until) return;
    this.state.blocks = [...this.state.blocks.filter((row) => row.key !== key), { key, until, ...(estimated ? { estimated: true as const } : {}) }].slice(-MAX_ROWS);
    this.save();
  }

  /** The hold on this engine for this payer: until when, and whether that
   * time is Sagax's estimate; null while it should work. */
  holdOf(payer: string, instanceId: string): { until: number; estimated: boolean } | null {
    const until = this.blockedUntil(payer, instanceId);
    if (until === null) return null;
    const row = this.state.blocks.find((candidate) => candidate.key === LimitFailoverStore.key(payer, instanceId));
    return { until, estimated: row?.estimated === true };
  }

  /** A turn on this engine worked for this payer: its hold ends now. */
  unblock(payer: string, instanceId: string): void {
    const key = LimitFailoverStore.key(payer, instanceId);
    const kept = this.state.blocks.filter((row) => row.key !== key);
    if (kept.length === this.state.blocks.length) return;
    this.state.blocks = kept;
    this.save();
  }

  /** Until when this engine refuses this payer, or null while it should work. */
  blockedUntil(payer: string, instanceId: string): number | null {
    const now = this.deps.now();
    const row = this.state.blocks.find((candidate) => candidate.key === LimitFailoverStore.key(payer, instanceId));
    if (!row) return null;
    if (row.until <= now) {
      this.state.blocks = this.state.blocks.filter((candidate) => candidate !== row);
      this.save();
      return null;
    }
    return row.until;
  }

  /** A thread moved to `to`. A second move keeps the engine the thread
   * started on, so it still goes back there, and what its own limit was
   * (`modelOnly`). */
  record(failover: LimitFailover): LimitFailover {
    const earlier = this.state.failovers.find((row) => row.threadId === failover.threadId && row.botId === failover.botId);
    // The later reset wins, and with it whether that time is only Sagax's estimate.
    const later = earlier && earlier.resetsAt > failover.resetsAt ? earlier : failover;
    const { estimated: _estimated, modelOnly: _modelOnly, ...moved } = failover;
    const kept = earlier && earlier.to.instanceId === failover.from.instanceId && earlier.to.model === failover.from.model
      ? {
        ...moved, from: earlier.from, resetsAt: later.resetsAt, ...(later.estimated ? { estimated: true as const } : {}),
        ...(earlier.modelOnly ? { modelOnly: true as const } : {}),
      } : failover;
    this.state.failovers = [...this.state.failovers.filter((row) => row.threadId !== failover.threadId), kept].slice(-MAX_ROWS);
    this.save();
    return kept;
  }

  failover(botId: string, threadId: string): LimitFailover | undefined {
    const row = this.state.failovers.find((candidate) => candidate.threadId === threadId && candidate.botId === botId);
    return row ? { ...row } : undefined;
  }

  /** Whether the thread is due to go back: its reset (plus the buffer) passed. */
  due(row: LimitFailover): boolean {
    return row.resetsAt + this.afterResetMs <= this.deps.now();
  }

  forget(threadId: string): void {
    const kept = this.state.failovers.filter((row) => row.threadId !== threadId);
    if (kept.length === this.state.failovers.length) return;
    this.state.failovers = kept;
    this.save();
  }

  /** One more takeover of this message; false once it had MAX_RESENDS. */
  takeResend(messageId: string, max = MAX_RESENDS): boolean {
    const count = this.resends.get(messageId) ?? 0;
    if (count >= max) return false;
    this.resends.set(messageId, count + 1);
    if (this.resends.size > MAX_ROWS) this.resends.delete(this.resends.keys().next().value!);
    return true;
  }

  /** Start this again at `resume.at`. One per message or routine: a later
   * limit on the same one moves it, never adds another. False when a reset
   * already started it again (see Saved.fired), unless it is the one retry
   * of a resume that met a busy thread. */
  schedule(resume: LimitResume): boolean {
    const key = resumeKey(resume);
    const fired = this.state.fired.find((row) => row.key === key);
    if (!resume.retry && fired && (resume.kind === "message" || this.deps.now() - fired.at < ROUTINE_RESUME_COOLDOWN_MS)) return false;
    this.state.resumes = [...this.state.resumes.filter((row) => resumeKey(row) !== key), resume].slice(-MAX_ROWS);
    this.save();
    return true;
  }

  /** The resumes due now, removed from the list and marked as fired. */
  takeDue(): LimitResume[] {
    const now = this.deps.now();
    const due = this.state.resumes.filter((row) => row.at <= now);
    if (!due.length) return [];
    const keys = new Set(due.map(resumeKey));
    this.state.resumes = this.state.resumes.filter((row) => row.at > now);
    this.state.fired = [...this.state.fired.filter((row) => !keys.has(row.key)), ...[...keys].map((key) => ({ key, at: now }))].slice(-MAX_ROWS);
    this.save();
    return due;
  }

  /** The earliest resume, for the timer. */
  nextResumeAt(): number | null {
    return this.state.resumes.reduce<number | null>((earliest, row) => earliest === null || row.at < earliest ? row.at : earliest, null);
  }

  resumes(): LimitResume[] {
    return this.state.resumes.map((row) => ({ ...row }));
  }

  private save(): void {
    if (!this.deps.file) return;
    try {
      writeFileAtomic(this.deps.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    } catch (error) {
      console.error(`limit failovers: could not save: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
