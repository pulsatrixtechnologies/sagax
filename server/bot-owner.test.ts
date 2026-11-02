import { describe, expect, it } from "vitest";

import { effectiveBotOwner, recordedBotOwner } from "./bot-owner.ts";

describe("bot-owner", () => {
  it("reads a trimmed lowercased recorded owner", () => {
    expect(recordedBotOwner({ ownerUserId: "  Pr_Ada  " })).toBe("pr_ada");
    expect(recordedBotOwner({ ownerUserId: "   " })).toBeUndefined();
    expect(recordedBotOwner({})).toBeUndefined();
    expect(recordedBotOwner({ ownerUserId: 12 })).toBeUndefined();
  });

  it("prefers the recorded owner over the local operator", () => {
    expect(effectiveBotOwner({ ownerUserId: "pr_ada" }, "local-owner")).toBe("pr_ada");
  });

  it("falls back to the local operator when no owner is recorded", () => {
    expect(effectiveBotOwner({}, "local-owner")).toBe("local-owner");
    expect(effectiveBotOwner({ ownerUserId: "" }, "local-owner")).toBe("local-owner");
  });
});
