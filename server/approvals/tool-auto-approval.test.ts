// 2026-10-28: an ask answered with no card is not a row of its own; what
// answered it rides the call's own row, whichever came first.
import { describe, expect, it } from "vitest";

import { createAutoApprovalNotes, toolNameKeys } from "./tool-auto-approval.ts";

const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, kind: "activity", role: "bot", tool: { name, ...extra } });

describe("auto approval notes", () => {
  it("knows a tool by its engine, server and bare names", () => {
    expect(toolNameKeys("mcp__desk__view_tickets")).toEqual(["mcp__desk__view_tickets", "desk__view_tickets", "view_tickets"]);
  });

  it("finds the newest row of the tool that has no answer yet (the engine wrote it before asking)", () => {
    const notes = createAutoApprovalNotes();
    const rows = [row("a", "mcp__desk__view_tickets", { autoApproval: { source: "full-access" } }), row("b", "mcp__desk__view_time"), row("c", "mcp__desk__view_tickets")];
    expect(notes.rowFor(rows, ["mcp__desk__view_tickets"])?.id).toBe("c");
    expect(notes.rowFor(rows, ["other", "desk__view_time"])?.id).toBe("b");
    expect(notes.rowFor(rows, ["mcp__desk__close_ticket"])).toBeUndefined();
  });

  it("does not take another server's tool of the same bare name", () => {
    const notes = createAutoApprovalNotes();
    expect(notes.rowFor([row("x", "mcp__other__view_tickets")], ["mcp__desk__view_tickets"])).toBeUndefined();
  });

  it("keeps the answer for the row the engine writes next, once, and drops it at the end of the turn", () => {
    const notes = createAutoApprovalNotes();
    notes.remember("t1", ["mcp__desk__view_tickets"], { source: "full-access" });
    expect(notes.takePending("t2", "mcp__desk__view_tickets")).toBeUndefined();
    expect(notes.takePending("t1", "mcp__desk__view_time")).toBeUndefined();
    expect(notes.takePending("t1", "mcp__desk__view_tickets")).toEqual({ approval: { source: "full-access" } });
    expect(notes.takePending("t1", "mcp__desk__view_tickets")).toBeUndefined();
    notes.remember("t1", ["mcp__desk__view_tickets"], { source: "owner-rule", rule: "r1" });
    notes.clear("t1");
    expect(notes.takePending("t1", "mcp__desk__view_tickets")).toBeUndefined();
  });
});
