import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { EventBus } from "./bus.ts";
import { SpecialTokenFilter } from "./special-token-filter.ts";

const base = { provider: "acp", providerInstanceId: "grok", threadId: "t1", turnId: "turn-1", createdAt: "2026-11-06T21:02:00.000Z" };
const delta = (text: string, n = 0): RuntimeEvent => ({ ...base, eventId: `d${n}`, type: "content.delta", streamKind: "assistant_text", itemId: "i1", delta: text }) as RuntimeEvent;
const completed = (text: string): RuntimeEvent => ({ ...base, eventId: "c", type: "item.completed", itemType: "assistant_text", text }) as RuntimeEvent;
const turnDone = (): RuntimeEvent => ({ ...base, eventId: "end", type: "turn.completed" }) as RuntimeEvent;

const run = (events: RuntimeEvent[]) => {
  const filter = new SpecialTokenFilter();
  return events.flatMap((event) => filter.filter(event));
};
const text = (events: RuntimeEvent[]) => events.map((e) => (e.type === "content.delta" ? e.delta : "")).join("");

describe("SpecialTokenFilter", () => {
  it("publishes no reply that is only <|eos|>, streamed or whole, and the turn still ends", () => {
    const out = run([delta("<|eos|>"), completed("<|eos|>"), turnDone()]);
    expect(out.map((e) => e.type)).toEqual(["turn.completed"]);
  });

  it("drops a trailing token split across deltas and keeps the words", () => {
    const out = run([delta("Voilà, c'est envoyé.", 1), delta("<|e", 2), delta("os|>", 3), completed("Voilà, c'est envoyé.<|eos|>"), turnDone()]);
    expect(text(out)).toBe("Voilà, c'est envoyé.");
    expect(out.find((e) => e.type === "item.completed")).toMatchObject({ text: "Voilà, c'est envoyé." });
  });

  it.each(["<|eot_id|>", "<|im_end|>", "<|endoftext|>", "</s>"])("drops %s too", (token) => {
    const out = run([completed(`Fait.${token}`), completed(token)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: "Fait." });
  });

  it("releases held text that was not a token when the stream ends", () => {
    expect(text(run([delta("x <", 1), turnDone()]))).toBe("x <");
  });

  it("leaves ordinary replies and code blocks untouched", () => {
    const block = "```\n<|eos|>\n```";
    const out = run([delta(block), completed(block), turnDone()]);
    expect(text(out)).toBe(block);
    expect(out.find((e) => e.type === "item.completed")).toMatchObject({ text: block });
  });

  it("the bus delivers no assistant text for a reply of only <|eos|>", () => {
    const bus = new EventBus(() => {});
    const seen: RuntimeEvent[] = [];
    bus.subscribe((event) => seen.push(event));
    for (const event of [delta("<|eos|>"), completed("<|eos|>"), turnDone()]) bus.publish(event);
    expect(seen.map((e) => e.type)).toEqual(["turn.completed"]);
  });
});
