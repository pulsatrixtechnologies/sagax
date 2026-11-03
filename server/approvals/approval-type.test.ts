import { describe, expect, it } from "vitest";

import { approvalTypeOf } from "./approval-type.ts";

describe("approvalTypeOf", () => {
  it("keeps a meeting's consent card out of the console, even with a tool name", () => {
    expect(approvalTypeOf({ tool: "join_meeting", meetingRequest: { requestId: "r" } as never })).toBe("other");
  });

  it("still types the other cards", () => {
    expect(approvalTypeOf({ tool: "Bash" })).toBe("tool");
    expect(approvalTypeOf({ tool: "x", allowKey: "peer:1" })).toBe("peer");
    expect(approvalTypeOf({ tool: "x", allowKey: "mcp:a" })).toBe("tool");
    expect(approvalTypeOf({ modelRequest: {} as never })).toBe("model");
    expect(approvalTypeOf({})).toBe("other");
  });
});
