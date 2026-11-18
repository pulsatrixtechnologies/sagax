// What a Claude turn pre-allows of the agents MCP (claude.ts agentsAllowedTools):
// everything but shared_computer, which acts on a person's own computer and
// so goes through the permission prompt (the bot's approval mode decides).
import { describe, expect, it } from "vitest";
import { agentsAllowedTools } from "./claude.ts";

describe("agents MCP pre-allow", () => {
  it("is the whole server while computer sharing is off", () => {
    expect(agentsAllowedTools({ SAGAX_BOT_ID: "b1" })).toEqual(["mcp__agents"]);
    expect(agentsAllowedTools(undefined)).toEqual(["mcp__agents"]);
  });

  it("does not pre-allow a write to the person's API", () => {
    const tools = JSON.stringify([
      { name: "getnote", method: "get", path: "/notes/{id}", summary: "Read", params: [], body: false },
      { name: "createnote", method: "post", path: "/notes", summary: "Create", params: [], body: true },
    ]);
    const allowed = agentsAllowedTools({ SAGAX_BOT_ID: "b1", SAGAX_OPENAPI_TOOLS: tools });
    expect(allowed).not.toContain("mcp__agents");
    expect(allowed).toContain("mcp__agents__openapi_getnote");
    expect(allowed).not.toContain("mcp__agents__openapi_createnote");
    expect(allowed).toContain("mcp__agents__list_bots");
  });

  it("names each tool but shared_computer while it is on", () => {
    const allowed = agentsAllowedTools({ SAGAX_BOT_ID: "b1", SAGAX_SHARED_COMPUTERS_ENABLED: "1" });
    expect(allowed).not.toContain("mcp__agents");
    expect(allowed).not.toContain("mcp__agents__shared_computer");
    expect(allowed).toContain("mcp__agents__list_shared_computers");
    expect(allowed).toContain("mcp__agents__list_bots");
    expect(allowed.every((name) => name.startsWith("mcp__agents__"))).toBe(true);
  });

  it("leaves remote_session_exec to the permission prompt so its card shows (#4575)", () => {
    const allowed = agentsAllowedTools({ SAGAX_BOT_ID: "b1", SAGAX_PERSPICAX_TOOLS: "1" });
    expect(allowed).not.toContain("mcp__agents");
    expect(allowed).not.toContain("mcp__agents__remote_session_exec");
    expect(allowed).toContain("mcp__agents__remote_session_snapshot");
    expect(allowed).toContain("mcp__agents__list_bots");
  });
});
