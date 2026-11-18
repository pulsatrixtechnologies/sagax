// Approval cards that outlived a restart.
//
// #4528: the card on the transcript is the saved ask. A restart no longer
// expires it. The person's answer starts one turn in the same session
// (server/index-leaves/deliverLatePermission.ts). A card that has waited
// past its age limit still expires on the hourly sweep. The startup caller
// in server/index.ts keeps this function; it closes nothing.
import type { Message } from "../store.ts";

export interface StaleApproval {
  threadId: string;
  message: Message;
}

export interface ExpireDeps {
  open: () => StaleApproval[];
  patch: (threadId: string, messageId: string, card: NonNullable<Message["card"]>) => void;
  decide: (row: { threadId: string; requestId: string; tool?: string; summary?: string }) => void;
}

/** Kept for the startup caller. Returns 0: an open permission card survives
 * the boot so it can still be answered (#4528). */
export function expireApprovalsAfterRestart(deps: ExpireDeps): number {
  void deps;
  return 0;
}
