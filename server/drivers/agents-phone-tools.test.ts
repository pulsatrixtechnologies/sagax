import { describe, expect, it, vi } from "vitest";

import { callTool, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv, DEFERRED_AGENT_TOOL_NAMES, type CatalogProfile } from "./agents-catalog.ts";
import type { HarnessClient } from "./agents-client.ts";
import { healthOutcomeText, phoneOutcomeText } from "./agents-phone-tools.ts";

const PROFILE: CatalogProfile = { externalRuntime: false, coordinating: false, ownThreadCreation: false, skillAuthoring: false, sharedComputers: false, voiceNotes: false, cloudHome: false, chief: false, botId: "bot-scout" };

function phoneTool(profile: CatalogProfile) {
  return availableTools(profile).find((tool) => tool.name === "phone_tool") as { inputSchema: { properties: { tool: { enum: string[] } } }; description: string } | undefined;
}

describe("phone_tool", () => {
  it("is shown only while a phone of the person offers tools, listing exactly those", () => {
    expect(phoneTool(PROFILE)).toBeUndefined();
    expect(phoneTool({ ...PROFILE, phoneTools: [] })).toBeUndefined();
    const tool = phoneTool({ ...PROFILE, phoneTools: ["status", "location", "home", "alarms"] });
    expect(tool?.inputSchema.properties.tool.enum).toEqual(["location", "home", "alarms", "status"]);
    expect(tool?.description).toContain("home:");
    expect(tool?.description).toContain("alarms:");
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
    const context: ToolCallContext = { botId: "bot-scout", threadId: "t", depth: 0, coordinating: false, externalRuntime: false, sharedComputers: false, client: { api: vi.fn(), apiResponse } };
    const result = await callTool("phone_tool", { tool: "contacts", query: "Marie", fields: ["phone"], title: "ignored", reason: "appeler" }, context);
    expect(apiResponse).toHaveBeenCalledWith("/api/internal/phone-tools", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(apiResponse.mock.calls[0]![1]!.body))).toEqual({ tool: "contacts", args: { query: "Marie", fields: ["phone"], reason: "appeler" } });
    expect(result.text).toContain("Marie");
  });

  it("keeps waiting on a request id", async () => {
    const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async () => ({ ok: true, status: 200, body: { status: "denied" } }));
    const context: ToolCallContext = { botId: "b", threadId: "t", depth: 0, coordinating: false, externalRuntime: false, sharedComputers: false, client: { api: vi.fn(), apiResponse } };
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

describe("health_read and health_write", () => {
  const names = (profile: CatalogProfile) => availableTools(profile).map((tool) => tool.name).filter((name) => name.startsWith("health_"));

  it("are shown only while the person's phone offers them, never inside phone_tool", () => {
    expect(names(PROFILE)).toEqual([]);
    expect(names({ ...PROFILE, healthTools: ["health_read"] })).toEqual(["health_read"]);
    expect(names({ ...PROFILE, healthTools: ["health_write", "health_read"] })).toEqual(["health_read", "health_write"]);
    expect(names({ ...PROFILE, externalRuntime: true, healthTools: ["health_read"] })).toEqual([]);
    expect(phoneTool({ ...PROFILE, healthTools: ["health_read"] })).toBeUndefined();
    expect(phoneTool({ ...PROFILE, phoneTools: ["location"], healthTools: ["health_read"] })?.inputSchema.properties.tool.enum).toEqual(["location"]);
    expect(DEFERRED_AGENT_TOOL_NAMES.has("health_read")).toBe(true);
  });

  it("splits the harness list between phone_tool and health", () => {
    const profile = catalogProfileFromEnv({ SAGAX_PHONE_TOOLS: "location,health_read,health_write,teleport" });
    expect(profile.phoneTools).toEqual(["location"]);
    expect(profile.healthTools).toEqual(["health_read", "health_write"]);
    expect(catalogProfileFromEnv({ SAGAX_PHONE_TOOLS: "location" }).healthTools).toBeUndefined();
  });

  it("sends only its own arguments through the phone link, naming the tool", async () => {
    const apiResponse = vi.fn<HarnessClient["apiResponse"]>(async () => ({ ok: true, status: 200, body: { status: "done", tool: "health_read", result: { category: "steps", unit: "count", days: [] } } }));
    const context: ToolCallContext = { botId: "bot-scout", threadId: "t", depth: 0, coordinating: false, externalRuntime: false, sharedComputers: false, client: { api: vi.fn(), apiResponse } };
    const result = await callTool("health_read", { category: "steps", from: "2026-11-01", to: "2026-11-02", query: "ignored" }, context);
    expect(JSON.parse(String(apiResponse.mock.calls[0]![1]!.body))).toEqual({ tool: "health_read", args: { category: "steps", from: "2026-11-01", to: "2026-11-02" } });
    expect(result.text).toContain("steps");
  });

  it("says plainly when the phone is not reachable", () => {
    expect(healthOutcomeText({ status: "expired" }).text).toContain("not reachable");
    expect(healthOutcomeText({ status: "failed", error: "The person has not allowed reading sleep in Santé on this phone." }).text).toContain("Santé");
  });
});
