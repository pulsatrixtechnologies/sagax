import type { PageSourceChange, PageSourceDigest } from "../pages/published-pages.ts";
import type { Message } from "../store.ts";

/** What these calls need of the store (server/store.ts Store satisfies it). */
export interface AgentCardStore {
  groupByThread(threadId: string): unknown;
  messagesFor(threadId: string): Message[];
  appendMessage(threadId: string, message: Omit<Message, "id" | "at">): Message;
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null;
}

export type AgentCardResult =
  /** `masked`: something in the widget read as a secret and was stored masked.
   * `answered` (#1905): an ask_choice that asked for permission under Full
   * access, answered with its recommended option; the card is settled.
   * `waitsForPerson` (2026-11-03): an ask_choice raised as a real question
   * card (chat-widgets.ts raiseQuestion); the run waits for the answer.
   * `auto` / `targets` (#2048): choose_page_target resolved without a card,
   * or listed the offers on a waiting card. */
  | {
      ok: true;
      messageId: string;
      masked?: true;
      pageId?: string;
      version?: number;
      /** #3488: propose_page, the stored source's size in bytes and SHA-256. */
      bytes?: number;
      sha256?: string;
      /** #3488: what the bot gave, when the stored source differs, and why. */
      given?: PageSourceDigest;
      changedBy?: PageSourceChange[];
      answered?: { choice: string; question: string };
      waitsForPerson?: true;
      /** #4205: ask_choice with a key that had a pending card: replaced in
       * place. `retired`: how many cards a retire closed (0 or 1). `holds`
       * false: the card was raised with wait false and holds nothing. */
      replaced?: true;
      retired?: number;
      holds?: false;
      /** #4205: the card holds this turn and the engine cannot take the
       * answer live, so the turn ends at the end of this call
       * (approvals/card-turn-handoff.ts cardPosted): no further call runs. */
      turnEnds?: true;
      /** #4219: the room card is addressed to this person (display name);
       * `people`: the room's people the bot can address, in one line. */
      addressedTo?: string;
      people?: string;
      /** #4219: a routine run's card raised in its source room: the room's
       * name (its answer arrives as a turn there, not in the run). */
      inRoom?: string;
      /** #4238: a tell, recorded for the person's outcome (no card), or,
       * outside work the person did not start, to be said in the reply.
       * `toPerson`: the card went to the person's own conversation with
       * this bot (a teammate's exchange stays between the bots). */
      told?: true;
      note?: string;
      toPerson?: true;
      /** #4238: the person already answered or put away this item's card
       * (their answer, empty when they put it away): no second card. */
      alreadyAnswered?: string;
      auto?: { id: string; tool: string; name: string; description: string; icon?: string; reason: "single" | "default" };
      targets?: Array<{ id: string; tool: string; name: string; description: string; available: boolean; icon?: string; reason?: string }>;
    }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };
