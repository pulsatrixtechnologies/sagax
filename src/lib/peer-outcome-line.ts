// #4238: what a teammate's request concluded for the person, as the chat
// says it: the one line ("From [face] Nova · 2 things need you, 1 thing to
// know") and, behind the "Asked by" line, each request's outcome.
import type { Message } from "@/state/store";
import type { PeerOutcome } from "../../shared/peer-outcome";

export interface PeerOutcomeCounts {
  /** Items that need the person (a question, a permission to grant). */
  needs: number;
  /** Facts they should know. */
  know: number;
}

export function peerOutcomeCounts(outcome: Pick<PeerOutcome, "items">): PeerOutcomeCounts {
  // an item the person already answered no longer needs them
  const needs = outcome.items.filter((item) => item.kind !== "tell" && !item.answered).length;
  return { needs, know: outcome.items.filter((item) => item.kind === "tell").length };
}

/** The one line's row: a bot text row carrying a line outcome. */
export function isPeerOutcomeLine(message: Pick<Message, "role" | "kind"> & { peerOutcome?: PeerOutcome }): boolean {
  return message.role === "bot" && message.kind === "text" && message.peerOutcome?.line === true;
}
