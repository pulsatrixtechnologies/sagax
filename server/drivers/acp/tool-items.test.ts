// A failed ACP tool call carries its own error to the bot's step and the run
// view (2026-11-02, shapes Grok wrote for the prod runs that day).
import { describe, expect, it } from "vitest";

import { acpFailedToolText, acpToolEndEvents } from "./tool-items.ts";

const GRAPH_404 = "Managed MCP gateway tool call failed: Microsoft Graph API error: 404 Not Found: {\"error\":{\"code\":\"ErrorItemNotFound\",\"message\":\"The specified object was not found in the store.\"}}";

describe("acpFailedToolText", () => {
  it("reads a gateway (use_tool) failure's message, not its JSON envelope", () => {
    const text = acpFailedToolText(
      { error: "tool_execution_failed", message: GRAPH_404 },
      [{ type: "content", content: { type: "text", text: `Tool \`outlook__get_message\` failed via \`use_tool\`: ${GRAPH_404}` } }],
    );
    expect(text).toBe(GRAPH_404);
  });

  it("reads an MCP isError result's Error, JSON kept readable", () => {
    const body = JSON.stringify({ code: "upstream_error", details: { status: 404 }, hint: "search with cw_psa_find_tickets", message: "ticket id not found" });
    const text = acpFailedToolText({ type: "mcp", tool_name: "cw_psa_query", output: { Error: body }, is_error: true }, undefined);
    expect(text).toContain("upstream_error");
    expect(text).toContain("ticket id not found");
    expect(text).toContain("cw_psa_find_tickets");
  });

  it("falls back to the content text when rawOutput says nothing", () => {
    expect(acpFailedToolText({}, [{ type: "content", content: { type: "text", text: "User rejected the execution for tool `use_tool`" } }]))
      .toBe("User rejected the execution for tool `use_tool`");
    expect(acpFailedToolText(null, undefined)).toBeUndefined();
  });
});

describe("acpToolEndEvents", () => {
  it("a failed call's completion carries the error words", () => {
    const [done] = acpToolEndEvents({ status: "failed", rawOutput: { error: "tool_execution_failed", message: GRAPH_404 } }, "t1", new Set());
    expect(done).toMatchObject({ type: "item.completed", itemType: "tool", ok: false, output: GRAPH_404 });
  });

  it("an empty rawOutput no longer hides the content of a failure", () => {
    const [done] = acpToolEndEvents({ status: "failed", rawOutput: {}, content: [{ type: "content", content: { type: "text", text: "quota exceeded" } }] }, "t2", new Set());
    expect(done).toMatchObject({ ok: false, output: "quota exceeded" });
  });

  it("#1943 maps a vendor 403 on another mailbox to the /me retry", () => {
    const graph = "Managed MCP gateway tool call failed: Microsoft Graph API error: 403 Forbidden: {\"error\":{\"code\":\"ErrorAccessDenied\",\"message\":\"Access is denied.\"}}";
    const call = { tool: "outlook__list_messages", input: { userId: "ceo@example.com" } };
    expect(acpFailedToolText({ error: "tool_execution_failed", message: graph }, undefined, call))
      .toBe("Access denied for that mailbox; for your own mail retry with /me");
    const [done] = acpToolEndEvents({ status: "failed", rawOutput: { error: "tool_execution_failed", message: graph } }, "t4", new Set(), {}, call);
    expect(done).toMatchObject({ type: "item.completed", itemType: "tool", ok: false, output: "Access denied for that mailbox; for your own mail retry with /me" });
    expect(acpFailedToolText({ error: "tool_execution_failed", message: graph }, undefined, { tool: "outlook__list_messages", input: { userId: "me" } }))
      .toBe(graph);
  });

  it("a completed call keeps its preview", () => {
    const [done] = acpToolEndEvents({ status: "completed", rawOutput: { output: "two bots" } }, "t3", new Set());
    expect(done).toMatchObject({ ok: true });
    expect((done as { output?: string }).output).toContain("two bots");
  });
});
