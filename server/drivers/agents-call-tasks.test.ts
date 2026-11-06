import { describe, expect, it, vi } from "vitest";

import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, type CatalogProfile } from "./agents-catalog.ts";
import type { HarnessClient } from "./agents-client.ts";

const PROFILE: CatalogProfile = { externalRuntime: false, coordinating: false, ownThreadCreation: false, skillAuthoring: false, sharedComputers: false, voiceNotes: false, cloudHome: false, chief: false, botId: "bot-scout" };

function harness(answer: { ok: boolean; status: number; body: Record<string, unknown> }, externalRuntime = false) {
  const api = vi.fn<HarnessClient["api"]>(async () => ({}));
  const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async () => answer);
  const context: ToolCallContext = { botId: "bot-scout", threadId: "thread-scout", depth: 0, coordinating: false, externalRuntime, sharedComputers: false, client: { api, apiResponse } };
  return { apiResponse, context };
}

describe("task_list", () => {
  it("is in a normal catalog and not on an external runtime", () => {
    expect(availableTools(PROFILE).map((tool) => tool.name)).toContain("task_list");
    expect(availableTools({ ...PROFILE, externalRuntime: true }).map((tool) => tool.name)).not.toContain("task_list");
  });

  it("posts add to the internal route and reports the task", async () => {
    const { apiResponse, context } = harness({ ok: true, status: 201, body: { task: { id: "task_abc123", state: "doing", title: "Relire" } } });
    const result = await callTool("task_list", { action: "add", title: "Relire" }, context);
    expect(apiResponse).toHaveBeenCalledWith("/api/internal/task-list", { method: "POST", body: JSON.stringify({ action: "add", title: "Relire" }) });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("task_abc123");
    expect(result.text).toContain("doing");
  });

  it("does not call out from an external runtime", async () => {
    const { apiResponse, context } = harness({ ok: true, status: 200, body: {} }, true);
    expect((await callTool("task_list", { action: "list" }, context)).isError).toBe(true);
    expect(apiResponse).not.toHaveBeenCalled();
  });
});
