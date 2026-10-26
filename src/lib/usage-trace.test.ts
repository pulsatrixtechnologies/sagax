import { describe, expect, it } from "vitest";
import { fetchMyTraces, fetchTraces, formatDuration, freshInput, triggerLabelOf, type UsageJobTrace } from "./usage-trace.ts";

describe("formatDuration", () => {
  it("picks a readable unit and rounds before it", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(6_900)).toBe("6.9 s");
    expect(formatDuration(51_000)).toBe("51 s");
    expect(formatDuration(100_000)).toBe("1 m 40 s");
    expect(formatDuration(7_500_000)).toBe("2 h 5 m");
  });
  it("returns empty for a bad input", () => {
    expect(formatDuration(-1)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
  });
});

describe("freshInput", () => {
  it("drops the cached share of the input", () => {
    expect(freshInput({ input: 1200, cachedInput: 900 })).toBe(300);
    expect(freshInput({ input: 100, cachedInput: 500 })).toBe(0);
  });
});

describe("triggerLabelOf", () => {
  it("passes a person's label straight through", () => {
    expect(triggerLabelOf({ triggerKind: "user", triggerLabel: "ada@example.test" })).toBe("ada@example.test");
  });
  it("localizes the machine and bot-to-bot kinds through the i18n table, not the ledger", () => {
    // Resolved by the app's own catalog (the owner's ledger label could be
    // any older English string); the app owns the wording.
    expect(triggerLabelOf({ triggerKind: "owner", triggerLabel: "whatever the ledger said" })).toBe("This computer");
    expect(triggerLabelOf({ triggerKind: "bot", triggerLabel: "whatever the ledger said" })).toBe("Bot to bot");
  });
  it("names a routine run by its routine, not the ledger's prefix", () => {
    expect(triggerLabelOf({ triggerKind: "routine", triggerLabel: "Routine: Morning digest" })).toBe("Routine: Morning digest");
  });
});

describe("fetchTraces", () => {
  it("asks the gated per-job endpoint with the range", async () => {
    const calls: string[] = [];
    const get = async <T>(path: string): Promise<T> => {
      calls.push(path);
      return { from: "", to: "", jobs: [] as UsageJobTrace[], total: {} as never, truncated: false } as unknown as T;
    };
    await fetchTraces({ from: "2026-10-01", to: "2026-10-22" }, get);
    expect(calls[0]).toBe("/api/usage/traces?from=2026-10-01&to=2026-10-22");
  });
});

describe("fetchMyTraces", () => {
  it("asks the per-person endpoint so the caller sees only their own traces", async () => {
    const calls: string[] = [];
    const get = async <T>(path: string): Promise<T> => {
      calls.push(path);
      return { from: "", to: "", jobs: [] as UsageJobTrace[], total: {} as never, truncated: false } as unknown as T;
    };
    await fetchMyTraces({ from: "2026-10-01", to: "2026-10-22" }, get);
    expect(calls[0]).toBe("/api/me/usage/traces?from=2026-10-01&to=2026-10-22");
  });
});
