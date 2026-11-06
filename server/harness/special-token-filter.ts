// Chat-template control tokens (`<|eos|>`, `<|im_end|>`, `</s>`...) a model
// wrote as text, taken out of every engine's reply where all of them meet:
// the event bus. #2350 cleaned the OpenAI-compatible driver only; a Grok bot
// on another engine still posted a bubble that read "<|eos|>" (2026-11-06),
// and so did its bot to bot messages. A reply that is nothing but tokens is
// no reply: its item.completed is dropped, so no bubble, notification or
// message to another bot is written, and the turn ends as one that said
// nothing (shared/chat-special-tokens.ts).
import { ChatSpecialTokenStream, stripChatSpecialTokens } from "../../shared/chat-special-tokens.ts";
import { newId, type RuntimeEvent } from "../contracts.ts";

type TextDelta = Extract<RuntimeEvent, { type: "content.delta" }>;

function streamKey(event: TextDelta): string {
  return [event.providerInstanceId ?? "", event.turnId ?? "", event.itemId ?? "", event.streamKind, event.synthetic ? "1" : ""].join("\u0000");
}

export class SpecialTokenFilter {
  /** Per thread: each open text stream, with the last delta that names it. */
  private streams = new Map<string, Map<string, { last: TextDelta; stream: ChatSpecialTokenStream }>>();

  /** The events to publish in place of this one, in order: none when it
   * carried only control tokens, and first the text a stream still held
   * when anything else happens on its thread. */
  filter(event: RuntimeEvent): RuntimeEvent[] {
    if (event.type === "content.delta") {
      let open = this.streams.get(event.threadId);
      if (!open) {
        open = new Map();
        this.streams.set(event.threadId, open);
      }
      const key = streamKey(event);
      let entry = open.get(key);
      if (!entry) {
        entry = { last: event, stream: new ChatSpecialTokenStream() };
        open.set(key, entry);
      }
      entry.last = event;
      const delta = entry.stream.feed(event.delta);
      return delta ? [delta === event.delta ? event : { ...event, delta }] : [];
    }
    const out = this.finishThread(event.threadId);
    if (event.type === "item.completed" && event.itemType === "assistant_text" && typeof event.text === "string") {
      const text = stripChatSpecialTokens(event.text);
      if (text !== event.text) {
        if (!text.trim() && event.text.trim()) return out;
        out.push({ ...event, text });
        return out;
      }
    }
    out.push(event);
    return out;
  }

  /** What every stream of the thread still held, as deltas; the streams end. */
  private finishThread(threadId: string): RuntimeEvent[] {
    const open = this.streams.get(threadId);
    if (!open) return [];
    this.streams.delete(threadId);
    const out: RuntimeEvent[] = [];
    for (const { last, stream } of open.values()) {
      const rest = stream.finish();
      if (rest) out.push({ ...last, eventId: newId(), delta: rest });
    }
    return out;
  }
}
