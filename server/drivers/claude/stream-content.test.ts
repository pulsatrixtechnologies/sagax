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

/** Every event the handler emits for a tool_use then its tool_result. */
function frames(toolName: string, input: Record<string, unknown>, result: Record<string, unknown>) {
  const events: any[] = [];
  const ctx: any = {
    session: { toolNames: new Map(), turn: { steps: [], pendingSteers: new Set() }, configDir: null },
    threadId: "t1",
    emit: (event: unknown) => events.push(event),
    base: (threadId: string, turnId: string) => ({ eventId: "e", provider: "claude", threadId, turnId, createdAt: "now" }),
    currentTurnId: () => "turn-1",
    support: { extractMcpImages: () => [] },
  };
  handleClaudeContent(ctx, { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_9", name: toolName, input }] } });
  handleClaudeContent(ctx, { type: "user", ...result });
  return events;
}

describe("#1943 vendor 403 on another mailbox", () => {
  const graph = "Managed MCP gateway tool call failed: Microsoft Graph API error: 403 Forbidden: {\"error\":{\"code\":\"ErrorAccessDenied\",\"message\":\"Access is denied.\"}}";

  it("returns the /me retry when the vendor answers 403", () => {
    const events = frames("mcp__claude_ai_Microsoft_365__outlook_email_search", { userId: "ceo@example.com", query: "invoice" }, {
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", is_error: true, content: graph }] },
    });
    const done = events.find((event) => event.itemType === "tool" && event.ok === false);
    expect(done.output).toBe("Access denied for that mailbox; for your own mail retry with /me");
  });

  it("keeps the vendor's words for the owner's own /me", () => {
    const events = frames("outlook__list_messages", { userId: "me" }, {
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", is_error: true, content: graph }] },
    });
    const done = events.find((event) => event.itemType === "tool" && event.ok === false);
    expect(done.output).toBe(graph);
  });
});

describe("#2018 claude.ai artifacts", () => {
  it("turns the other-account refusal into an artifact consent fence", () => {
    const refusal = "Claude couldn't check who made this artifact. Let Claude read it?";
    const events = frames("ArtifactData", { action: "list", url: "https://claude.ai/artifact/FWS66o6mXuVcnsNca5cYmB", collection: "journal" }, {
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", is_error: true, content: refusal }] },
      tool_use_result: `Error: ${refusal}`,
    });
    const text = JSON.stringify(events);
    expect(text).toContain('\\"blocked\\":\\"other_account\\"');
    expect(text).toContain("FWS66o6mXuVcnsNca5cYmB");
  });

  it("reads a publish card from the structured tool_use_result", () => {
    const events = frames("Artifact", { action: "publish", file_path: "/tmp/p.html" }, {
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "Published /tmp/p.html at https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9 (Version 1)" }] },
      tool_use_result: { url: "https://claude.ai/artifact/HBXTc3TAqqC5odi1H6Bgu9", path: "/tmp/p.html", title: "Sagax probe", owned: true, icon: "code" },
    });
    const card = events.find((event) => event.itemType === "assistant_text");
    expect(card.text).toContain("```artifact");
    expect(card.text).toContain("Sagax probe");
    expect(card.text).not.toContain("/tmp/p.html");
  });
});
