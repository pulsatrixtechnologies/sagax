import { describe, expect, it, vi } from "vitest";

import { availableTools, type CatalogProfile } from "./agents-catalog.ts";
import { callVideoTool, ENGINE_VIDEO_TOOLS, VIDEO_TOOL_NAME } from "./agents-video.ts";
import { GROK_HOST_TOOL_NAMES, grokOrgAgentProfile } from "./host-tools.ts";

const PROFILE: CatalogProfile = { externalRuntime: false, coordinating: true, ownThreadCreation: false, skillAuthoring: false, sharedComputers: false, voiceNotes: false, cloudHome: false, chief: false, botId: "bot-scout" };

describe("make_video", () => {
  it("is on every catalog, including an organization-style turn and an external runtime", () => {
    for (const profile of [PROFILE, { ...PROFILE, externalRuntime: true }, { ...PROFILE, phoneTools: [] }]) {
      const tool = availableTools(profile).find((item) => item.name === VIDEO_TOOL_NAME);
      expect(tool?.description).toContain("image_to_video");
      expect(tool?.description).toContain("reference_to_video");
    }
  });

  it("dispatches to the scoped harness and preserves truthful lifecycle receipts", async () => {
    const apiResponse = vi.fn().mockResolvedValue({ ok: true, status: 200, body: { job_id: "job", status: "pending", progress: 40 } });
    const client = { apiResponse, api: vi.fn() };
    const answer = await callVideoTool({ prompt: "rain", request_key: "rain-1" }, client);
    expect(answer.isError).toBeUndefined();
    expect(JSON.parse(answer.text)).toEqual({ job_id: "job", status: "pending", progress: 40 });
    expect(apiResponse).toHaveBeenCalledWith("/api/internal/video", { method: "POST", body: JSON.stringify({ prompt: "rain", request_key: "rain-1" }) });
    for (const status of ["paused", "unknown", "failed"]) {
      apiResponse.mockResolvedValueOnce({ ok: true, status: 200, body: { status } });
      expect((await callVideoTool({ action: "status", job_id: "job" }, client)).isError).toBe(true);
    }
    apiResponse.mockResolvedValueOnce({ ok: false, status: 403, body: { error: "explicit org refusal" } });
    expect(await callVideoTool({ prompt: "rain" }, client)).toEqual({ text: '{"error":"explicit org refusal"}', isError: true });
  });

  it("keeps video and images on an organization profile and withholds the host tools", () => {
    const profile = grokOrgAgentProfile(undefined, true);
    expect(profile.tools).toEqual(expect.arrayContaining([...ENGINE_VIDEO_TOOLS, "image_gen", "image_edit"]));
    for (const name of ["run_terminal_command", "read_file", "write"]) {
      expect(GROK_HOST_TOOL_NAMES).toContain(name);
      expect(profile.tools).not.toContain(name);
    }
  });
});
