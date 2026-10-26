// Server side of the safety review (docs/security/misuse-guardrails.md).
//
// The verdict is pure (shared/safety-review.ts). This module reads the same
// flag as the misuse guardrail. Shadow records the row and changes nothing.
// Enforce returns the safer path once, then waits for an explicit approval
// the person accepts. Denial and expiry are final.

import { randomUUID } from "node:crypto";
import { appendAdminAction } from "./admin-activity.ts";
import { DATA_DIR } from "./config.ts";
import { misuseGuardrailMode } from "./misuse-guardrails.ts";
import {
  SAFETY_REFUSAL_FINAL,
  admitSafety,
  consumeAdmit,
  emptySafetyMemory,
  rememberSafety,
  reviewSafety,
  safetyOfferIds,
  safetyReviewPrompt,
  safetySealIds,
  tightenSafety,
  type SafetyInput,
  type SafetyMemory,
  type SafetySurface,
  type SafetyVerdict,
} from "../shared/safety-review.ts";

export interface SafetyHoldInput extends SafetyInput {
  principalId?: string;
  threadId?: string;
  botId?: string;
  /** Isolated reviewer. It may only tighten the local verdict. */
  review?(prompt: string, signal?: AbortSignal): Promise<string>;
  /** The person's custom rules as policy text for the reviewer
   * (shared/custom-rules.ts customRulesPolicyText). Tighten only. */
  policy?: string;
}

export interface SafetyEffect {
  kind: "stop" | "hold" | "allow";
  message: string;
  fingerprint: string;
  classKey?: string;
  /** A read, or a call the person already accepted, may run without a card. */
  auto?: boolean;
  verdict: SafetyVerdict;
}

export type SafetyAnswer = "allow" | "deny" | "timeout";

export interface SafetyConfirmRequest {
  threadId?: string;
  botId?: string;
  tool?: string;
  summary: string;
  fingerprint: string;
  classKey?: string;
}

interface Bucket extends SafetyMemory {}
const buckets = new Map<string, Bucket>();

interface Armed {
  principalId?: string;
  threadId?: string;
  fingerprint: string;
  classKey?: string;
}
const armed = new Map<string, Armed>();

interface Hold {
  resolve: (answer: SafetyAnswer) => void;
  timer: ReturnType<typeof setTimeout>;
}
const holds = new Map<string, Hold>();
const notes = new Map<string, string>();

let confirmer: ((request: SafetyConfirmRequest) => Promise<SafetyAnswer>) | null = null;
let dataDirForTests: string | null = null;

export function setSafetyConfirm(fn: typeof confirmer): void {
  confirmer = fn;
}

export function setSafetyDataDirForTests(dir: string | null): void {
  dataDirForTests = dir;
}

export function resetSafetyReviewForTests(): void {
  buckets.clear();
  armed.clear();
  for (const hold of holds.values()) clearTimeout(hold.timer);
  holds.clear();
  notes.clear();
  confirmer = null;
  dataDirForTests = null;
}

function bucketKeys(input: { principalId?: string; threadId?: string }): string[] {
  const keys: string[] = [];
  if (input.principalId) keys.push(`p:${input.principalId}`);
  if (input.threadId) keys.push(`t:${input.threadId}`);
  if (keys.length === 0) keys.push("anonymous");
  return keys;
}

function ensure(key: string): Bucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = emptySafetyMemory();
    buckets.set(key, bucket);
  }
  return bucket;
}

function snapshot(keys: readonly string[]): SafetyMemory {
  const memory = emptySafetyMemory();
  for (const key of keys) {
    const bucket = buckets.get(key);
    if (!bucket) continue;
    for (const id of bucket.final) memory.final.add(id);
    for (const id of bucket.admitted) memory.admitted.add(id);
    for (const id of bucket.offered) memory.offered.add(id);
  }
  return memory;
}

function writeIds(keys: readonly string[], field: keyof SafetyMemory, ids: readonly string[]): void {
  for (const key of keys) {
    const bucket = ensure(key);
    for (const id of ids) bucket[field].add(id);
  }
}

function dropIds(keys: readonly string[], field: keyof SafetyMemory, ids: readonly string[]): void {
  for (const key of keys) {
    const bucket = buckets.get(key);
    if (!bucket) continue;
    for (const id of ids) bucket[field].delete(id);
  }
}

function applyRemember(keys: readonly string[], verdict: SafetyVerdict): void {
  const scratch = emptySafetyMemory();
  rememberSafety(scratch, verdict);
  writeIds(keys, "final", [...scratch.final]);
  writeIds(keys, "offered", [...scratch.offered]);
}

function applyAdmit(keys: readonly string[], verdict: SafetyVerdict): void {
  const scratch = emptySafetyMemory();
  admitSafety(scratch, verdict);
  writeIds(keys, "admitted", [...scratch.admitted]);
}

function applyConsume(keys: readonly string[], verdict: SafetyVerdict): void {
  const scratch = emptySafetyMemory();
  scratch.admitted = new Set(safetyOfferIds(verdict));
  consumeAdmit(scratch, verdict);
  dropIds(keys, "admitted", safetyOfferIds(verdict));
}

function excerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

function audit(action: string, input: SafetyHoldInput, verdict: SafetyVerdict): void {
  try {
    appendAdminAction(dataDirForTests ?? DATA_DIR, {
      category: "security",
      action,
      target: input.botId ? { kind: "bot", id: input.botId } : { kind: "person", id: input.principalId },
      after: {
        surface: input.surface,
        code: verdict.code,
        ...(input.tool ? { tool: input.tool } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(verdict.classKey ? { classKey: verdict.classKey } : {}),
        excerpt: excerpt(input.text),
      },
      actor: input.principalId ? { kind: "person", principalId: input.principalId, via: "sagax" } : { kind: "loopback" },
    });
  } catch (error) {
    console.warn(`[safety] activity log: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function reviewed(input: SafetyHoldInput, verdict: SafetyVerdict): Promise<SafetyVerdict> {
  if (!input.review || verdict.action === "block" || verdict.code === "read_only") return verdict;
  try {
    const text = await input.review(safetyReviewPrompt(input.text, input.policy), AbortSignal.timeout(8000));
    return tightenSafety(verdict, text);
  } catch {
    return verdict;
  }
}

function effectOf(input: SafetyHoldInput, verdict: SafetyVerdict, keys: readonly string[]): SafetyEffect | null {
  if (verdict.action === "allow" && verdict.code === "admit") {
    applyConsume(keys, verdict);
    return { kind: "allow", auto: true, message: "", fingerprint: verdict.fingerprint, classKey: verdict.classKey, verdict };
  }
  if (verdict.code === "read_only") {
    return { kind: "allow", auto: true, message: "", fingerprint: verdict.fingerprint, classKey: verdict.classKey, verdict };
  }
  if (verdict.action === "allow") return null;
  audit(verdict.action === "block" ? "safety.block" : "safety.review", input, verdict);
  applyRemember(keys, verdict);
  if (verdict.action === "confirm") {
    return { kind: "hold", message: verdict.message, fingerprint: verdict.fingerprint, classKey: verdict.classKey, verdict };
  }
  return { kind: "stop", message: verdict.message, fingerprint: verdict.fingerprint, classKey: verdict.classKey, verdict };
}

/** Sync decision for a permission card. Off and shadow change nothing. */
export function safetyPermissionEffect(input: SafetyHoldInput): SafetyEffect | null {
  const mode = misuseGuardrailMode();
  if (mode === "off") return null;
  if (mode !== "enforce") {
    const verdict = reviewSafety(input, emptySafetyMemory());
    if (verdict.action !== "allow") audit("safety.shadow", input, verdict);
    return null;
  }
  const keys = bucketKeys(input);
  return effectOf(input, reviewSafety(input, snapshot(keys)), keys);
}

/** A person's message. A stop is a 403. Ordinary chat is unchanged. */
export function safetyHttpRefusal(input: SafetyHoldInput): { status: 403; code: "safety_blocked"; message: string } | null {
  const effect = safetyPermissionEffect({ ...input, surface: "message" });
  if (effect?.kind !== "stop") return null;
  return { status: 403, code: "safety_blocked", message: effect.message };
}

/** Before a tool runs. Null means the tool may run. A string is the refusal
 * or the safer path, and the tool does not run. */
export async function safetyToolHold(input: SafetyHoldInput): Promise<string | null> {
  const mode = misuseGuardrailMode();
  if (mode === "off") return null;
  const keys = bucketKeys(input);
  if (mode !== "enforce") {
    const verdict = reviewSafety(input, emptySafetyMemory());
    if (verdict.action !== "allow") audit("safety.shadow", input, verdict);
    return null;
  }
  const verdict = await reviewed(input, reviewSafety(input, snapshot(keys)));
  const effect = effectOf(input, verdict, keys);
  if (!effect || effect.kind === "allow") return null;
  if (effect.kind === "stop") return effect.message;
  if (!confirmer) return effect.message;
  let answer: SafetyAnswer;
  try {
    answer = await confirmer({
      threadId: input.threadId,
      botId: input.botId,
      tool: input.tool,
      summary: input.text.slice(0, 500),
      fingerprint: effect.fingerprint,
      classKey: effect.classKey,
    });
  } catch {
    answer = "deny";
  }
  if (answer === "allow") {
    applyAdmit(keys, effect.verdict);
    return null;
  }
  applyRemember(keys, { ...effect.verdict, action: "block", code: "final", message: SAFETY_REFUSAL_FINAL });
  return SAFETY_REFUSAL_FINAL;
}

export function safetySeal(input: { principalId?: string; threadId?: string; fingerprint: string; classKey?: string }): void {
  writeIds(bucketKeys(input), "final", safetySealIds(input));
}

export function safetyArm(requestId: string, row: Armed): void {
  armed.set(requestId, row);
}

/** The permission card settled. An explicit allow is consumed once. Denial
 * and expiry are final. */
export function safetySettleRequest(requestId: string, behavior: string, source?: string): void {
  const row = armed.get(requestId);
  if (!row) return;
  armed.delete(requestId);
  const keys = bucketKeys(row);
  if (behavior === "allow" && source === "user") {
    writeIds(keys, "admitted", safetyOfferIds(row));
    return;
  }
  writeIds(keys, "final", safetySealIds(row));
}

export function safetyRejectArmed(requestId: string): void {
  safetySettleRequest(requestId, "deny", "user");
}

/** Whether a card waits under a safety hold (never replaced, 2026-10-20). */
export function safetyIsArmed(requestId: string): boolean {
  return armed.has(requestId);
}

export function safetyForgetArmed(requestId: string): void {
  armed.delete(requestId);
}

export function stashSafetyNote(requestId: string, note: string): void {
  notes.set(requestId, note);
}

export function takeSafetyNote(requestId: string): string | undefined {
  const note = notes.get(requestId);
  notes.delete(requestId);
  return note;
}

/** A card for a tool the engine will not ask about itself. */
export function openSafetyHold(timeoutMs = 9 * 60_000): { requestId: string; answer: Promise<SafetyAnswer> } {
  const requestId = randomUUID();
  let resolve!: (answer: SafetyAnswer) => void;
  const answer = new Promise<SafetyAnswer>((res) => { resolve = res; });
  const timer = setTimeout(() => {
    if (!holds.delete(requestId)) return;
    resolve("timeout");
  }, timeoutMs);
  timer.unref?.();
  holds.set(requestId, { resolve, timer });
  return { requestId, answer };
}

export function settleSafetyHold(requestId: string, behavior: "allow" | "deny"): boolean {
  const hold = holds.get(requestId);
  if (!hold) return false;
  holds.delete(requestId);
  clearTimeout(hold.timer);
  hold.resolve(behavior === "allow" ? "allow" : "deny");
  return true;
}

export type { SafetySurface };
