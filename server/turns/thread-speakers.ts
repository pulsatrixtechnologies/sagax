// #3609: whom a thread's turn speaks for (TurnSpeaker), kept with the
// thread. It is written to the thread's record when a turn is admitted and
// read back from it by a process that does not know the thread yet (after a
// restart, clean or not), so a continuation of that thread (a delegation
// wake, a card resume, the runtime's rerun of a root that waited on a
// teammate) speaks for the same person, group, routine lineage and peer
// source as the turn it continues. One copy: the record; the map here is
// only what this process already read or wrote.
//
// What is kept is ids and small flags, never a token or a secret.

import type { RoutineOwnerAuthorization, TurnSpeaker } from "../engines/engine-access.ts";

/** Where a thread's speaker is kept (the thread's record in the store). */
export interface ThreadSpeakerRecords {
  read(threadId: string): unknown;
  /** Writes it with the thread; false when no record holds this thread (a room's). */
  write(threadId: string, speaker: TurnSpeaker): boolean;
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 && value.length <= 512 ? value : undefined);

function storedAuthorization(value: unknown): RoutineOwnerAuthorization | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const runId = text(raw.runId), routineId = text(raw.routineId), botId = text(raw.botId), principalId = text(raw.principalId);
  return runId && routineId && botId && principalId ? { runId, routineId, botId, principalId } : undefined;
}

/** The speaker as it is kept: only the known fields of a known origin, or
 * undefined for anything else (a record from an older or damaged file). */
export function storedTurnSpeaker(value: unknown): TurnSpeaker | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const principalId = text(raw.principalId);
  switch (raw.origin) {
    case "person": {
      const groupId = text(raw.groupId);
      return { origin: "person", ...(principalId ? { principalId } : {}), ...(groupId ? { groupId } : {}) };
    }
    case "operator": return { origin: "operator" };
    case "owner-routine": return { origin: "owner-routine", ...(principalId ? { principalId } : {}) };
    case "peer": {
      const fromBotId = text(raw.fromBotId), routinePayer = text(raw.routinePayer), routineTrigger = text(raw.routineTrigger);
      const routineOwnerAuthorization = storedAuthorization(raw.routineOwnerAuthorization);
      return {
        origin: "peer",
        ...(fromBotId ? { fromBotId } : {}),
        ...(principalId ? { principalId } : {}),
        ...(raw.routine === true ? { routine: true as const } : {}),
        ...(routinePayer ? { routinePayer } : {}),
        ...(routineTrigger ? { routineTrigger } : {}),
        ...(routineOwnerAuthorization ? { routineOwnerAuthorization } : {}),
      };
    }
    default: return undefined;
  }
}

/** Whether two speakers are the same once kept. */
export function sameStoredSpeaker(a: unknown, b: unknown): boolean {
  return JSON.stringify(storedTurnSpeaker(a) ?? null) === JSON.stringify(storedTurnSpeaker(b) ?? null);
}

/** The speakers of the threads, by thread id, reading through to the
 * threads' records. `restored` runs once for a speaker read back from a
 * record (never for one this process set), so what the admitted turn
 * derived from it (its principal, its routine lineage) is derived again. */
export class ThreadSpeakers {
  private readonly known = new Map<string, TurnSpeaker>();
  /** Threads whose record was already read (with or without a speaker). */
  private readonly read = new Set<string>();

  private readonly records: () => ThreadSpeakerRecords | undefined;
  private readonly restored: ((threadId: string, speaker: TurnSpeaker) => void) | undefined;

  constructor(records: () => ThreadSpeakerRecords | undefined, restored?: (threadId: string, speaker: TurnSpeaker) => void) {
    this.records = records;
    this.restored = restored;
  }

  get(threadId: string): TurnSpeaker | undefined {
    const known = this.known.get(threadId);
    if (known || this.read.has(threadId)) return known;
    const records = this.records();
    if (!records) return undefined;
    this.read.add(threadId);
    let speaker: TurnSpeaker | undefined;
    try { speaker = storedTurnSpeaker(records.read(threadId)); }
    catch (error) { console.error(`[thread-speaker] thread=${threadId} not read: ${error instanceof Error ? error.message : String(error)}`); }
    if (!speaker) return undefined;
    this.known.set(threadId, speaker);
    try { this.restored?.(threadId, speaker); }
    catch (error) { console.error(`[thread-speaker] thread=${threadId} not restored: ${error instanceof Error ? error.message : String(error)}`); }
    return speaker;
  }

  has(threadId: string): boolean {
    return this.get(threadId) !== undefined;
  }

  set(threadId: string, speaker: TurnSpeaker): this {
    this.known.set(threadId, speaker);
    this.read.add(threadId);
    const kept = storedTurnSpeaker(speaker);
    if (!kept) return this;
    try { this.records()?.write(threadId, kept); }
    catch (error) {
      // The turn goes on: this process still knows its speaker; only a
      // restart before the next successful save would not.
      console.error(`[thread-speaker] thread=${threadId} not saved: ${error instanceof Error ? error.message : String(error)}`);
    }
    return this;
  }
}

/** A map of what an admitted turn derived from its speaker (its principal,
 * its routine payer): a thread it does not hold yet is read through its
 * speaker first (`read`), which derives them again after a restart. */
export class SpeakerDerivedMap<V> extends Map<string, V> {
  private readThrough: ((threadId: string) => void) | undefined;
  constructor(read: (threadId: string) => void) {
    super();
    this.readThrough = read;
  }
  override get(threadId: string): V | undefined {
    if (!super.has(threadId)) this.readThrough?.(threadId);
    return super.get(threadId);
  }
  override has(threadId: string): boolean {
    if (!super.has(threadId)) this.readThrough?.(threadId);
    return super.has(threadId);
  }
}

/** The same, for a set of threads (a routine lineage). */
export class SpeakerDerivedSet extends Set<string> {
  private readThrough: ((threadId: string) => void) | undefined;
  constructor(read: (threadId: string) => void) {
    super();
    this.readThrough = read;
  }
  override has(threadId: string): boolean {
    if (!super.has(threadId)) this.readThrough?.(threadId);
    return super.has(threadId);
  }
}

/** A person speaker with no id: nobody whose sign-ins or files a turn may use. */
export function unknownPerson(speaker: TurnSpeaker): boolean {
  return speaker.origin === "person" && !speaker.principalId?.trim();
}
