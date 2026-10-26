import { describe, expect, it, vi } from "vitest";

import { callTool, githubConnectText, type ToolCallContext } from "./agents-call.ts";
import { availableTools, catalogProfileFromEnv, type CatalogProfile } from "./agents-catalog.ts";
import type { HarnessClient } from "./agents-client.ts";

const PROFILE: CatalogProfile = { externalRuntime: false, skillAuthoring: false, sharedComputers: false, voiceNotes: false, cloudHome: false, chief: false, botId: "bot-scout" };

describe("connect_github", () => {
  it("is offered only on a 1:1 turn of a server with the device flow", () => {
    expect(availableTools(PROFILE).map((tool) => tool.name)).not.toContain("connect_github");
    expect(availableTools({ ...PROFILE, githubConnect: true }).map((tool) => tool.name)).toContain("connect_github");
    expect(catalogProfileFromEnv({ SAGAX_GITHUB_CONNECT: "1" }).githubConnect).toBe(true);
    expect(catalogProfileFromEnv({ SAGAX_GITHUB_CONNECT: "1", SAGAX_EXTERNAL_RUNTIME: "1" }).githubConnect).toBe(false);
  });

  it("asks the server for the turn's person and hands the bot the code and link to show", async () => {
    const api = vi.fn<HarnessClient["api"]>(async () => ({ state: "pending", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresAt: Date.UTC(2026, 9, 20, 1, 15) }));
    const context: ToolCallContext = { botId: "bot-scout", threadId: "thread-scout", depth: 0, externalRuntime: false, sharedComputers: false, client: { api, apiResponse: vi.fn() } };
    const result = await callTool("connect_github", { reconnect: true }, context);
    expect(api).toHaveBeenCalledWith("/api/internal/github-connect", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(api.mock.calls[0]![1]!.body))).toMatchObject({ reconnect: true });
    const text = (result as { text: string }).text;
    expect(text).toContain("ABCD-1234");
    expect(text).toContain("https://github.com/login/device");
    expect(text).toContain("Grant");
    expect(text).toContain("01:15 UTC");
  });

  it("says what to do in every other state, never asking for a token", () => {
    expect(githubConnectText({ state: "connected", login: "jc", orgAccessUrl: "https://github.com/settings/connections/applications/Iv1" })).toContain("settings/connections/applications/Iv1");
    expect(githubConnectText({ state: "group" })).toContain("never in a group");
    expect(githubConnectText({ state: "not_person" })).toContain("never from a routine");
    expect(githubConnectText({ state: "admin_only" })).toContain("administrator");
    expect(githubConnectText({ state: "no_device_flow" })).toContain("read:org");
    expect(githubConnectText({ state: "error", message: "GitHub could not be reached from the server." })).toContain("could not be reached");
  });
});
