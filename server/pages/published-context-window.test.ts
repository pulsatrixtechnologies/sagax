import { describe, expect, it } from "vitest";
import { contextWindowFor } from "../context/context-budget.ts";
import { publishedContextWindow } from "./published-context-window.ts";

describe("publishedContextWindow", () => {
  it("reads the window the endpoint published, ahead of the hardcoded table", () => {
    expect(publishedContextWindow({ id: "gpt-4.1", context_window: 32000 })).toBe(32000);
    expect(publishedContextWindow({ id: "local", context_length: 8192 })).toBe(8192);
    expect(publishedContextWindow({ id: "m", max_context_length: 4096 })).toBe(4096);
    expect(publishedContextWindow({ id: "m", top_provider: { max_model_len: 16384 } })).toBe(16384);
    expect(publishedContextWindow({ id: "m", context_window: 0 })).toBeUndefined();
    expect(publishedContextWindow({ id: "m" })).toBeUndefined();
    expect(contextWindowFor("gpt-4.1", { default: "gpt-4.1", options: [{ id: "gpt-4.1", label: "gpt-4.1", contextWindow: 32000 }] })).toBe(32000);
  });
});
