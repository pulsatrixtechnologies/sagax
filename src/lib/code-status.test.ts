// The Code row and its status: hidden while loading and on a Perspicax
// without the agents API; the status asked once for the whole app.
import { afterEach, describe, expect, it } from "vitest";

import type { CodeStatus } from "../../shared/code-runs.ts";
import { codeHashTarget, codeStatusOnce, resetCodeStatusCache } from "@/lib/code-runs";

afterEach(() => resetCodeStatusCache());

describe("codeHashTarget", () => {
  it("opens the Code section from #code, and one run from #code/<run>", () => {
    expect(codeHashTarget("#code")).toEqual({});
    expect(codeHashTarget("#code/run_42-a")).toEqual({ runId: "run_42-a" });
  });
  it("leaves pairing links and other addresses alone", () => {
    for (const hash of ["", "#", "#code=ABCD-EFGH", "#code=x&auto=1", "#codex", "#approvals", "#code/", "#code/a/b"]) {
      expect(codeHashTarget(hash)).toBeNull();
    }
  });
});

describe("codeStatusOnce", () => {
  it("asks the server once, then answers from the cache for a few minutes", async () => {
    let calls = 0;
    const load = async (): Promise<CodeStatus> => { calls++; return { available: false, reason: "not_available" }; };
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) expect(await codeStatusOnce(load, t0 + i * 1000)).toEqual({ available: false, reason: "not_available" });
    expect(calls).toBe(1);
    await codeStatusOnce(load, t0 + 5 * 60_000 + 1);
    expect(calls).toBe(2);
  });
  it("a failed load is unreachable, not an error", async () => {
    expect(await codeStatusOnce(async () => { throw new Error("down"); })).toEqual({ available: false, reason: "unreachable" });
  });
});
