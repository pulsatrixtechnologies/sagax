import { describe, expect, it } from "vitest";

import type { ToolCallContext } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";
import { callConnectorSetupTool, CONNECTOR_SETUP_TOOL_NAME } from "./agents-connector-setup.ts";

function context(answers: Record<string, { ok: boolean; status: number; body: Json }>) {
  const calls: Array<{ path: string; body: Json }> = [];
  const apiResponse = async (path: string, init?: RequestInit) => {
    calls.push({ path, body: JSON.parse(String(init?.body ?? "{}")) as Json });
    return answers[path] ?? { ok: false, status: 404, body: { error: "unknown" } };
  };
  const ctx = {
    botId: "b1", threadId: "t1", depth: 0, externalRuntime: false, coordinating: false, sharedComputers: false,
    client: { api: async (path: string, init?: RequestInit) => (await apiResponse(path, init)).body, apiResponse },
  } as unknown as ToolCallContext;
  return { ctx, calls };
}

describe("open_connector_setup", () => {
  it("is the tool's name", () => {
    expect(CONNECTOR_SETUP_TOOL_NAME).toBe("open_connector_setup");
  });

  it("an engine card: one call, the bot answers in a sentence", async () => {
    const { ctx, calls } = context({
      "/api/internal/connector-setup/open": { ok: true, status: 200, body: { ok: true, route: "grok", label: "Microsoft Teams", status: "waiting", card: "posted" } },
    });
    const out = await callConnectorSetupTool({ connector: "Teams", language: "fr" }, ctx);
    expect(out.isError).toBeUndefined();
    expect(out.text).toMatch(/card .*Microsoft Teams.* is in the chat/i);
    expect(out.text).toMatch(/one short sentence/);
    expect(out.text).not.toMatch(/https?:/);
    expect(calls).toEqual([{ path: "/api/internal/connector-setup/open", body: { connector: "Teams", language: "fr" } }]);
  });

  it("already connected: says so", async () => {
    const { ctx } = context({
      "/api/internal/connector-setup/open": { ok: true, status: 200, body: { ok: true, route: "claude", label: "Gmail", status: "connected", card: "existing" } },
    });
    expect((await callConnectorSetupTool({ connector: "Gmail" }, ctx)).text).toMatch(/already connected/i);
  });

  it("a refusal is the server's sentence, as an error", async () => {
    const { ctx } = context({
      "/api/internal/connector-setup/open": { ok: false, status: 409, body: { error: "not theirs" } },
    });
    expect(await callConnectorSetupTool({ connector: "Teams" }, ctx)).toEqual({ text: "not theirs", isError: true });
  });

  it("needs a connector name", async () => {
    const { ctx, calls } = context({});
    expect((await callConnectorSetupTool({}, ctx)).isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
