import { describe, expect, it } from "vitest";
import { chatUsageCostUsd } from "./chat-usage-cost.ts";

describe("chat usage cost", () => {
  it("keeps a provider cost, including zero, and ignores a bad one", () => {
    expect(chatUsageCostUsd({ cost: 0.004 })).toBe(0.004);
    expect(chatUsageCostUsd({ cost: 0 })).toBe(0);
    expect(chatUsageCostUsd({ cost: null })).toBeUndefined();
    expect(chatUsageCostUsd({ cost: -1 })).toBeUndefined();
    expect(chatUsageCostUsd(undefined)).toBeUndefined();
  });

  it("reads xAI ticks as dollars when no cost field was sent", () => {
    expect(chatUsageCostUsd({ cost_in_usd_ticks: 150_000_000 })).toBe(0.015);
    expect(chatUsageCostUsd({ cost_in_usd_ticks: 0 })).toBe(0);
    expect(chatUsageCostUsd({ cost: 0.01, cost_in_usd_ticks: 150_000_000 })).toBe(0.01);
  });
});
