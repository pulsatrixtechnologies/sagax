// The context and usage meter under the message box (owner 2026-11-25,
// M-20261125-070, M-20261125-072 to M-20261125-074, #5372): the context
// measure. A measure with no data is absent, never at zero. The usage
// measures are src/lib/usage-pill.test.ts (#5406).
import { describe, expect, it } from "vitest";

import { accountRowName } from "./plan-usage";
import { contextHalf } from "./composer-meter";

const usage = (tokens: number, size?: number) => ({ turns: 3, input: 10, output: 5, context: { tokens, ...(size ? { window: size } : {}) } }) as never;

describe("the context half", () => {
  it("is the share of the model's window this conversation uses, with the tokens of its detail", () => {
    expect(contextHalf(usage(84_000, 200_000), [])).toEqual({ percent: 42, tokens: 84_000, window: 200_000 });
  });

  it("is absent when the engine gives no window, when nothing was measured, and once the thread was compacted after its last reading", () => {
    expect(contextHalf(usage(84_000), [])).toBeNull();
    expect(contextHalf(undefined, [])).toBeNull();
    expect(contextHalf(usage(0, 200_000), [])).toBeNull();
    expect(contextHalf(usage(84_000, 200_000), [{ role: "bot", kind: "text" }, { role: "bot", kind: "compaction" }] as never)).toBeNull();
  });
});

describe("D-20261125-015: an account reads with its provider", () => {
  it("names the provider before the account's own name, once", () => {
    expect(accountRowName({ driver: "claude", name: "ada@acme.test" })).toBe("Claude · ada@acme.test");
    expect(accountRowName({ driver: "claude", name: "Claude" })).toBe("Claude");
    expect(accountRowName({ driver: "claude", name: "Claude (API key)" })).toBe("Claude (API key)");
    expect(accountRowName({ driver: "other", name: "Nimbus" })).toBe("Nimbus");
  });
});
