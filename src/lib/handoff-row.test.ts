import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import {
  briefLine,
  handoffPhase,
  handoffReceiptIn,
  handoffRequestId,
  handoffResultId,
  handoffResultIn,
  handoffVerdict,
  isHandoff,
} from "./handoff-row";
import { withoutDeadThreadChips } from "./dead-thread-chips";
import { isFailedTeammateStep, isTeammateStep } from "./step-label";

const ref = { botId: "olive", threadId: "olive-work", title: "@Wren · work" };
const sent = (extra: Partial<NonNullable<Message["tool"]>> = {}): Message => ({
  id: "sent", at: 1, role: "bot", kind: "activity", threadRef: ref,
  tool: { name: "Sent to Olive", ok: true, input: "Review the release notes.", handoffId: "req-1", ...extra },
});
const replied = (ok = true, output = "PASS\nAll good."): Message => ({
  id: "replied", at: 2, role: "bot", kind: "activity", threadRef: ref,
  roomRequest: { id: "req-1", phase: "result" },
  tool: { name: ok ? "Olive replied" : "Olive — failed: engine stopped", ok, ...(ok ? { output } : {}) },
});

describe("handoff rows", () => {
  it("pairs the receipt with the result it opened", () => {
    expect(handoffRequestId(sent())).toBe("req-1");
    expect(handoffResultId(replied())).toBe("req-1");
    expect(handoffResultIn([sent(), replied()], "req-1")?.id).toBe("replied");
    expect(handoffReceiptIn([sent(), replied()], "req-1")).toBe(true);
    expect(handoffReceiptIn([replied()], "req-1")).toBe(false);
  });

  it("knows a hand-off, a legacy receipt included, and nothing else", () => {
    expect(isHandoff(sent())).toBe(true);
    expect(isHandoff(replied())).toBe(true);
    expect(isHandoff(sent({ handoffId: undefined }))).toBe(true);
    expect(isHandoff({ ...sent(), tool: { name: "Opened thread #QA", ok: true } })).toBe(false);
    expect(isHandoff({ ...sent(), threadRef: undefined })).toBe(false);
  });

  it("waits, answers or fails, live from the transcript", () => {
    expect(handoffPhase(sent(), undefined)).toBe("running");
    expect(handoffPhase(sent(), replied())).toBe("done");
    expect(handoffPhase(sent(), replied(false))).toBe("failed");
    expect(handoffPhase(sent({ ok: false }), undefined)).toBe("failed");
    expect(handoffPhase(sent({ handoffId: undefined }), undefined)).toBe("done");
  });

  it("reads a reviewer's verdict from its first line only", () => {
    expect(handoffVerdict("**PASS** — ship it")).toBe("PASS");
    expect(handoffVerdict("Verdict: FAILED\nsee below")).toBe("FAIL");
    expect(handoffVerdict("Looks fine.\nPASS")).toBeUndefined();
    expect(handoffVerdict(undefined)).toBeUndefined();
  });

  it("puts the brief on one short line", () => {
    expect(briefLine("  Review\nthe   notes ")).toBe("Review the notes");
    expect(briefLine("x".repeat(200), 10)).toHaveLength(10);
    expect(briefLine("   ")).toBeUndefined();
  });

  it("keeps a hand-off whose work thread is closed and gone", () => {
    const owners = { bots: [{ id: "olive", threadId: "olive-main", tasks: [{ threadId: "olive-main" }] }], groups: [] };
    const gone: Message = { id: "chip", at: 3, role: "bot", kind: "activity", threadRef: ref, tool: { name: "Opened thread #X", ok: true } };
    expect(withoutDeadThreadChips([sent(), replied(), gone], owners).map((m) => m.id)).toEqual(["sent", "replied"]);
  });
});

describe("teammate steps", () => {
  it("names the calls that hand work to a teammate", () => {
    for (const name of ["coordinate_bots", "ask_bot", "delegate_bot", "send_to_bot"]) expect(isTeammateStep(name)).toBe(true);
    expect(isTeammateStep("Bash")).toBe(false);
  });

  it("keeps a failed hand-off call (the 4 000 limit) in sight", () => {
    const step = (ok: boolean, name = "coordinate_bots"): Message => ({ id: name, at: 1, role: "bot", kind: "activity", tool: { name, ok } });
    expect(isFailedTeammateStep(step(false))).toBe(true);
    expect(isFailedTeammateStep(step(true))).toBe(false);
    expect(isFailedTeammateStep(step(false, "Bash"))).toBe(false);
  });
});
