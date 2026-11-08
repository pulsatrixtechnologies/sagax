import { describe, expect, it, vi } from "vitest";
import { IMAGE_PROMPT } from "../system-prompt.ts";
import { unknownAgentToolRefusal } from "../people/member-tool-scope.ts";
import {
  availableTools,
  catalogProfileFromEnv,
  compactListed,
  COMPACT_CORE_AGENT_TOOL_NAMES,
  DEFERRED_AGENT_TOOL_NAMES,
} from "./agents-catalog.ts";
import { callImageTool, IMAGE_TOOL_NAME } from "./agents-image.ts";
import type { HarnessClient } from "./agents-client.ts";

// #2954: "put this person in Paris" on an attached photo reaches make_image on
// the first call, on every engine, never after a skill or tool search.
describe("make_image (#2954)", () => {
  it("is in every catalog, always loaded and never deferred", () => {
    for (const env of [{ SAGAX_BOT_ID: "bot-a" }, { SAGAX_BOT_ID: "bot-a", SAGAX_EXTERNAL_RUNTIME: "1" }, { SAGAX_BOT_ID: "bot-a", SAGAX_GROUP_TURN: "1" }, { SAGAX_BOT_ID: "bot-a", SAGAX_PEER_HOP: "1" }]) {
      const names = availableTools(catalogProfileFromEnv(env)).map((tool) => tool.name);
      expect(names).toContain(IMAGE_TOOL_NAME);
    }
    expect(DEFERRED_AGENT_TOOL_NAMES.has(IMAGE_TOOL_NAME)).toBe(false);
    expect(COMPACT_CORE_AGENT_TOOL_NAMES.has(IMAGE_TOOL_NAME)).toBe(true);
    expect(compactListed(IMAGE_TOOL_NAME, { core: "used", pinned: new Set(), coordinating: true })).toBe(true);
    expect(compactListed(IMAGE_TOOL_NAME, { core: "default", pinned: new Set(), coordinating: true })).toBe(true);
  });

  it("the prompt sends an edit straight to make_image, without a skill search", () => {
    expect(IMAGE_PROMPT).toContain("make_image");
    expect(IMAGE_PROMPT).toContain("Do not search skills or tools");
    expect(IMAGE_PROMPT).toContain("at most one short sentence");
    expect(IMAGE_PROMPT).toContain("Settings > Providers");
    expect(unknownAgentToolRefusal("imagine")).toContain("make_image");
  });

  it("an edit request on an attached image is one direct call to the image route", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const client = {
      api: vi.fn(),
      apiResponse: vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({ path, body: JSON.parse(String(init?.body)) });
        return { ok: true, status: 200, body: { ok: true, text: "Edited the image with xAI Grok Imagine; it is already shown in the chat." } };
      }),
    } as unknown as HarnessClient;
    const result = await callImageTool({ prompt: "Put this person in Paris." }, client);
    expect(calls).toEqual([{ path: "/api/internal/image", body: { prompt: "Put this person in Paris." } }]);
    expect(calls.some((call) => call.path.includes("skills"))).toBe(false);
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("already shown in the chat");
  });

  it("no provider is one actionable line, as an error", async () => {
    const client = {
      api: vi.fn(),
      apiResponse: vi.fn(async () => ({ ok: false, status: 409, body: { error: "No image provider is connected. Connect xAI (Grok Imagine) or OpenAI in Settings > Providers, then ask again.", code: "no_provider" } })),
    } as unknown as HarnessClient;
    const result = await callImageTool({ prompt: "x" }, client);
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Settings > Providers");
  });
});
