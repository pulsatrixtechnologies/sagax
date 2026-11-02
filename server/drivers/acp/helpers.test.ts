import { describe, expect, it } from "vitest";
import {
  isReasoningOnlyEmpty,
  nextUnkeyedToolId,
  offeredModels,
  resetUnkeyedToolSeqForTests,
  sanitizeAcpToolMessage,
  sessionOperationKey,
  trackRunningTool,
} from "./helpers.ts";

describe("sessionOperationKey", () => {
  it("returns null when the tool call has no command and no input", () => {
    expect(sessionOperationKey({ kind: "execute", title: "Shell" })).toBeNull();
    expect(sessionOperationKey({ kind: "execute", title: "Shell", rawInput: {} })).toBeNull();
    expect(sessionOperationKey(null)).toBeNull();
  });

  it("keys by stable sorted shape so key order does not matter", () => {
    const a = sessionOperationKey({
      kind: "execute",
      title: "Shell",
      rawInput: { command: "ls", b: 1, a: 2 },
      locations: [{ path: "/tmp" }],
    });
    const b = sessionOperationKey({
      kind: "execute",
      title: "Shell",
      locations: [{ path: "/tmp" }],
      rawInput: { a: 2, b: 1, command: "ls" },
    });
    expect(a).toBe(b);
    expect(a).toContain("\"command\":\"ls\"");
  });

  it("treats a command-only rawInput as identifiable", () => {
    const key = sessionOperationKey({ kind: "execute", rawInput: { command: "echo hi" } });
    expect(key).toContain("echo hi");
  });
});

describe("offeredModels", () => {
  it("returns an empty list when the config option is missing", () => {
    expect(offeredModels({}, "model")).toEqual([]);
    expect(offeredModels({ configOptions: [] }, "model")).toEqual([]);
  });

  it("flattens grouped select options under the named configId", () => {
    expect(offeredModels({
      configOptions: [{
        id: "model",
        options: [
          { value: "a" },
          { options: [{ value: "b" }, { value: "c" }] },
        ],
      }],
    }, "model")).toEqual(["a", "b", "c"]);
  });
});

describe("trackRunningTool", () => {
  it("adds pending and in_progress ids, and drops terminal ones", () => {
    const current = { runningTools: new Set<string>() };
    trackRunningTool(current, { toolCallId: "t1" }, "pending");
    expect([...current.runningTools]).toEqual(["t1"]);
    trackRunningTool(current, { toolCallId: "t1", status: "in_progress" });
    expect([...current.runningTools]).toEqual(["t1"]);
    trackRunningTool(current, { toolCallId: "t1", status: "completed" });
    expect([...current.runningTools]).toEqual([]);
    trackRunningTool(current, { toolCallId: "t2", status: "failed" });
    expect([...current.runningTools]).toEqual([]);
  });

  it("ignores updates without a toolCallId string", () => {
    const current = { runningTools: new Set<string>(["keep"]) };
    trackRunningTool(current, { toolCallId: 1, status: "pending" }, "pending");
    trackRunningTool(current, { status: "pending" }, "pending");
    expect([...current.runningTools]).toEqual(["keep"]);
  });
});

describe("nextUnkeyedToolId", () => {
  it("stamps a synthetic id and queues it without touching runningTools", () => {
    resetUnkeyedToolSeqForTests();
    const current = { unkeyedToolIds: [] as string[], runningTools: new Set<string>() };
    const first = nextUnkeyedToolId(current);
    const second = nextUnkeyedToolId(current);
    expect(first).toBe("acp-tool-unkeyed-1");
    expect(second).toBe("acp-tool-unkeyed-2");
    expect(current.unkeyedToolIds).toEqual([first, second]);
    expect(current.runningTools.size).toBe(0);
  });
});

describe("isReasoningOnlyEmpty", () => {
  it("matches only JSON-RPC -32603 with a reasoning_only finish reason", () => {
    expect(isReasoningOnlyEmpty({
      code: -32603,
      message: "empty response from model (reasoning_only)",
    })).toBe(true);
    expect(isReasoningOnlyEmpty({
      code: -32603,
      data: { details: "finish_reason=reasoning_only" },
    })).toBe(true);
    expect(isReasoningOnlyEmpty({ code: -32603, message: "internal error" })).toBe(false);
    expect(isReasoningOnlyEmpty({ code: -32602, message: "reasoning_only" })).toBe(false);
    expect(isReasoningOnlyEmpty(null)).toBe(false);
  });
});

describe("sanitizeAcpToolMessage", () => {
  it("passes non-tool messages through", () => {
    const msg = { method: "session/prompt", params: { prompt: "hi" } };
    expect(sanitizeAcpToolMessage(msg)).toBe(msg);
  });

  it("bounds tool_call and permission payloads", () => {
    const big = "x".repeat(100_000);
    const sanitized = sanitizeAcpToolMessage({
      method: "session/update",
      params: { update: { sessionUpdate: "tool_call", rawInput: { out: big } } },
    }) as any;
    const out = sanitized?.params?.update?.rawInput?.out as string;
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain("[Earlier output truncated]");
  });
});
