import type { Message } from "./store.ts";

/** What these calls need of the store (server/store.ts Store satisfies it). */
export interface AgentCardStore {
  groupByThread(threadId: string): unknown;
  messagesFor(threadId: string): Message[];
  appendMessage(threadId: string, message: Omit<Message, "id" | "at">): Message;
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null;
}

export type AgentCardResult =
  /** `masked`: something in the widget read as a secret and was stored masked. */
  | { ok: true; messageId: string; masked?: true; pageId?: string; version?: number }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };
