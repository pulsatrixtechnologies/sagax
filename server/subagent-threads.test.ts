import { describe, expect, it } from "vitest";

import { READ_ONLY_TASK_LINE, resumeOpening, resumeRefusal, subagentRequest } from "./subagent-threads.ts";

const own = { threadId: "t-own", title: "Look only", openedBy: { botId: "bot-a" }, ownerPrincipalId: "p1" };
const ok = { visible: true, ownerPrincipalId: "p1" };

describe("resuming a sub-agent thread (parity D1)", () => {
  it("resumes only a thread the bot opened itself on itself", () => {
    expect(resumeRefusal(own, "bot-a", "t-main", ok)).toBeNull();
    expect(resumeRefusal(undefined, "bot-a", "t-main", ok)?.status).toBe(404);
    expect(resumeRefusal(own, "bot-a", "t-own", ok)?.status).toBe(409);
    expect(resumeRefusal({ ...own, parallelOf: { threadId: "t-main" } }, "bot-a", "t-main", ok)?.status).toBe(409);
    expect(resumeRefusal({ ...own, openedBy: undefined }, "bot-a", "t-main", ok)?.status).toBe(403);
    expect(resumeRefusal({ ...own, openedBy: { botId: "bot-b" } }, "bot-a", "t-main", ok)?.status).toBe(403);
    expect(resumeRefusal({ ...own, openedBy: { botId: "bot-a", delegationId: "d1" } }, "bot-a", "t-main", ok)?.status).toBe(403);
  });

  it("answers as if it did not exist when the thread is not visible from here (Cloud lending view, a confidential thread)", () => {
    const hidden = resumeRefusal(own, "bot-a", "t-main", { ...ok, visible: false });
    expect(hidden?.status).toBe(404);
    // the refusal never names the thread
    expect(hidden?.error).not.toContain("Look only");
  });

  it("refuses a thread that belongs to another person than the one this work is for (private threads)", () => {
    expect(resumeRefusal(own, "bot-a", "t-main", { visible: true, ownerPrincipalId: "p2" })?.status).toBe(403);
    expect(resumeRefusal(own, "bot-a", "t-main", { visible: true, ownerPrincipalId: undefined })?.status).toBe(403);
    expect(resumeRefusal({ ...own, ownerPrincipalId: undefined }, "bot-a", "t-main", { visible: true, ownerPrincipalId: "p1" })?.status).toBe(403);
    // both the bot owner's (no person): the same owner
    expect(resumeRefusal({ ...own, ownerPrincipalId: undefined }, "bot-a", "t-main", { visible: true, ownerPrincipalId: undefined })).toBeNull();
    // a solo server does not compare owners
    expect(resumeRefusal({ ...own, ownerPrincipalId: undefined }, "bot-a", "t-main", { visible: true })).toBeNull();
  });

  it("marks a read-only request and a follow-up as the bot's own words", () => {
    expect(subagentRequest("go", true)).toBe(`${READ_ONLY_TASK_LINE}\n\ngo`);
    expect(subagentRequest("go", false)).toBe("go");
    expect(resumeOpening("go", "Plans", true)).toContain("Follow-up you sent yourself from #Plans");
    expect(resumeOpening("go", "Plans", true)).toContain(READ_ONLY_TASK_LINE);
  });
});
