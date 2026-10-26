import { beforeEach, describe, expect, it, vi } from "vitest";
import { prewarmConversation, resetPrewarmForTests } from "./prewarm";

beforeEach(() => resetPrewarmForTests());

describe("prewarmConversation", () => {
  it("asks once per thread per 30 s, and never without a bot and a thread", () => {
    const api = vi.fn(() => Promise.resolve({ warm: "started" }));
    expect(prewarmConversation(api, "b1", "t1", 0)).toBe(true);
    expect(prewarmConversation(api, "b1", "t1", 10_000)).toBe(false);
    expect(prewarmConversation(api, "b1", "t2", 10_000)).toBe(true);
    expect(prewarmConversation(api, "b1", "t1", 31_000)).toBe(true);
    expect(prewarmConversation(api, undefined, "t1", 99_000)).toBe(false);
    expect(prewarmConversation(api, "b1", undefined, 99_000)).toBe(false);
    expect(api).toHaveBeenCalledTimes(3);
    expect(api).toHaveBeenCalledWith("/api/bots/b1/warm", expect.objectContaining({ method: "POST", body: JSON.stringify({ threadId: "t1" }) }));
  });

  it("swallows a refusal (an older server answers 404)", async () => {
    const api = vi.fn(() => Promise.reject(new Error("404")));
    expect(prewarmConversation(api, "b1", "t1", 0)).toBe(true);
    await Promise.resolve();
  });
});
