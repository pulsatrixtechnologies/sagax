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
   * card (chat-widgets.ts raiseQuestion); the run waits for the answer. */
  | { ok: true; messageId: string; masked?: true; pageId?: string; version?: number; answered?: { choice: string; question: string }; waitsForPerson?: true }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };
