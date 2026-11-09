import { describe, expect, it } from "vitest";
import { isSettledSend, SEND_SUMMARY_MAX, sendReturnLine, sendStateOf, sendSummary } from "./send-receipt.ts";

describe("send receipts (#3246)", () => {
  it("maps runtime statuses to what the sender reads", () => {
    expect(sendStateOf("queued")).toBe("queued");
    expect(sendStateOf("queued", { started: true })).toBe("read");
    expect(sendStateOf("running")).toBe("read");
    expect(sendStateOf("waiting")).toBe("read");
    expect(sendStateOf("waiting", { question: true })).toBe("waiting");
    expect(sendStateOf("completed")).toBe("done");
    for (const status of ["failed", "cancelled", "expired"]) expect(sendStateOf(status)).toBe("failed");
    expect(isSettledSend("done")).toBe(true);
    expect(isSettledSend("waiting")).toBe(false);
  });

  it("keeps a summary to one line of at most SEND_SUMMARY_MAX characters", () => {
    expect(sendSummary("  a\n\nb  ")).toBe("a b");
    expect(sendSummary("   ")).toBeUndefined();
    const long = sendSummary("x".repeat(1000))!;
    expect(long).toHaveLength(SEND_SUMMARY_MAX);
    expect(long.endsWith("…")).toBe(true);
  });

  it("writes the return line with the state, the reply and the thread", () => {
    const done = sendReturnLine("Bea", "done", "Booked for Tuesday.", "t-9");
    expect(done).toContain("Bea finished");
    expect(done).toContain("Its reply: Booked for Tuesday.");
    expect(done).toContain("thread t-9");
    expect(sendReturnLine("Bea", "failed", undefined, "t-9")).toContain("could not finish");
  });
});
