import { describe, expect, it, vi } from "vitest";

import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv, DEFERRED_AGENT_TOOL_NAMES, type CatalogProfile } from "./agents-catalog.ts";
import type { HarnessClient } from "./agents-client.ts";
import { phoneOutcomeText } from "./agents-phone-tools.ts";

const PROFILE: CatalogProfile = { externalRuntime: false, skillAuthoring: false, sharedComputers: false, voiceNotes: false, cloudHome: false, chief: false, botId: "bot-scout" };

function phoneTool(profile: CatalogProfile) {
  return availableTools(profile).find((tool) => tool.name === "phone_tool") as { inputSchema: { properties: { tool: { enum: string[] } } }; description: string } | undefined;
}

describe("phone_tool", () => {
  it("is shown only while a phone of the person offers tools, listing exactly those", () => {
    expect(phoneTool(PROFILE)).toBeUndefined();
    expect(phoneTool({ ...PROFILE, phoneTools: [] })).toBeUndefined();
    const tool = phoneTool({ ...PROFILE, phoneTools: ["status", "location"] });
    expect(tool?.inputSchema.properties.tool.enum).toEqual(["location", "status"]);
    expect(tool?.description).toContain("location:");
    expect(tool?.description).not.toContain("clipboard:");
    expect(phoneTool({ ...PROFILE, externalRuntime: true, phoneTools: ["status"] })).toBeUndefined();
    expect(DEFERRED_AGENT_TOOL_NAMES.has("phone_tool")).toBe(true);
  });

  it("reads the offered tools from the harness, ignoring anything unknown", () => {
    expect(catalogProfileFromEnv({ SAGAX_PHONE_TOOLS: "location,contacts,teleport" }).phoneTools).toEqual(["location", "contacts"]);
    expect(catalogProfileFromEnv({ SAGAX_PHONE_TOOLS: "location", SAGAX_EXTERNAL_RUNTIME: "1" }).phoneTools).toEqual([]);
    expect(catalogProfileFromEnv({}).phoneTools).toEqual([]);
  });

  it("sends only the chosen tool's arguments to the harness", async () => {
    const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async () => ({ ok: true, status: 200, body: { status: "done", tool: "contacts", result: { contacts: [{ name: "Marie" }] } } }));
    const context: ToolCallContext = { botId: "bot-scout", threadId: "t", depth: 0, externalRuntime: false, sharedComputers: false, client: { api: vi.fn(), apiResponse } };
    const result = await callTool("phone_tool", { tool: "contacts", query: "Marie", fields: ["phone"], title: "ignored", reason: "appeler" }, context);
    expect(apiResponse).toHaveBeenCalledWith("/api/internal/phone-tools", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(apiResponse.mock.calls[0]![1]!.body))).toEqual({ tool: "contacts", args: { query: "Marie", fields: ["phone"], reason: "appeler" } });
    expect(result.text).toContain("Marie");
  });

  it("keeps waiting on a request id", async () => {
    const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async () => ({ ok: true, status: 200, body: { status: "denied" } }));
    const context: ToolCallContext = { botId: "b", threadId: "t", depth: 0, externalRuntime: false, sharedComputers: false, client: { api: vi.fn(), apiResponse } };
    const result = await callTool("phone_tool", { request_id: "abc-1" }, context);
    expect(JSON.parse(String(apiResponse.mock.calls[0]![1]!.body))).toEqual({ request_id: "abc-1" });
    expect(result).toMatchObject({ isError: true });
  });

  it("tells the bot what each outcome means, and passes picked photos as images", () => {
    expect(phoneOutcomeText({ status: "pending", requestId: "r1" }).text).toContain("\"r1\"");
    expect(phoneOutcomeText({ status: "expired" }).isError).toBe(true);
    const photos = phoneOutcomeText({ status: "done", tool: "photos", result: { images: [{ mimeType: "image/jpeg", data: "AAAA" }] } });
    expect(photos.passthrough).toEqual({ content: [{ type: "text", text: "The person picked 1 photo on their phone." }, { type: "image", data: "AAAA", mimeType: "image/jpeg" }] });
  });
});
