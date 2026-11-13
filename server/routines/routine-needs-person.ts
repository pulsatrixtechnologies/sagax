/** #4098: what of a routine waits on the person (`Routine.needsPerson`),
 * written by the server on the routine as the wire carries it
 * (routineOnWire: GET /api/routines and the `routine` frame) so the bot
 * page's Outcomes tab and the chat never disagree.
 *
 * It is a reading of verdicts that already exist, never a rule of its own:
 * - a question or approval card of a waiting run still open: the check the
 *   row gate reads (routineRunNeedsPerson, openCardIn), never one waiting
 *   on teammates;
 * - items only the person can do on a run's row (shared/person-attention.ts),
 *   open until handled or until the person wrote after them, as Today reads
 *   them (attentionSettledBy), found by the store's index of open waiting
 *   rows, never by reading a transcript;
 * - the problem streak the chat told (the routine manager's problemToldAt)
 *   and no good run since; a pause after failures; a goal past its deadline
 *   or stalled: the one rule in shared/outcomes.ts routineNeed, with these
 *   facts.
 *
 * It clears the moment its fact does: RoutineNeedsWatch re-reads every
 * routine after a run changes or a card, an item or the person's own line
 * lands in a conversation, and sends the `routine` frame of each routine
 * whose need changed. */
import { routineNeed } from "../../shared/outcomes.ts";
import type { PersonAttentionCard } from "../../shared/person-attention.ts";
import type { RoutineNeedsPerson } from "../../shared/routines.ts";
import { attentionSettledBy } from "../approvals/today-rows.ts";
import type { Routine, RoutineRun } from "./routines.ts";

/** A row that may still wait on the person (the store's open waiting rows). */
export interface RoutineOpenRow {
  threadId: string;
  message: { id: string; at: number; role?: string; kind?: string; attention?: PersonAttentionCard };
}

export type RoutineRunItems = ReadonlyMap<string, { text: string; since: number }>;

/** The items of each run still open, by run id: an attention card of a
 * routine run (on the run's own row or a card of its own) neither handled
 * nor answered by a later line of the person. Its sentence is its items,
 * plain. */
export function openRunItems(rows: readonly RoutineOpenRow[], wroteAfter: (threadId: string, at: number) => boolean): Map<string, { text: string; since: number }> {
  const out = new Map<string, { text: string; since: number }>();
  for (const { threadId, message } of rows) {
    const card = message.attention;
    const runId = card?.routineRunId;
    if (!card || !runId || card.handledAt || !card.items?.length) continue;
    if (attentionSettledBy({ wroteAfter }, threadId, message)) continue;
    const text = card.items.map((entry) => entry.text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim()).filter(Boolean).join("; ");
    const known = out.get(runId);
    if (!known || message.at < known.since) out.set(runId, { text, since: message.at });
  }
  return out;
}

/** A row written or patched in a conversation that may move a routine's
 * need: the person's own line (it settles items before it), items for the
 * person, a card (opened, answered, dismissed or expired) or a run's row. */
export function routineNeedMayMove(message: { role?: string; kind?: string; attention?: unknown; card?: unknown } | null | undefined): boolean {
  if (!message) return false;
  return message.role === "user" || Boolean(message.attention) || Boolean(message.card) || message.kind === "routine.run";
}

export interface RoutineNeedsDeps {
  /** The routine's runs, as stored. */
  runsOf(routineId: string): readonly RoutineRun[];
  /** A waiting run's card is still open (routineRunNeedsPerson). */
  cardOpen(run: RoutineRun): boolean;
  /** The run of its problem streak that tells the person. */
  problemToldAt(routine: Routine): number;
  now(): number;
}

/** The server's verdict for one routine: null when nothing waits on the
 * person. */
export function routineNeedsPerson(routine: Routine, deps: RoutineNeedsDeps, items: RoutineRunItems): RoutineNeedsPerson | null {
  return routineNeed(routine, deps.runsOf(routine.id), deps.now(), {
    cardOpen: (run) => deps.cardOpen(run),
    openItems: (run) => items.get(run.id),
    problemToldAt: deps.problemToldAt(routine),
  }) ?? null;
}

export interface RoutineNeedsWatchDeps {
  /** Every routine, as the manager lists it. */
  routines(): readonly Routine[];
  /** Its need now (routineNeedsPerson with the server's facts). */
  need(routine: Routine): RoutineNeedsPerson | null;
  /** Send its `routine` frame. */
  emit(routine: Routine): void;
  /** Run a pass soon (one pass for a burst of changes). */
  later(pass: () => void): void;
}

function needKey(need: RoutineNeedsPerson | null | undefined): string {
  return need ? JSON.stringify([need.kind, need.text, need.runId ?? "", need.since, need.failures ?? 0, need.goal ?? "", need.checks ?? 0]) : "";
}

/** Keeps each routine's `needsPerson` on the live frames as fresh as the
 * chat: what was last sent per routine, and one pass after a change that
 * may move it. */
export class RoutineNeedsWatch {
  private readonly sent = new Map<string, string>();
  private due = false;
  private readonly deps: RoutineNeedsWatchDeps;

  constructor(deps: RoutineNeedsWatchDeps) {
    this.deps = deps;
  }

  /** A `routine` frame went out with this need. */
  noteSent(routineId: string, need: RoutineNeedsPerson | null | undefined): void {
    this.sent.set(routineId, needKey(need));
  }

  /** Something that may move a need happened: one pass soon. */
  touch(): void {
    if (this.due) return;
    this.due = true;
    this.deps.later(() => {
      this.due = false;
      this.pass();
    });
  }

  /** Read every routine's need; send the frame of each that changed. */
  pass(): void {
    const seen = new Set<string>();
    for (const routine of this.deps.routines()) {
      seen.add(routine.id);
      const key = needKey(this.deps.need(routine));
      if ((this.sent.get(routine.id) ?? "") === key) continue;
      this.sent.set(routine.id, key);
      this.deps.emit(routine);
    }
    for (const id of this.sent.keys()) if (!seen.has(id)) this.sent.delete(id);
  }
}
