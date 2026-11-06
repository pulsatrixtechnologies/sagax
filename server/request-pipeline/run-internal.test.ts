import { describe, expect, it, vi } from "vitest";
import { createRunInternal } from "./run-internal.ts";

describe("createRunInternal", () => {
  it("returns a function", () => {
    const runInternal = createRunInternal(() => ({}) as any);
    expect(typeof runInternal).toBe("function");
  });

  it("passes through when the path is not /api/internal or a test harness route", async () => {
    const json = vi.fn();
    const runInternal = createRunInternal(() => ({
      json,
      readBody: async () => ({}),
      timingSafeEqual: () => false,
      orgLibrary: null,
      z: { object: () => ({ strict: () => ({ safeParse: () => ({ success: false }) }) }) },
    } as any));
    const handled = await runInternal(
      { headers: {} } as any,
      {} as any,
      new URL("http://127.0.0.1/api/bots"),
      "/api/bots",
      "GET",
      { kind: "session" } as any,
    );
    expect(handled).toBe(false);
    expect(json).not.toHaveBeenCalled();
  });

  it("refuses /api/internal without a capability", async () => {
    const json = vi.fn();
    const runInternal = createRunInternal(() => ({
      json,
      harnessMcpHttpKind: () => null,
      authorizedInternalCapability: () => null,
    } as any));
    const handled = await runInternal(
      { headers: {} } as any,
      {} as any,
      new URL("http://127.0.0.1/api/internal/ask-bot"),
      "/api/internal/ask-bot",
      "POST",
      { kind: "session" } as any,
    );
    expect(handled).toBe(true);
    expect(json).toHaveBeenCalledWith(expect.anything(), 401, { error: "unauthorized" });
  });
});
