// 2026-11-02: a routine run's permission waits as long as its turn says (its
// person is not watching it ask); a live chat keeps the 15 minutes.
import { describe, expect, it } from "vitest";

import { approvalWaitMs } from "./session-permission.ts";

describe("approvalWaitMs", () => {
  it("is the turn's own wait when it gives one, else 15 minutes", () => {
    expect(approvalWaitMs(2 * 60 * 60_000)).toBe(2 * 60 * 60_000);
    expect(approvalWaitMs(undefined)).toBe(15 * 60_000);
    expect(approvalWaitMs(0)).toBe(15 * 60_000);
    expect(approvalWaitMs(Number.NaN)).toBe(15 * 60_000);
  });
});

describe("a permission ask that carries only the call's id (#1931)", () => {
  it("reads the arguments the earlier tool_call streamed", async () => {
    const { createPermissionHandler } = await import("./session-permission.ts");
    const events: any[] = [];
    const handler = createPermissionHandler({
      support: {} as never, DRIVER_KIND: "grok", DENY_TIMEOUT_NOTE: "", QUESTION_NO_MATCH_NOTE: "",
      threadId: "t1", commandCwd: undefined, send: () => {}, emit: (event) => events.push(event),
      base: () => ({}), sessionAllows: new Map(), handleClientFileRequest: async () => {},
      getSession: () => ({ sessionId: "s1" }) as never, active: new Map(),
    });
    const id = "cursor__user-pulsatrix-connectwise-profile_5fuse___23";
    const current = {
      turnId: "turn-1", state: {}, flushAssistantText: () => {}, turn: {}, turnConfig: {}, asks: new Map(),
      mountedServers: new Set(["agents"]),
      toolInputs: new Map([["call-1", { variant: "UseTool", tool_name: id, tool_input: '{"profile":"gox"}' }]]),
    };
    handler({
      jsonrpc: "2.0", id: 7, method: "session/request_permission",
      params: {
        toolCall: { toolCallId: "call-1", kind: "other", title: "Use Tool", _meta: { "x.ai/tool": { name: "use_tool", kind: "use_tool" } } },
        options: [{ optionId: "once", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }],
      },
    }, current as never);
    const opened = events.find((event) => event.type === "request.opened");
    expect(opened).toMatchObject({ mcpTool: id, engineConnector: true });
    expect(opened.input).toContain("gox");
    for (const finish of current.asks.values()) (finish as (b: string, s: string) => void)("deny", "user");
  });
});
