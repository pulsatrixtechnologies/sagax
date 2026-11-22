import { describe, expect, it } from "vitest";
import { threadListState } from "./internal-sessions-roster.ts";

describe("list_threads state (#5011)", () => {
  const idle = { awaiting: false, busy: false, queued: false };

  it("reports a closed thread as closed even when its activity still says waiting", () => {
    expect(threadListState({ activity: "waiting-on-you", closedBy: { botId: "ada" } }, idle)).toBe("closed");
    expect(threadListState({ activity: "working", closedBy: { botId: "ada" } }, idle)).toBe("closed");
  });

  it("reports a closed thread that was picked back up as running", () => {
    expect(threadListState({ activity: "working", closedBy: { botId: "ada" } }, { ...idle, busy: true })).toBe("running");
  });
});
