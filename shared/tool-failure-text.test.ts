// Every shape a failed call's error arrives in reads as its own words
// (2026-11-03: cards said "returned no error message" while the routine
// summary quoted the same error).
import { describe, expect, it } from "vitest";

import { toolFailureText } from "./tool-failure-text.ts";

const GRAPH_404 = "Managed MCP gateway tool call failed: Microsoft Graph API error: 404 Not Found: {\"error\":{\"code\":\"ErrorItemNotFound\",\"message\":\"The specified object was not found in the store.\"}}";
const REFUSED = "Refusé : ce chemin ou ce fichier appartient au serveur Sagax, pas à ton environnement. Tes fichiers sont dans /workspace.";

describe("toolFailureText", () => {
  it("keeps a plain string, without Claude's tool_use_error tags", () => {
    expect(toolFailureText(GRAPH_404)).toBe(GRAPH_404);
    expect(toolFailureText(`<tool_use_error>${REFUSED}</tool_use_error>`)).toBe(REFUSED);
    expect(toolFailureText("   ")).toBeUndefined();
  });

  it("reads an MCP isError result, a bare content list and its structuredContent", () => {
    expect(toolFailureText({ content: [{ type: "text", text: REFUSED }], isError: true })).toBe(REFUSED);
    expect(toolFailureText([{ type: "text", text: "first" }, { type: "text", text: "second" }])).toBe("first\nsecond");
    expect(toolFailureText({ content: [], isError: true, structuredContent: { error: { message: "member not found" } } })).toBe("member not found");
    // a JSON string of the same result, as an engine stores it
    expect(toolFailureText(JSON.stringify({ content: [{ type: "text", text: REFUSED }], isError: true }))).toBe(REFUSED);
  });

  it("reads ACP content blocks and leaves image bytes out", () => {
    expect(toolFailureText([{ type: "content", content: { type: "text", text: "quota exceeded" } }])).toBe("quota exceeded");
    expect(toolFailureText([{ type: "content", content: { type: "image", data: "iVBORw0KGgo=" } }])).toBeUndefined();
  });

  it("reads a JSON-RPC error and an error string", () => {
    expect(toolFailureText({ jsonrpc: "2.0", id: 3, error: { code: -32603, message: "The server environment is unavailable. Try again in a moment." } }))
      .toBe("The server environment is unavailable. Try again in a moment.");
    expect(toolFailureText({ error: "The connection to the server environment was interrupted." })).toBe("The connection to the server environment was interrupted.");
  });

  it("prefers the gateway's message over its bare error code", () => {
    expect(toolFailureText({ error: "tool_execution_failed", message: GRAPH_404 })).toBe(GRAPH_404);
    // a bare code alone is still better than nothing
    expect(toolFailureText({ error: "tool_execution_failed" })).toBe("tool_execution_failed");
  });

  it("reads Grok's MCP failure and keeps an API body's code and hint", () => {
    const body = JSON.stringify({ code: "upstream_error", details: { status: 404 }, hint: "search with cw_psa_find_tickets", message: "ticket id not found" });
    const text = toolFailureText({ type: "MCP", tool_name: "cw_psa_query", server_name: "Pulsatrix", output: { Error: body }, is_error: true });
    expect(text).toBe("ticket id not found (upstream_error)\nsearch with cw_psa_find_tickets");
    expect(toolFailureText({ type: "MCP", output: { Error: "Stop @Osprey's work before changing its setup" }, is_error: true }))
      .toBe("Stop @Osprey's work before changing its setup");
  });

  it("reads Grok's typed tool variants", () => {
    expect(toolFailureText({ type: "ReadFile", FileNotFound: "Error: /workspace/README.md does not exist." })).toBe("Error: /workspace/README.md does not exist.");
    expect(toolFailureText({ type: "ListDir", NotFound: "Error: /workspace/x does not exist." })).toBe("Error: /workspace/x does not exist.");
    expect(toolFailureText({ type: "SearchReplace", NoMatchesFound: { file_path: "a.ts", message: "The string to replace was not found in the file" } }))
      .toBe("The string to replace was not found in the file");
    expect(toolFailureText({ type: "TaskOutput", TaskNotFound: "Task t-2 not found." })).toBe("Task t-2 not found.");
  });

  it("reads a shell's words, from text or from bytes", () => {
    expect(toolFailureText({ type: "Bash", output: [], output_for_prompt: "exit: killed (timeout)\n", exit_code: -1 })).toBe("exit: killed (timeout)");
    const bytes = [...new TextEncoder().encode("fatal: not a git repository")];
    expect(toolFailureText({ type: "Bash", output: bytes, exit_code: 128 })).toBe("fatal: not a git repository");
    expect(toolFailureText({ type: "GrepSearch", stdout: [], stderr: [], failure: "rg: regex parse error" })).toBe("rg: regex parse error");
  });

  it("opens the envelopes drivers and APIs wrap an error in", () => {
    expect(toolFailureText(JSON.stringify({ ok: false, result: "Permission denied or expired; the tool was not executed." })))
      .toBe("Permission denied or expired; the tool was not executed.");
    expect(toolFailureText({ message: "rate limited" })).toBe("rate limited");
    expect(toolFailureText({ detail: "Not authenticated" })).toBe("Not authenticated");
    expect(toolFailureText({ error: "invalid_grant", error_description: "The refresh token expired" })).toBe("The refresh token expired");
  });

  it("has no words for a failure that carried none", () => {
    expect(toolFailureText(undefined)).toBeUndefined();
    expect(toolFailureText(null)).toBeUndefined();
    expect(toolFailureText({})).toBeUndefined();
    expect(toolFailureText([])).toBeUndefined();
    expect(toolFailureText({ output: null, exitCode: null })).toBeUndefined();
    // a JSON body with no words stays as it was written
    expect(toolFailureText("{\"status\":500}")).toBe("{\"status\":500}");
  });
});

describe("toolFailureText, a connector write refused", () => {
  it("reads the per-record error of a write's results", () => {
    const body = { action: "create", ok: false, results: [{ ok: false, status: 400, body: { code: "InvalidObject", message: "timeEntry object is invalid" },
      error: { code: "upstream_error", hint: "body.timeStart: Unsupported format applied to timeStart", message: "timeEntry object is invalid" } }] };
    expect(toolFailureText({ type: "MCP", output: { Error: JSON.stringify(body) }, is_error: true }))
      .toBe("timeEntry object is invalid (upstream_error)\nbody.timeStart: Unsupported format applied to timeStart");
  });
  it("reads a Perspicax refusal inside a Codex mcpToolCall result (error null), as a routine card stores it", () => {
    // 2026-11-04, a routine's flow_run read ["run", "close"]: Codex item {status: failed, error: null, result}
    const body = { code: "params_invalid", details: { status: 400 }, hint: "call flow_run with {\"command\": \"run.finish\"}", message: "flow_run read only runs read commands, and `run close` is not one: call flow_run {\"command\": \"run.finish\"} instead" };
    const result = { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, _meta: null };
    const text = toolFailureText(result);
    expect(text).toContain("call flow_run {\"command\": \"run.finish\"} instead (params_invalid)");
    expect(text).toContain("call flow_run with");
    // the stored preview reads the same when the card opens
    expect(toolFailureText(text)).toBe(text);
  });
});
