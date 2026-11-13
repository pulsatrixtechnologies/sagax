// #4200 point 5: a card for a read-only tool never says it sends something
// on the person's behalf: the held line follows the tool's own class.
import { describe, expect, it } from "vitest";

import { approvalHeldNote, approvalHeldReason } from "./auto-approve.ts";

describe("held line by tool class (#4200)", () => {
  it("says read for a read-only tool, change for a write, send only for a send", () => {
    const held = (toolClass?: "read" | "write" | "send") => approvalHeldNote({ source: "outbound-guard", permission: true, ...(toolClass ? { toolClass } : {}) });
    expect(held("read")).toBe("approval.held.read");
    expect(held("write")).toBe("approval.held.write");
    expect(held("send")).toBe("approval.held.outbound");
    expect(approvalHeldReason({ source: "outbound-guard", permission: true, toolClass: "read" })).not.toMatch(/sends something/);
    expect(approvalHeldReason({ source: "outbound-guard", permission: true, toolClass: "read" })).toMatch(/reads data/);
  });
});
