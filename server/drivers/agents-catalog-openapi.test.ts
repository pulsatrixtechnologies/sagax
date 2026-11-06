import { describe, expect, it, vi } from "vitest";

import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import type { HarnessClient } from "./agents-client.ts";

const names = (env: NodeJS.ProcessEnv) => availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "bot-a", ...env })).map((tool) => tool.name);

describe("openapi tools in the catalog", () => {
  const tools = JSON.stringify([{ name: "getnote", method: "get", path: "/notes/{id}", summary: "Read one note", params: [{ name: "id", in: "path", required: true, type: "string" }], body: false }]);

  it("is absent unless this turn carries the person's operations", () => {
    expect(names({})).not.toContain("openapi_getnote");
    expect(names({ SAGAX_OPENAPI_TOOLS: tools })).toContain("openapi_getnote");
    expect(names({ SAGAX_OPENAPI_TOOLS: tools, SAGAX_EXTERNAL_RUNTIME: "1" })).not.toContain("openapi_getnote");
  });
});

describe("openapi tool call", () => {
  function harness(answer: { ok: boolean; status: number; body: Record<string, unknown> }) {
    const api = vi.fn<HarnessClient["api"]>(async () => ({}));
    const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async () => answer);
    const context: ToolCallContext = { botId: "bot-a", threadId: "thread-a", depth: 0, coordinating: false, externalRuntime: false, sharedComputers: false, client: { api, apiResponse } };
    return { apiResponse, context };
  }

  it("posts the operation name and arguments, not a stored header", async () => {
    const { apiResponse, context } = harness({ ok: true, status: 200, body: { text: "wrapped" } });
    const result = await callTool("openapi_getnote", { id: "n1" }, context);
    expect(apiResponse).toHaveBeenCalledWith("/api/internal/openapi", { method: "POST", body: JSON.stringify({ name: "openapi_getnote", arguments: { id: "n1" } }) });
    expect(result).toEqual({ text: "wrapped" });
    expect(JSON.stringify(apiResponse.mock.calls)).not.toMatch(/Bearer|Authorization/);
  });
});
