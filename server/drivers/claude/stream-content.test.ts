import { describe, expect, it } from "vitest";

import { emptyFailureNote, handleClaudeContent } from "./stream-content.ts";

/** One stream-json `user` frame carrying a tool_result, through the real
 * handler, and the item.completed it emits. */
function completed(frame: Record<string, unknown>, toolName = "mcp__perspicax__flow_run") {
  const events: any[] = [];
  const ctx: any = {
    session: { toolNames: new Map([["toolu_1", toolName]]), turn: { steps: [], pendingSteers: new Set() } },
    threadId: "t1",
    emit: (event: unknown) => events.push(event),
    base: (threadId: string, turnId: string) => ({ eventId: "e", provider: "claude", threadId, turnId, createdAt: "now" }),
    currentTurnId: () => "turn-1",
    support: { extractMcpImages: () => [] },
  };
  handleClaudeContent(ctx, { type: "user", ...frame });
  return events.find((event) => event.type === "item.completed" && event.itemType === "tool");
}

describe("a failed tool call always carries words (2026-11-05)", () => {
  it("keeps the content block's own words", () => {
    const event = completed({ message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: true, content: "run_not_yours: this run is not held by your account" }] } });
    expect(event).toMatchObject({ ok: false, output: "run_not_yours: this run is not held by your account" });
  });

  it("reads the frame's tool_use_result when the content block is empty", () => {
    const event = completed({
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: true, content: [] }] },
      tool_use_result: { error: "This tool needs consent this session cannot show." },
    }, "ArtifactData");
    expect(event.output).toBe("This tool needs consent this session cannot show.");
  });

  it("says what is known when the engine passed on nothing at all", () => {
    const event = completed({ message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: true, content: "" }] } });
    expect(event.output).toBe(emptyFailureNote("mcp__perspicax__flow_run"));
    expect(event.output).toMatch(/^flow_run failed, and Claude Code passed on no error text/);
    expect(emptyFailureNote(undefined)).toMatch(/^the tool failed/);
  });

  it("leaves a successful call as it was", () => {
    const event = completed({ message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "" }] } });
    expect(event.ok).toBe(true);
    expect(event.output).toBeUndefined();
  });
});
