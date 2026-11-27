// M-20261119-006, M-20261119-008: a member's bot never waits for an
// organization admin for work in the person's own environment. The admin
// reasons (engine-access.ts MEMBER_ADMIN_REASONS) are given only on positive
// evidence that a call leaves it; a tool nobody classified is the person's
// own card. This guard enumerates every tool a member's bot can call in its
// own place, from the catalogs themselves, so a tool added later (an engine
// update, a port, a plugin, a rename) is covered without touching this file.
import { describe, expect, it } from "vitest";

import { RENAMED_AGENT_TOOLS } from "../shared/agent-tool-renames.ts";
import { DESKTOP_BRIDGE_MCP_NAME } from "../shared/bot-workplace.ts";
import { AUTO_COMPUTER_MCP_NAME } from "./computer/auto-computer.ts";
import { DESKTOP_BRIDGE_TOOLS } from "./desktop/desktop-bridge-tools.ts";
import { everyAgentToolName } from "./drivers/agents-catalog.ts";
import { PERSPICAX_TOOLS } from "./drivers/agents-tools/perspicax.ts";
import { ORG_ENGINE_TOOLS } from "./drivers/host-tools.ts";
import { memberBotAdminReason, type MemberBotAdminInput, type MemberHostToolPlace } from "./engines/engine-access.ts";
import { SANDBOX_COMPUTER_TOOLS, USER_SANDBOX_TOOLS } from "./sandbox/user-sandbox-tools.ts";
import { USER_SANDBOX_MCP_NAME } from "./sandbox/user-sandbox-routing.ts";
import { DATA_TOOL_NAMES } from "./sagax-internal-tools.ts";

const ROOT = "/srv/sagax/task-workspaces/bot-1";
const OWN_PLACE: MemberHostToolPlace = { ownLocalVm: true, ownComputers: true, ownMcpList: true, botRoots: [ROOT] };
const ownsBot = (id: string) => id === "bot-1" || id === "bot-2";

/** What request-opened.ts knows about a call in the person's own place,
 * with no record of the mount left (the case that came back in prod). */
function inOwnPlace(tool: string, extra: Partial<MemberBotAdminInput> = {}): MemberBotAdminInput {
  return { tool, workspaceRoot: ROOT, hostPlace: OWN_PLACE, ownsBot, callerBotId: "bot-1", ...extra };
}

/** The input a tool needs to name its own place (act on the bot itself,
 * attach_file from the bot's own Local VM). */
function ownInput(tool: string): unknown {
  if (tool === "act") return { method: "GET", path: "/api/bots/bot-1" };
  if (tool === "attach_file") return { path: "/home/cua/workspace/out.png" };
  return {};
}

/** The Perspicax admin tools: they act on the organization itself. */
const ORGANIZATION_TOOLS = new Set(["api_reload", "review_write"]);

describe("the exact card of the capture (M-20261119-006)", () => {
  const command = "cd /workspace/bots/momo/tools/c300770; cat auth.log; ls -la";
  it.each([`mcp__${USER_SANDBOX_MCP_NAME}__run_command`, `${USER_SANDBOX_MCP_NAME}__run_command`])("%s in the person's cloud computer is never an admin's", (tool) => {
    // no record of the mount (turn ended, restart, another bot's turn in the thread)
    expect(memberBotAdminReason(inOwnPlace(tool, { rawInput: JSON.stringify({ command }) }))).toBeNull();
    // the engine also described the command
    expect(memberBotAdminReason(inOwnPlace(tool, { command: { command, cwd: "/workspace/bots/momo" }, rawInput: JSON.stringify({ command }) }))).toBeNull();
    // nothing at all about the turn
    expect(memberBotAdminReason({ tool, workspaceRoot: ROOT })).toBeNull();
    // the same call in a cloud computer Sagax mounted for another person stays someone else's
    expect(memberBotAdminReason(inOwnPlace(tool, { placeOfAnotherPerson: true }))).toBe("foreign-tool");
  });
});

describe("every tool a member's bot calls in its own place is the person's card, never an admin's", () => {
  const agentTools = [...everyAgentToolName(), ...Object.keys(RENAMED_AGENT_TOOLS)].filter((name) => !ORGANIZATION_TOOLS.has(name));
  it("enumerates the catalogs (a later tool is covered by itself)", () => {
    expect(agentTools.length).toBeGreaterThan(100);
  });
  it.each(agentTools.flatMap((name) => [`mcp__agents__${name}`, `agents__${name}`]))("Sagax tool %s", (tool) => {
    const name = tool.replace(/^(?:mcp__)?agents__/, "");
    expect(memberBotAdminReason(inOwnPlace(tool, { rawInput: ownInput(name) }))).toBeNull();
  });
  it.each(PERSPICAX_TOOLS.map((tool) => tool.name).filter((name) => !ORGANIZATION_TOOLS.has(name)))("Perspicax tool %s on the person's own mount", (name) => {
    expect(memberBotAdminReason(inOwnPlace(`mcp__perspicax__${name}`, { ownerScopedMcpServer: (server) => server === "perspicax" }))).toBeNull();
  });
  it.each(DATA_TOOL_NAMES.map((name) => `mcp__data__${name}`))("Data tool %s", (tool) => {
    expect(memberBotAdminReason(inOwnPlace(tool))).toBeNull();
  });
  const places: Array<[string, readonly { name: string }[]]> = [
    [USER_SANDBOX_MCP_NAME, [...USER_SANDBOX_TOOLS, ...SANDBOX_COMPUTER_TOOLS]],
    [DESKTOP_BRIDGE_MCP_NAME, DESKTOP_BRIDGE_TOOLS],
    [AUTO_COMPUTER_MCP_NAME, [{ name: "computer_select" }]],
  ];
  it.each(places.flatMap(([server, tools]) => tools.map((tool) => `mcp__${server}__${tool.name}`)))("person place tool %s, with or without a record of the mount", (tool) => {
    expect(memberBotAdminReason(inOwnPlace(tool))).toBeNull();
    expect(memberBotAdminReason(inOwnPlace(tool, { ownDestination: true }))).toBeNull();
    expect(memberBotAdminReason(inOwnPlace(tool, { paths: ["/workspace/bots/momo/a.txt"] }))).toBeNull();
  });
  it.each(Object.entries(ORG_ENGINE_TOOLS).flatMap(([engine, tools]) => tools.allow.map((name) => [engine, name])))("%s built-in %s offered on an organization turn", (_engine, name) => {
    expect(memberBotAdminReason(inOwnPlace(name))).toBeNull();
  });
  it.each([
    "mcp__agents__a_tool_added_next_year",
    "agents__renamed_some_day",
    "mcp__a-server-mounted-later__do_something",
    "mcp__port_of_omb__exec",
    `mcp__${USER_SANDBOX_MCP_NAME}__a_tool_added_next_year`,
    "ANativeToolOfANewEngine",
    "other",
  ])("an invented name %s", (tool) => {
    expect(memberBotAdminReason(inOwnPlace(tool))).toBeNull();
  });
});

describe("what still waits for an organization admin: a real step out of the person's environment", () => {
  it("a bot of another person, or a route of the organization or its billing", () => {
    expect(memberBotAdminReason(inOwnPlace("mcp__agents__act", { rawInput: { method: "PATCH", path: "/api/bots/someone-elses" } }))).toBe("other-bot-act");
    expect(memberBotAdminReason(inOwnPlace("mcp__agents__act", { rawInput: { method: "POST", path: "/api/billing/checkout" } }))).toBe("other-bot-act");
    expect(memberBotAdminReason(inOwnPlace("mcp__agents__act", { rawInput: { method: "POST", path: "/api/org/members" } }))).toBe("other-bot-act");
  });
  it("a command on the organization's shared server", () => {
    expect(memberBotAdminReason(inOwnPlace("Bash", { command: { command: "ls", cwd: ROOT } }))).toBe("host-shell");
    expect(memberBotAdminReason(inOwnPlace("exec_command"))).toBe("host-shell");
    expect(memberBotAdminReason(inOwnPlace("mcp__shell__run"))).toBe("host-shell");
    expect(memberBotAdminReason(inOwnPlace("WebFetch"))).toBe("host-engine-tool");
    expect(memberBotAdminReason(inOwnPlace("mcp__computer__click"))).toBe("host-engine-tool");
    // #5229, #5334: built-in browser stays the member bot's own web surface.
    expect(memberBotAdminReason(inOwnPlace("mcp__browser__agent_browser_open"))).toBeNull();
    expect(memberBotAdminReason(inOwnPlace("Read", { paths: ["/etc/passwd"] }))).toBe("outside-own-folders");
  });
  it("a place, a server or an account that is not the person's", () => {
    expect(memberBotAdminReason(inOwnPlace(`mcp__${DESKTOP_BRIDGE_MCP_NAME}__run_command`, { placeOfAnotherPerson: true }))).toBe("foreign-tool");
    expect(memberBotAdminReason(inOwnPlace("mcp__org_shared__query", { orgSharedMcpServer: (server) => server === "org_shared" }))).toBe("foreign-tool");
    expect(memberBotAdminReason(inOwnPlace("mcp__claude_ai_Microsoft_365__outlook_email_search"))).toBe("foreign-tool");
  });
  it("the organization's Perspicax admin tools, a pooled Local VM, the server's shared MCP list", () => {
    for (const name of ORGANIZATION_TOOLS) expect(memberBotAdminReason(inOwnPlace(`mcp__agents__${name}`))).toBe("host-tool");
    expect(memberBotAdminReason(inOwnPlace("mcp__agents__vm_exec", { hostPlace: { ...OWN_PLACE, ownLocalVm: false } }))).toBe("host-tool");
    expect(memberBotAdminReason(inOwnPlace("mcp__agents__add_mcp_server", { hostPlace: { ...OWN_PLACE, ownMcpList: false } }))).toBe("host-tool");
  });
});
