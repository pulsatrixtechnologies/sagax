import { stripChatSpecialTokens } from "../../shared/chat-special-tokens";

type ShownMessage = { role: string; kind: string; text?: string; attachments?: readonly unknown[] };

/** A conversation as shown: a bot's reply already stored with a control token
 * a model wrote as text (`<|eos|>`, 2026-11-06) shows without it, and one that
 * was nothing but tokens does not show. The stored rows stay as they were.
 * The same array comes back when no reply carries one. */
export function withoutLeakedTokens<T extends ShownMessage>(messages: T[]): T[] {
  let out: T[] | null = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const text = m.role === "bot" && m.kind === "text" && typeof m.text === "string" && m.text.includes("<") ? stripChatSpecialTokens(m.text) : m.text;
    if (text === m.text) {
      out?.push(m);
      continue;
    }
    out ??= messages.slice(0, i);
    if (text?.trim() || m.attachments?.length) out.push({ ...m, text });
  }
  return out ?? messages;
}
