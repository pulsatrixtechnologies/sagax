// What is left of the delegation ledger (contract §9 step 3): every
// teammate request runs on the job runtime now (server/runtime/,
// docs/runtime-contract.md). Kept here: the receipt drawer and the source
// wake of run_with_engine, whose part runs in a thread of the same bot and
// is read back with check_delegation once its synchronous wait ended; the
// live-activity summary check_delegation shows for a runtime task too; and
// the one-time hand-over of a delegations.json an older release left queued.

import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { workOriginSchema, type WorkOrigin } from "./peer-provenance.ts";

const DELEGATIONS_FILE = join(DATA_DIR, "delegations.json");
const RECEIPTS_FILE = join(DATA_DIR, "delegation-receipts.json");
const MAX_RECEIPTS = 100;
const RECEIPT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const RESULT_MAX_CHARS = 4_000;

export type DelegationOutcome = "done" | "failed" | "denied" | "expired" | "cancelled" | "busy_gave_up" | "dropped" | "error";

/** The durable terminal record of one run_with_engine part whose result came
 * after its synchronous wait: what check_delegation reads back. Bounded. */
export interface DelegationReceipt {
  id: string;
  sourceThreadId: string;
  toBotId: string;
  toBotName: string;
  status: DelegationOutcome;
  /** the reply on success; the failure name otherwise (bounded) */
  result?: string;
  /** Auto: the model the worker ran on (docs/plans/2026-10-08-auto-model.md). */
  workerModel?: { engine: string; model: string; taskClass?: string };
  finishedAt: number;
}

let receipts: DelegationReceipt[] = [];

function saveReceipts(): void {
  try {
    writeFileAtomic(RECEIPTS_FILE, JSON.stringify(receipts, null, 2), { mode: 0o600 });
  } catch (error) {
    console.error("delegations: could not persist receipts", error);
  }
}

/** Record one terminal outcome. Newest first; pruned by count and age. */
export function recordDelegationReceipt(receipt: Omit<DelegationReceipt, "finishedAt"> & { finishedAt?: number }): void {
  const now = Date.now();
  const bounded: DelegationReceipt = {
    id: receipt.id, sourceThreadId: receipt.sourceThreadId, toBotId: receipt.toBotId, toBotName: receipt.toBotName,
    status: receipt.status, finishedAt: receipt.finishedAt ?? now,
  };
  if (receipt.result !== undefined) bounded.result = receipt.result.slice(0, RESULT_MAX_CHARS);
  if (receipt.workerModel) bounded.workerModel = receipt.workerModel;
  receipts = [bounded, ...receipts.filter((existing) => existing.id !== bounded.id)]
    .filter((existing) => now - existing.finishedAt <= RECEIPT_MAX_AGE_MS)
    .slice(0, MAX_RECEIPTS);
  saveReceipts();
}

export function findDelegationReceipt(id: string): DelegationReceipt | null {
  return receipts.find((receipt) => receipt.id === id) ?? null;
}

/** Load the receipt drawer at boot. Missing or corrupt: empty. */
export function loadDelegationReceipts(): void {
  receipts = [];
  try {
    const raw = JSON.parse(readFileSync(RECEIPTS_FILE, "utf8"));
    if (!Array.isArray(raw)) return;
    const now = Date.now();
    for (const value of raw) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const { id, sourceThreadId, toBotId, toBotName, status, result, finishedAt } = value as Partial<DelegationReceipt>;
      if (typeof id !== "string" || !id || typeof sourceThreadId !== "string" || typeof toBotId !== "string") continue;
      if (typeof toBotName !== "string" || typeof status !== "string") continue;
      if (!Number.isFinite(finishedAt) || now - finishedAt! > RECEIPT_MAX_AGE_MS) continue;
      receipts.push({ id, sourceThreadId, toBotId, toBotName, status, finishedAt: finishedAt!, ...(typeof result === "string" ? { result } : {}) });
    }
    receipts = receipts.slice(0, MAX_RECEIPTS);
  } catch {
    /* no receipts yet */
  }
}

/** One handoff an older release left queued in delegations.json. */
export interface LegacyDelegation {
  id: string;
  sourceThreadId: string;
  sourceBotId: string;
  toBotId: string;
  message: string;
  /** start_thread / send_to_bot: the thread opened for it on the target. */
  targetThreadId?: string;
  oneWay: boolean;
  /** An external runtime queued it: it polls, nothing wakes its bot. */
  external: boolean;
  approved: boolean;
  origin?: WorkOrigin;
}

/** The handoffs an older release left queued, taken once: the file is
 * renamed *.migrated so they are never taken twice, and the caller hands
 * each to the job runtime. Missing or unreadable: none. */
export function takeLegacyDelegations(file = DELEGATIONS_FILE): LegacyDelegation[] {
  if (!existsSync(file)) return [];
  const out: LegacyDelegation[] = [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    for (const [sourceThreadId, list] of Object.entries(raw ?? {})) {
      if (!Array.isArray(list)) continue;
      for (const value of list) {
        if (!value || typeof value !== "object") continue;
        const item = value as Record<string, unknown>;
        if (typeof item.toBotId !== "string" || typeof item.message !== "string" || typeof item.sourceBotId !== "string" || !item.sourceBotId) continue;
        const origin = workOriginSchema.safeParse(item.origin);
        out.push({
          id: typeof item.id === "string" ? item.id : "",
          sourceThreadId, sourceBotId: item.sourceBotId, toBotId: item.toBotId, message: item.message,
          ...(typeof item.targetThreadId === "string" && item.targetThreadId ? { targetThreadId: item.targetThreadId } : {}),
          oneWay: item.oneWay === true, external: item.completionOwner === "external", approved: item.approvalAlreadyGranted === true,
          ...(origin.success ? { origin: origin.data } : {}),
        });
      }
    }
  } catch (error) {
    console.error("delegations: the queue an older release left could not be read", error);
  }
  try {
    renameSync(file, `${file}.migrated`);
  } catch (error) {
    console.error("delegations: could not retire the old queue file", error);
  }
  return out;
}

// ── peer wake (a run_with_engine part's late result resumes its source) ──

/** The revival prompt the harness feeds a delegating bot when its peer
 * replies. The peer's text is already in the thread; this tells the source
 * to stop idling and answer the user with the outcome. */
export function buildDelegationRevivalPrompt(targetName: string): string {
  return [
    "[A delegated task just completed]",
    `The task you delegated to @${targetName} has finished, and their reply is now in this conversation.`,
    "Pick the work back up: review the reply, then answer the user with the outcome — lead with the concrete result and say what happens next. Do not re-delegate the same task.",
  ].join("\n\n");
}

/** Same wake for a failed delegated turn: the source must tell the user it
 * did not finish and decide the next step, instead of leaving the failure
 * as a silent chip nobody acts on. */
export function buildDelegationFailurePrompt(targetName: string, reason: string): string {
  return [
    "[A delegated task failed]",
    `The task you delegated to @${targetName} did not finish: ${reason}`,
    "Take over: tell the user what failed in plain terms, then decide the next step — retry with a narrower task, do the work yourself, or propose an alternative. Do not re-delegate the exact same task unchanged.",
  ].join("\n\n");
}

// Several results can land within minutes (a fan-out): each is one wake.
export const DELEGATION_WAKE_MAX_PER_WINDOW = 6;
export const DELEGATION_WAKE_WINDOW_MS = 5 * 60 * 1000;

/** Bounded auto-wake budget per source thread. A delegation completion
 * wakes the source; if that source re-delegates and the new completion
 * wakes it again, this cap stops an A→B→A→B ping-pong. The window is
 * short, so a user actively driving the bot outpaces it. */
export class DelegationWakeBudget {
  private readonly entries = new Map<string, { count: number; windowStart: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  tryAcquire(threadId: string): boolean {
    const now = this.now();
    const entry = this.entries.get(threadId);
    if (!entry || now - entry.windowStart >= DELEGATION_WAKE_WINDOW_MS) {
      this.entries.set(threadId, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= DELEGATION_WAKE_MAX_PER_WINDOW) return false;
    entry.count += 1;
    return true;
  }

  /** A genuine user turn clears the debt — the user is driving now. */
  reset(threadId: string): void {
    this.entries.delete(threadId);
  }
}

// ── live status for a running delegated turn ──────────────────────────

export interface DelegatedActivityMessage {
  at: number;
  kind: string;
  text?: string;
  tool?: { name?: string } | null;
}

export function formatDelegationElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1_000));
  if (totalSeconds < 90) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/** Recent, bounded activity from the peer's thread since the delegated
 * turn started — newest last. Empty means the peer has produced nothing
 * visible since dispatch, which reads as "maybe stuck" to the caller. */
export function summarizeDelegatedActivity(
  messages: readonly DelegatedActivityMessage[],
  startedAtMs: number,
  limit = 5,
): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.at < startedAtMs) continue;
    if (message.kind === "activity") {
      const name = (message.tool?.name ?? "").trim();
      if (name) lines.push(`tool: ${name}`);
      continue;
    }
    if (message.kind === "text" && message.text?.trim()) {
      const text = message.text.trim().replace(/\s+/g, " ");
      lines.push(`text: ${text.slice(0, 140)}${text.length > 140 ? "…" : ""}`);
    }
  }
  return lines.slice(-limit);
}
