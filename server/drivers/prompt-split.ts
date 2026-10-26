// The stable/volatile prompt split, shared by the drivers that deliver it.
// The stable half is everything that must stay byte-identical for a
// provider's cached prefix (or a spawned CLI's session contract) to
// survive; the volatile half (the sections in VOLATILE_SECTIONS,
// system-prompt.ts) legitimately changes mid-conversation and reaches the
// model inside the turn that changed it, after the cacheable prefix.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import { writeFileAtomic } from "../atomic.ts";
import type { SendTurnInput } from "../contracts.ts";

/** The halves of a turn's system prompt. The stable half is null for a
 * legacy single-block turn, so callers keep their pre-split behaviour. */
export interface PromptHalves {
  stable: string | null;
  volatile: string;
}

/** Read the split off a turn. Both halves must be present: a driver that
 * receives only the unsplit system field was called through a path that
 * never split it. */
export function promptHalves(
  turn: Pick<SendTurnInput, "system" | "systemStable" | "systemVolatile">,
): PromptHalves {
  const { systemStable, systemVolatile } = turn;
  if (typeof systemStable !== "string" || typeof systemVolatile !== "string") {
    return { stable: null, volatile: "" };
  }
  return { stable: systemStable, volatile: systemVolatile };
}

export const VOLATILE_CONTEXT_NOTE_PREFIX =
  "Context from Sagax updated since this conversation started; it replaces any earlier copy:";

export const VOLATILE_CONTEXT_CLEARED_NOTE =
  "The Sagax context notes from earlier in this conversation have been cleared; the standing instructions still apply.";

/** The labelled block that carries a changed volatile half inside a user
 * turn. A half that is empty and always was needs no note; one that was
 * cleared announces the removal so the model stops relying on it. */
export function volatileContextNote(volatile: string, hadVolatile: boolean): string {
  const text = volatile.trim();
  if (text) return VOLATILE_CONTEXT_NOTE_PREFIX + "\n\n" + text;
  return hadVolatile ? VOLATILE_CONTEXT_CLEARED_NOTE : "";
}

/** Prepend a delivered note to the turn text: the one composition shape
 * every split-aware driver uses. */
export function withContextNote(note: string, text: string): string {
  if (!note) return text;
  return text ? note + "\n\n" + text : note;
}

/** Fingerprints of the halves a durable native session last carried. */
export interface PromptSplitReceipt {
  stable: string;
  volatile: string;
  /** Turns delivered since the full prompt last rode. Re-anchor
   * bookkeeping; absent on receipts written before the counter existed. */
  turnsSinceFull?: number;
  /** Last reported context size, for compaction detection; absent on
   * receipts written before it existed. */
  lastUsed?: number;
  /** Highest reported context size since the last detected compaction. */
  peakUsed?: number;
  /** Fingerprint of each volatile section by id, so a later turn re-sends
   * only the sections that changed. Absent on receipts written before it
   * existed (the whole volatile half is then re-sent once, as before). */
  sections?: Record<string, string>;
}

/** One volatile section of a turn's system prompt (system-prompt.ts). */
export interface VolatileSection {
  id: string;
  text: string;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const EMPTY_FINGERPRINT = digest("");

export function promptSplitFingerprints(stable: string, volatile: string): PromptSplitReceipt {
  return { stable: digest(stable), volatile: digest(volatile) };
}

/** Fingerprints of the volatile sections that carry text, by id. */
export function sectionFingerprints(sections: readonly VolatileSection[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const section of sections) if (section.text.trim()) out[section.id] = digest(section.text);
  return out;
}

export const VOLATILE_SECTIONS_NOTE_PREFIX =
  "Context from Sagax updated since your last copy. Each section below replaces its earlier copy; sections not listed here are unchanged:";

/** The note for a volatile half of which only some sections changed: just
 * those sections, and one line per section that went away. Every section is
 * self-contained, so a model that keeps the newest copy of each has the
 * whole current context without the unchanged ones riding again. Null when
 * nothing section-level differs (the caller then falls back to the whole
 * half). */
export function changedSectionsNote(
  sections: readonly VolatileSection[],
  previous: Record<string, string>,
): string | null {
  const current = sectionFingerprints(sections);
  const changed = sections.filter((section) => current[section.id] !== undefined && previous[section.id] !== current[section.id]);
  const removed = Object.keys(previous).filter((id) => current[id] === undefined);
  if (!changed.length && !removed.length) return null;
  const parts = changed.map((section) => section.text.trim());
  for (const id of removed) parts.push(`(The earlier "${id}" context section no longer applies.)`);
  return VOLATILE_SECTIONS_NOTE_PREFIX + "\n\n" + parts.join("\n\n");
}

/** The sections a turn's note describes even when their text is the same
 * as last turn's: the mentions section names the message being sent now,
 * and the phone-call section marks an interrupted call turn (both set
 * SendTurnInput.mentionTurn). */
const PER_TURN_SECTIONS: readonly string[] = ["mentions", "voice-call"];

/** What a reused session should be told about its volatile half, for every
 * driver that keeps one session per thread (2026-10-19 perf parity, point
 * 4): only the sections added or changed since the copy the session holds,
 * plus one line per section that went away; nothing when nothing changed.
 * `previous` is the fingerprints (sectionFingerprints) of the copy the
 * session holds, or undefined when unknown (a new process, a compaction, a
 * receipt from before sections were tracked): the caller then sends the
 * whole half, as before. On a mention turn the mentions section rides even
 * when unchanged. Returns null when the section diff cannot describe the
 * change (the caller falls back to the whole half), "" when nothing needs
 * to be said. */
export function volatileSectionsUpdate(
  sections: readonly VolatileSection[] | undefined,
  previous: Record<string, string> | undefined,
  perTurnVolatile = false,
): string | null {
  if (!sections || !previous) return null;
  const base = perTurnVolatile
    ? Object.fromEntries(Object.entries(previous).filter(([id]) => !PER_TURN_SECTIONS.includes(id)))
    : previous;
  return changedSectionsNote(sections, base) ?? "";
}

/** The per-section change from `previous` to `current` fingerprints: the
 * new print of each added or changed section (and of the mentions section
 * on a mention turn), null for each section that went away. Mirrors what
 * volatileSectionsUpdate writes into its note. */
export function sectionDelta(
  current: Record<string, string>,
  previous: Record<string, string>,
  perTurnVolatile = false,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [id, print] of Object.entries(current)) {
    if (previous[id] !== print || (perTurnVolatile && PER_TURN_SECTIONS.includes(id))) out[id] = print;
  }
  for (const id of Object.keys(previous)) if (current[id] === undefined) out[id] = null;
  return out;
}

const receiptPath = (scope: string, key: string) =>
  join(DATA_DIR, "prompt-split", digest(JSON.stringify([scope, key])) + ".json");

/** Which halves a native session (an ACP session id, a pi session file)
 * last carried. Unknown - never tracked, or tracked before this file
 * existed - reads as null, and the caller re-delivers the full prompt
 * once. */
function validSections(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((print) => typeof print === "string");
}

export function readPromptSplitReceipt(scope: string, key: string): PromptSplitReceipt | null {
  try {
    const raw = JSON.parse(readFileSync(receiptPath(scope, key), "utf8")) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const record = raw as { stable?: unknown; volatile?: unknown; turnsSinceFull?: unknown; lastUsed?: unknown; peakUsed?: unknown; sections?: unknown };
      if (typeof record.stable === "string" && typeof record.volatile === "string") {
        return {
          stable: record.stable,
          volatile: record.volatile,
          ...(typeof record.turnsSinceFull === "number" ? { turnsSinceFull: record.turnsSinceFull } : {}),
          ...(typeof record.lastUsed === "number" && record.lastUsed > 0 ? { lastUsed: record.lastUsed } : {}),
          ...(typeof record.peakUsed === "number" && record.peakUsed > 0 ? { peakUsed: record.peakUsed } : {}),
          ...(validSections(record.sections) ? { sections: record.sections } : {}),
        };
      }
    }
  } catch {
    /* a missing or corrupt receipt is simply unknown */
  }
  return null;
}

export function writePromptSplitReceipt(scope: string, key: string, receipt: PromptSplitReceipt): void {
  mkdirSync(join(DATA_DIR, "prompt-split"), { recursive: true });
  writeFileAtomic(receiptPath(scope, key), JSON.stringify(receipt), { mode: 0o600 });
}

/** Drop a session's receipt: its history was rewritten (pi compaction
 * summarizes older messages), so what it last carried is unknown and the
 * next turn re-delivers the full prompt. A missing receipt already reads
 * as unknown, so deleting one is always safe. */
export function deletePromptSplitReceipt(scope: string, key: string): void {
  try {
    rmSync(receiptPath(scope, key));
  } catch {
    /* a missing receipt is already unknown */
  }
}

/** Compose the prompt for a session that persists its own history (ACP
 * agents, pi): the full system block rides only when this native session
 * has not carried it - or carried a different one, which re-delivers the
 * current copy the way a pre-split turn always did - and a changed
 * volatile half rides as a labelled note. Otherwise the turn text goes
 * through bare, so an ordinary memory write neither appends a second copy
 * of the prompt to the session nor re-prices its cached prefix.
 * perTurnVolatile marks a turn whose volatile half describes this very
 * turn (a mention): its note is delivered even when the text is unchanged.
 * reAnchorAfterTurns, when positive, re-sends the full prompt after that
 * many consecutive bare turns: a session that rewrites its own history
 * without an observable event (an older pi, a missed compaction) still
 * gets its standing instructions back within a bounded number of turns.
 * volatileSections, when given, lets a later turn re-send only the volatile
 * sections that changed (one recent-work line moving no longer re-sends the
 * whole memory notebook into the session's history every turn). */
export function splitSessionPrompt(
  stable: string,
  volatile: string,
  previous: PromptSplitReceipt | null,
  fullSystem: string | undefined,
  text: string,
  perTurnVolatile = false,
  reAnchorAfterTurns = 0,
  volatileSections?: readonly VolatileSection[],
): { text: string; receipt: PromptSplitReceipt } {
  const fingerprints: PromptSplitReceipt = {
    ...promptSplitFingerprints(stable, volatile),
    ...(volatileSections ? { sections: sectionFingerprints(volatileSections) } : {}),
  };
  // Legacy receipts predate the turn counter; count them from zero.
  const turnsSinceFull = typeof previous?.turnsSinceFull === "number" ? previous.turnsSinceFull : 0;
  const reAnchor = reAnchorAfterTurns > 0 && previous !== null && turnsSinceFull >= reAnchorAfterTurns;
  if (previous === null || previous.stable !== fingerprints.stable || reAnchor) {
    return { text: fullSystem ? fullSystem + "\n\n" + text : text, receipt: { ...fingerprints, turnsSinceFull: 0 } };
  }
  const sectionNote = previous.volatile !== fingerprints.volatile && !perTurnVolatile && volatileSections && previous.sections
    ? changedSectionsNote(volatileSections, previous.sections)
    : null;
  const note = previous.volatile === fingerprints.volatile && !perTurnVolatile
    ? ""
    : sectionNote ?? volatileContextNote(volatile, previous.volatile !== EMPTY_FINGERPRINT);
  return { text: withContextNote(note, text), receipt: { ...fingerprints, turnsSinceFull: turnsSinceFull + 1 } };
}
