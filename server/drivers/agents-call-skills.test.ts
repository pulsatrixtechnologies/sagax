import { describe, expect, it } from "vitest";
import { callTool, type ToolCallContext } from "./agents-call.ts";

function context(reply: unknown) {
  const paths: string[] = [];
  const ctx: ToolCallContext = { botId: "fixture", threadId: "fixture-thread", depth: 0,
    externalRuntime: false, coordinating: false, sharedComputers: false,
    client: { api: async (path) => { paths.push(path); return reply as Record<string, unknown>; },
      apiResponse: async () => ({ ok: true, status: 200, body: {} }) } };
  return { ctx, paths };
}

describe("skills_list retrieval", () => {
  it("passes search and continuation through, names the read path and withholds unreviewed text", async () => {
    const { ctx, paths } = context({ skills: [
      { id: "person:plugin:packing:skill:review", name: "review", kind: "skill", scope: "person", source: "packing", enabled: true, description: "Verify packing", path: "plugins/packing/skills/review/SKILL.md" },
      { name: "pending-review", enabled: false, description: "UNREVIEWED", path: "PRIVATE" },
    ], staged: [{ action: "create", name: "draft", gist: "UNREVIEWED", source: "PRIVATE" }], total: 35, offset: 20, nextOffset: 22 });
    const result = await callTool("skills_list", { query: "review", offset: 20 }, ctx);
    const url = new URL(paths[0]!, "http://fixture");
    expect(url.searchParams.get("query")).toBe("review");
    expect(url.searchParams.get("offset")).toBe("20");
    expect(result.text).toContain('Read "plugins/packing/skills/review/SKILL.md"');
    expect(result.text).toContain('skills_list offset=22 query="review"');
    expect(result.text).toContain("person:plugin:packing:skill:review");
    expect(result.text).not.toMatch(/UNREVIEWED|PRIVATE/);
  });

  it("rejects invalid pagination locally and gives no unavailable authoring advice", async () => {
    const { ctx, paths } = context({ skills: [], staged: [], total: 0, offset: 0, nextOffset: null });
    for (const offset of [-1, 1.5, NaN, Infinity, "20"]) expect((await callTool("skills_list", { offset }, ctx)).isError).toBe(true);
    expect((await callTool("skills_list", { query: "x".repeat(201) }, ctx)).isError).toBe(true);
    expect(paths).toHaveLength(0);
    expect((await callTool("skills_list", {}, ctx)).text).not.toContain("skill_manage");
  });
});
