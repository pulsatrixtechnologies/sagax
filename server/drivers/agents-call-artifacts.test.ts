import { describe, expect, it, vi } from "vitest";

import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, type CatalogProfile } from "./agents-catalog.ts";
import type { HarnessClient } from "./agents-client.ts";

const PROFILE: CatalogProfile = { externalRuntime: false, skillAuthoring: false, sharedComputers: false, voiceNotes: false, cloudHome: false, chief: false, botId: "bot-scout" };
const NAMES = ["save_artifact", "update_artifact", "list_artifacts", "delete_artifact"];

function harness(answer: { ok: boolean; status: number; body: Record<string, unknown> }, externalRuntime = false) {
  const api = vi.fn<HarnessClient["api"]>(async () => ({}));
  const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async () => answer);
  const context: ToolCallContext = { botId: "bot-scout", threadId: "thread-scout", depth: 0, externalRuntime, sharedComputers: false, client: { api, apiResponse } };
  return { apiResponse, context };
}

describe("the artifact tools", () => {
  it("are in the catalog of every agents bot, and only list_artifacts reads", () => {
    for (const profile of [PROFILE, { ...PROFILE, chief: true }]) {
      const tools = availableTools(profile) as Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>;
      for (const name of NAMES) expect(tools.map((tool) => tool.name)).toContain(name);
      expect(tools.filter((tool) => NAMES.includes(tool.name) && tool.annotations?.readOnlyHint).map((tool) => tool.name)).toEqual(["list_artifacts"]);
    }
    expect(availableTools({ ...PROFILE, externalRuntime: true }).map((tool) => tool.name)).not.toContain("save_artifact");
  });

  it("posts the call to the internal route and says where it went", async () => {
    const { apiResponse, context } = harness({ ok: true, status: 201, body: { artifact: { id: "art_abc123", source: { kind: "command", command: "x" } } } });
    const result = await callTool("save_artifact", { title: "T", html: "<p>" }, context);
    expect(apiResponse).toHaveBeenCalledWith("/api/internal/artifacts", { method: "POST", body: JSON.stringify({ tool: "save_artifact", args: { title: "T", html: "<p>" } }) });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("art_abc123");
    expect(result.text).toContain("refreshes it from its source");
  });

  it("hands a refusal back as an error, and an external runtime never reaches the route", async () => {
    const refused = harness({ ok: false, status: 404, body: { error: "No artifact with that id for this bot." } });
    expect(await callTool("delete_artifact", { artifact_id: "art_nope000" }, refused.context)).toEqual({ text: "No artifact with that id for this bot.", isError: true });
    const external = harness({ ok: true, status: 200, body: {} }, true);
    expect((await callTool("list_artifacts", {}, external.context)).isError).toBe(true);
    expect(external.apiResponse).not.toHaveBeenCalled();
  });
});
