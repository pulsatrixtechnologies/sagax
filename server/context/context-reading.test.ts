import { describe, expect, it } from "vitest";
import { nextContext } from "./context-reading.ts";

describe("context reading", () => {
  it("keeps the model's tokens and window, and the measured prompt size", () => {
    expect(nextContext(undefined, { tokens: 142_000, window: 200_000, promptBytes: 21_396 })).toEqual({
      tokens: 142_000, window: 200_000, promptBytes: 21_396,
    });
  });

  it("does not invent a token total from a prompt size alone", () => {
    expect(nextContext(undefined, { promptBytes: 100 })).toBeUndefined();
    expect(nextContext(undefined, { tokens: 0, window: 200_000 })).toBeUndefined();
  });

  it("keeps the previous reading when this turn reported no context, and refreshes the prompt size", () => {
    const prev = { tokens: 100, window: 1000, promptBytes: 10 };
    expect(nextContext(prev, { tokens: 0, promptBytes: 40 })).toEqual({ tokens: 100, window: 1000, promptBytes: 40 });
    expect(nextContext(prev, {})).toEqual(prev);
    expect(nextContext(undefined, { buckets: { messages: 4, prompt: 10 } })).toBeUndefined();
    expect(nextContext(prev, { tokens: 0, buckets: { messages: 4, tools: 0 } })).toEqual({ ...prev, buckets: { messages: 4 } });
    expect(nextContext({ ...prev, buckets: { messages: 2 } }, { tokens: 50 })).toEqual({ tokens: 50, promptBytes: 10, buckets: { messages: 2 } });
  });
});
