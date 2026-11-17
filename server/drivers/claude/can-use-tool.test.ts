// #4525: Claude's stdio can_use_tool reaches the same broker card as the MCP
// approve wire. An ArtifactData write shows its consent disclosure on that
// card; nothing in this handler remembers an agreement of its own (the bot's
// "ArtifactData" Always allow grant is read in request-opened).
import { describe, expect, it } from "vitest";
import { claudeCanUseTool } from "./can-use-tool.ts";
import type { Ask } from "../claude-asks.ts";
import type { ClaudeSession } from "./session-types.ts";

function harness(answer: { behavior: "allow" | "deny" | "answer"; message?: string; source: "user" | "timeout" | "system"; always?: boolean }) {
  const asks: Ask[] = [];
  const frames: any[] = [];
  const session = {
    closing: false,
    turn: { turnId: "t1", input: { botId: "b1" } },
    searchedMounts: new Set<string>(),
    permissionFacts: { preallowed: [], artifactReads: true },
    broker: { hostAsk: async (ask: Ask) => { asks.push(ask); return answer; } },
  } as unknown as ClaudeSession;
  const handler = claudeCanUseTool(() => session, async (frame) => { frames.push(frame); return true; });
  const send = async (request: Record<string, unknown>) => {
    const consumed = handler.frame({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_use_id: "toolu_1", ...request } });
    for (let i = 0; i < 20 && frames.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    return { consumed, response: frames[0]?.response?.response };
  };
  return { asks, frames, send };
}

describe("claudeCanUseTool", () => {
  it("puts an ArtifactData write's disclosure on the card and allows on the person's yes", async () => {
    const h = harness({ behavior: "allow", source: "user", always: true });
    const { consumed, response } = await h.send({
      tool_name: "ArtifactData",
      input: { action: "set", collection: "days" },
      description: "This artifact's data is shared with everyone it is shared with.",
      permission_suggestions: [{ type: "addRules" }],
    });
    expect(consumed).toBe(true);
    expect(h.asks).toHaveLength(1);
    expect(h.asks[0]).toMatchObject({ kind: "permission", tool: "ArtifactData", disclosure: "This artifact's data is shared with everyone it is shared with." });
    expect(h.asks[0]).not.toHaveProperty("explicit");
    // Allowed, and the CLI's own session rule is not handed back for a consent.
    expect(response).toEqual({ behavior: "allow", updatedInput: { action: "set", collection: "days" }, toolUseID: "toolu_1" });
  });

  it("asks a second ArtifactData write again: no agreement is kept in the handler", async () => {
    const h = harness({ behavior: "allow", source: "user" });
    await h.send({ tool_name: "ArtifactData", input: { action: "set" } });
    h.frames.length = 0;
    await h.send({ tool_name: "ArtifactData", input: { action: "set" } });
    expect(h.asks).toHaveLength(2);
  });

  it("asks an ordinary tool with no disclosure and hands back the CLI's suggestions on Always", async () => {
    const h = harness({ behavior: "allow", source: "user", always: true });
    const { response } = await h.send({ tool_name: "Write", input: { file_path: "/tmp/a" }, permission_suggestions: [{ type: "addRules" }] });
    expect(h.asks[0]).not.toHaveProperty("disclosure");
    expect(response).toMatchObject({ behavior: "allow", updatedPermissions: [{ type: "addRules" }] });
  });

  it("runs an artifact read without a card and denies on a refusal", async () => {
    const read = harness({ behavior: "allow", source: "user" });
    expect((await read.send({ tool_name: "ArtifactData", input: { action: "get" } })).response).toMatchObject({ behavior: "allow" });
    expect(read.asks).toHaveLength(0);
    const refused = harness({ behavior: "deny", message: "No", source: "user" });
    expect((await refused.send({ tool_name: "ArtifactData", input: { action: "set" } })).response).toMatchObject({ behavior: "deny", message: "No" });
  });

  it("ignores every other frame", () => {
    const h = harness({ behavior: "allow", source: "user" });
    const handler = claudeCanUseTool(() => ({}) as ClaudeSession, async () => true);
    expect(handler.frame({ type: "control_request", request_id: "r", request: { subtype: "elicitation" } })).toBe(false);
    expect(handler.frame({ type: "assistant" })).toBe(false);
    expect(h.asks).toHaveLength(0);
  });
});
