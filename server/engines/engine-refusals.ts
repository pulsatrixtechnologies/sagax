// Account-scoped memory of provider refusals. Never stores provider text or
// credentials. A sign-out is also kept on disk (persistSignedOutHolds), so a
// restart, an update or a sleep never sends the next conversation back to an
// engine that is known to be signed out (#3315, port of OpenMausBot #3907).
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "../atomic.ts";
import { reportBackgroundError } from "../background-error.ts";

export interface EngineRefusal {
  engine: string;
  account?: string;
  cause: "credits" | "usage_limit" | "signed_out";
  resetsAt?: number;
  at: number;
}
export const ENGINE_REFUSAL_TTL_MS = 30 * 60_000;
/** A signed-out engine is tried again by a new turn no sooner than this after
 * its last refusal, in case it was signed in again some way Sagax did not see
 * (a status read can say signed in while its turns are refused); a sign-in
 * finished in the app, a status read that turns from signed out to signed in,
 * or a turn on it that works ends the hold at once. */
export const SIGNED_OUT_RECHECK_MS = 60 * 60_000;
/** A sign-out is said once for its whole stretch; past this it is forgotten. */
export const SIGNED_OUT_STRETCH_MS = 30 * 24 * 60 * 60_000;

/** `told`: what this stretch of a sign-out already said (its notice, its incident). */
type Kept = EngineRefusal & { told?: string[] };
const refusals = new Map<string, Kept>();
const key = (engine: string, account?: string) => JSON.stringify([engine, account ?? ""]);
let holdsFile: string | null = null;
/** #4233: told when an engine account works again (a completed turn, a
 * verified sign-in), so what was said about its refusal can be taken back.
 * `signedInOnly`: only a sign-in was seen (a credit refusal still stands). */
type WorksAgain = (engine: string, account: string | undefined, signedInOnly: boolean) => void;
const worksAgain = new Set<WorksAgain>();
/** Listen for an engine account working again; returns the unsubscribe. */
export function onEngineWorksAgain(listener: WorksAgain): () => void {
  worksAgain.add(listener);
  return () => { worksAgain.delete(listener); };
}
function tellWorksAgain(engine: string, account: string | undefined, signedInOnly: boolean): void {
  for (const listener of worksAgain) {
    try { listener(engine, account, signedInOnly); } catch (error) { reportBackgroundError(error); }
  }
}

function save(): void {
  if (!holdsFile) return;
  const rows = [...refusals.values()].filter((row) => row.cause === "signed_out")
    .map(({ engine, account, at, told }) => ({ engine, ...(account !== undefined ? { account } : {}), at, ...(told?.length ? { told } : {}) }));
  try {
    writeFileAtomic(holdsFile, JSON.stringify(rows), { mode: 0o600 });
  } catch (error) {
    reportBackgroundError(error);
  }
}

/** Keeps sign-outs in `file` from now on, and brings back the ones a previous
 * run saved that are still within their stretch. `file` null: memory only. */
export function persistSignedOutHolds(file: string | null, now = Date.now()): void {
  holdsFile = file;
  if (!file) return;
  let saved: unknown;
  try { saved = JSON.parse(readFileSync(file, "utf8")); } catch { return; }
  if (!Array.isArray(saved)) return;
  for (const row of saved as Array<Partial<Kept> | null>) {
    if (typeof row?.engine !== "string" || typeof row.at !== "number" || !Number.isFinite(row.at) || row.at <= now - SIGNED_OUT_STRETCH_MS) continue;
    const account = typeof row.account === "string" ? row.account : undefined;
    const id = key(row.engine, account);
    if ((refusals.get(id)?.at ?? -Infinity) > row.at) continue;
    const told = Array.isArray(row.told) ? row.told.filter((what): what is string => typeof what === "string") : [];
    refusals.set(id, { engine: row.engine, ...(account !== undefined ? { account } : {}), cause: "signed_out", at: row.at, ...(told.length ? { told } : {}) });
  }
}

export function noteEngineRefusal(refusal: EngineRefusal): void {
  const id = key(refusal.engine, refusal.account);
  const earlier = refusals.get(id);
  if ((earlier?.at ?? -Infinity) > refusal.at) return;
  // Another refusal of the same sign-out is the same stretch: what it said stands.
  const told = earlier?.cause === "signed_out" && refusal.cause === "signed_out" ? earlier.told : undefined;
  refusals.delete(id);
  refusals.set(id, { ...refusal, ...(told ? { told } : {}) });
  if (refusals.size > 2_000) refusals.delete(refusals.keys().next().value!);
  if (refusal.cause === "signed_out" || earlier?.cause === "signed_out") save();
}
export function activeEngineRefusal(engine: string, account: string | undefined, now: number): EngineRefusal | undefined {
  const id = key(engine, account);
  const refusal = refusals.get(id);
  if (!refusal) return undefined;
  const until = refusal.cause === "signed_out" ? refusal.at + SIGNED_OUT_STRETCH_MS
    : refusal.cause === "usage_limit" && refusal.resetsAt !== undefined ? refusal.resetsAt : refusal.at + ENGINE_REFUSAL_TTL_MS;
  if (now >= until) {
    refusals.delete(id);
    if (refusal.cause === "signed_out") save();
    return undefined;
  }
  const { told: _told, ...out } = refusal;
  return out;
}
/** A newer completed turn, or a verified sign-in, releases only this account. */
export function clearEngineRefusal(engine: string, account?: string, at = Date.now(), signedInOnly = false): void {
  const id = key(engine, account);
  const refusal = refusals.get(id);
  if (refusal && at >= refusal.at && (!signedInOnly || refusal.cause === "signed_out")) {
    refusals.delete(id);
    if (refusal.cause === "signed_out") save();
  }
  // A refusal past its time is already gone from memory: the card it left
  // still closes on the first turn that works (#4233).
  if (!refusal || at >= refusal.at) tellWorksAgain(engine, account, signedInOnly);
}
/** The engine is signed in again (a sign-in finished in the app, or its
 * status read turned from signed out to signed in): every sign-out kept for
 * it on an account `accounts` accepts ends, and its next one is a new stretch.
 * The number ended. */
export function clearSignedOut(engine: string, accounts: (account: string | undefined) => boolean = () => true): number {
  let ended = 0;
  for (const [id, refusal] of refusals) {
    if (refusal.engine !== engine || refusal.cause !== "signed_out" || !accounts(refusal.account)) continue;
    refusals.delete(id);
    ended += 1;
    tellWorksAgain(engine, refusal.account, true);
  }
  if (ended) save();
  return ended;
}
/** A new turn on this account goes to another engine: a sign-out it refused
 * within SIGNED_OUT_RECHECK_MS, or one whose status still reads signed out. */
export function signedOutHeld(engine: string, account: string | undefined, now: number, statusSignedOut = false): boolean {
  const refusal = activeEngineRefusal(engine, account, now);
  return refusal?.cause === "signed_out" && (statusSignedOut || now - refusal.at < SIGNED_OUT_RECHECK_MS);
}
/** True once per stretch of this sign-out for `what` ("notice", "incident"):
 * the person hears it once, not once a turn. False with no sign-out kept. */
export function firstSignedOut(engine: string, account: string | undefined, what: string): boolean {
  const refusal = refusals.get(key(engine, account));
  if (refusal?.cause !== "signed_out" || refusal.told?.includes(what)) return false;
  refusal.told = [...(refusal.told ?? []), what];
  save();
  return true;
}
