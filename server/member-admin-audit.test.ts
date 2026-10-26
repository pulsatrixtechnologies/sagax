// The member admin audit (docs/member-admin-audit.md) as tests: every row of
// its tables, for a member and for an admin, on each destination. A change
// that moves a row must change the document and this file together.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { APPROVAL_MODES, type ApprovalMode } from "../shared/approval-mode.ts";
import { DESKTOP_BRIDGE_MCP_NAME } from "../shared/bot-workplace.ts";
import { ADMIN_ONLY_PERMISSIONS, can, isPermissionKey, normalizePermissions } from "../shared/permissions.ts";
import { autoVerdict } from "./auto-approve.ts";
import { memberBotAdminApproval, memberOwnedBot } from "./engine-access.ts";
import { decide } from "./mcp-permissions.ts";
import { HOST_LEVEL_AGENT_TOOLS } from "./member-tool-scope.ts";
import { ownComputerChoiceCall, ownDestinationCall } from "./member-environment.ts";
import { terminalResourceAllowed } from "./terminal-resources/registry.ts";
import type { TerminalAccess } from "./terminal-resources/types.ts";
import { USER_SANDBOX_MCP_NAME } from "./user-sandbox-routing.ts";

const DOC = readFileSync(new URL("../docs/member-admin-audit.md", import.meta.url), "utf8");
const OWNER = "pr_member";
const MOUNTED = new Set([USER_SANDBOX_MCP_NAME, DESKTOP_BRIDGE_MCP_NAME]);

/** Who answers a card of a member's bot for this call: "owner" or "admin".
 * An admin's own bot never has an admin card (memberOwnedBot). */
function answerer(tool: string, options: { environment?: string | null; mounted?: ReadonlySet<string>; holder?: boolean; command?: unknown } = {}): "owner" | "admin" {
  const ownDestination = ownDestinationCall({
    identity: "perspicax", tool, environmentPrincipalId: options.environment === undefined ? OWNER : options.environment,
    ownerPrincipalId: OWNER, guestDriven: false, mountedServers: options.mounted ?? MOUNTED,
  });
  return memberBotAdminApproval({
    tool, command: options.command, workspaceRoot: "/nowhere", ownDestination, ownerRunsServerCommands: options.holder === true,
  }) ? "admin" : "owner";
}

describe("member admin audit, section 1: bot tool calls", () => {
  const desktop = ["run_command", "read_file", "write_file", "list_files", "search_files", "fetch_url", "browse", "local_vm", "computer_list_tools", "computer_use"];
  const sandbox = ["run_command", "read_file", "write_file", "list_files", "browse", "computer_list_tools", "computer_use"];

  it.each(desktop)("sagax-desktop %s on the owner's own computer: the owner's card", (tool) => {
    expect(answerer(`mcp__${DESKTOP_BRIDGE_MCP_NAME}__${tool}`)).toBe("owner");
  });
  it.each(sandbox)("sagax-environment %s in the owner's own cloud computer: the owner's card", (tool) => {
    expect(answerer(`mcp__${USER_SANDBOX_MCP_NAME}__${tool}`)).toBe("owner");
  });
  // Prod 0.5.27: a member's bot asked "Computer select dans Sagax Computer"
  // and the card waited for an admin. JC (#810 follow-up): the bot decides
  // where it works, so choosing among the person's own places has no card.
  const choice = (tool: string, mode: ApprovalMode, options: { mounted?: boolean; places?: string | null; persons?: readonly string[]; guest?: boolean } = {}): "none" | "owner" | "admin" => {
    const ownComputerChoice = ownComputerChoiceCall({
      identity: "perspicax", tool, mounted: options.mounted ?? true,
      choicePrincipalId: options.places === undefined ? OWNER : options.places,
      personPrincipalIds: options.persons ?? [OWNER], guestDriven: options.guest === true,
    });
    if (memberBotAdminApproval({ tool, workspaceRoot: "/nowhere", ownComputerChoice })) return "admin";
    return autoVerdict(mode, tool, { ownComputerChoice }).approve ? "none" : "owner";
  };
  const MODES: ApprovalMode[] = [...APPROVAL_MODES];
  it.each(MODES.flatMap((mode) => [
    ["mcp__sagax-computer__computer_select", mode],
    ["sagax-computer__computer_select", mode],
  ]))("%s at %s (choosing among the person's own places): no card", (tool, mode) => {
    expect(choice(tool, mode as ApprovalMode)).toBe("none");
  });
  it("the speaker's own places on a bot someone else owns: no card", () => {
    expect(choice("mcp__sagax-computer__computer_select", "ask", { places: "pr_speaker", persons: [OWNER, "pr_speaker"] })).toBe("none");
  });
  it("the safety hold, the person's ask rule and their security key still come first", () => {
    for (const extra of [{ safetyHold: true }, { customRule: { behavior: "ask" as const, id: "r" } }, { stepUpRequired: ["screen"] }]) {
      expect(autoVerdict("full", "mcp__sagax-computer__computer_select", { ownComputerChoice: true, ...extra }).source).not.toBe("own-computer-choice");
    }
  });
  it.each([
    ["not mounted by Sagax this turn", { mounted: false }],
    ["someone else's places", { places: "pr_someone_else" }],
    ["no person decided", { places: null }],
    ["the turn is for someone else", { persons: ["pr_someone_else"] }],
    ["a guest drives the turn", { guest: true }],
  ] as const)("computer_select not the person's own choice (%s): an admin's card", (_label, options) => {
    expect(choice("mcp__sagax-computer__computer_select", "ask", options)).toBe("admin");
  });
  it.each(["mcp__sagax-computer__computer_use", "mcp__computer__computer_select", "mcp__agents__shared_computer", "computer_select"])("%s is not the computer choice (a shared computer keeps its card): an admin's card", (tool) => {
    expect(choice(tool, "ask")).toBe("admin");
  });

  it.each([
    ["someone else's destination", { environment: "pr_someone_else" }],
    ["no destination mounted this turn", { mounted: new Set<string>() }],
    ["no environment decided", { environment: null }],
  ] as const)("not the owner's own destination (%s): an admin's card", (_label, options) => {
    expect(answerer(`mcp__${DESKTOP_BRIDGE_MCP_NAME}__run_command`, options)).toBe("admin");
    expect(answerer(`mcp__${USER_SANDBOX_MCP_NAME}__run_command`, options)).toBe("admin");
  });

  it.each(["Bash", "shell", "exec_command", "run_shell_command", "local_shell"])("the engine's own %s on the shared host: an admin's, or the owner's by hand with host.commands", (tool) => {
    expect(answerer(tool, { command: { command: "ls" } })).toBe("admin");
    expect(answerer(tool, { command: { command: "ls" }, holder: true })).toBe("owner");
  });
  it.each(["Read", "Write", "Edit", "Glob", "Grep"])("the engine's own %s outside the bot's workspace: an admin's", (tool) => {
    expect(memberBotAdminApproval({ tool, paths: ["/etc/passwd"], workspaceRoot: "/nowhere" })).toBe(true);
  });
  it.each([...HOST_LEVEL_AGENT_TOOLS])("agents %s (host level): an admin's, delegable with host.commands", (tool) => {
    expect(answerer(`mcp__agents__${tool}`)).toBe("admin");
    expect(answerer(`mcp__agents__${tool}`, { holder: true })).toBe("owner");
  });
  it.each(["list_bots", "ask_bot", "memory_write", "offer_shell_terminal", "list_terminal_resources", "propose_team_setup"])("agents %s (the member's own scope): the owner's card", (tool) => {
    expect(answerer(`mcp__agents__${tool}`)).toBe("owner");
  });
  it("the terminal offer still goes to an admin when a command is described or another server spells it", () => {
    expect(memberBotAdminApproval({ tool: "mcp__agents__offer_shell_terminal", command: { command: "ls" }, workspaceRoot: "/nowhere" })).toBe(true);
    expect(memberBotAdminApproval({ tool: "mcp__agents__offer_shell_terminal", workspaceRoot: "/nowhere", foreignMcpServers: ["agents"] })).toBe(true);
    expect(memberBotAdminApproval({ tool: "mcp__agents__offer_shell_terminal", workspaceRoot: "/nowhere" })).toBe(false);
  });
  it.each(["browser", "computer", "files", "shell", "terminal"])("the %s MCP server on the shared host: an admin's", (server) => {
    expect(answerer(`mcp__${server}__run`)).toBe("admin");
  });
  it("an admin's own bot never has an admin card; a member's always can", () => {
    expect(memberOwnedBot({ identity: "perspicax", ownerOrgRole: "admin" })).toBe(false);
    expect(memberOwnedBot({ identity: "perspicax", ownerOrgRole: "member" })).toBe(true);
    expect(memberOwnedBot({ identity: "solo", ownerOrgRole: undefined })).toBe(false);
  });
});

describe("member admin audit, section 2: in-chat terminal", () => {
  const people: Record<string, TerminalAccess> = {
    "member, own bot": { organization: true, admin: false, ownsBot: true, ownsConversation: true },
    "member, own conversation with a shared bot": { organization: true, admin: false, ownsBot: false, ownsConversation: true },
    "member answering someone else's card": { organization: true, admin: false, ownsBot: false, ownsConversation: false },
    "member with host.commands": { organization: true, admin: false, ownsBot: true, ownsConversation: true, serverHosts: true },
    "admin": { organization: true, admin: true, ownsBot: false, ownsConversation: false },
  };
  const expected: Record<string, { personal: boolean; server: boolean }> = {
    "member, own bot": { personal: true, server: false },
    "member, own conversation with a shared bot": { personal: true, server: false },
    "member answering someone else's card": { personal: false, server: false },
    "member with host.commands": { personal: true, server: true },
    "admin": { personal: true, server: true },
  };
  it.each(Object.keys(people))("%s", (who) => {
    expect(terminalResourceAllowed({ scope: "personal" }, people[who])).toBe(expected[who]!.personal);
    expect(terminalResourceAllowed({ scope: "server" }, people[who])).toBe(expected[who]!.server);
  });
});

describe("member admin audit, section 3: MCP permission catalogue", () => {
  const own = ["rules_update", "docs_update", "request_login", "select_computer", "manage_pairing", "propose_team_setup", "create_bot", "propose_bot_deletion", "create_room", "manage_room"];
  const reserved = ["propose_team_memory", "create_agent", "delete_agent", "add_mcp_server", "request_credential", "shared_computer", "vm_exec", "act", "manage_settings", "api_reload", "review_write", "memory_promote", "memory_review"];

  it.each(own)("%s: a member's own work (self scope); an admin's too", (tool) => {
    expect(decide({ id: OWNER, role: "member" }, tool, "self").allowed).toBe(true);
    expect(decide({ id: "pr_admin", role: "admin" }, tool, "org").allowed).toBe(true);
    expect(DOC).toContain(`\`${tool}\``);
  });
  it.each(reserved)("%s: reserved (admin tier) for a member; an admin's", (tool) => {
    expect(decide({ id: OWNER, role: "member" }, tool, "self").allowed).toBe(false);
    expect(decide({ id: "pr_admin", role: "admin" }, tool, "org").allowed).toBe(true);
    expect(DOC).toContain(`\`${tool}\``);
  });
  it.each(["manage_pairing", "request_login", "propose_team_setup", "rules_update", "docs_update", "create_bot"])("a turn no person speaks in (routine, webhook) never calls %s", (tool) => {
    expect(decide({ id: "bot", role: "service" }, tool, "self").allowed).toBe(false);
  });
});

describe("member admin audit, section 4: permission keys", () => {
  it("host.commands is given by Perspicax, never held by default", () => {
    expect(isPermissionKey("host.commands")).toBe(true);
    expect(normalizePermissions(["host.commands"]).granted).toEqual(["host.commands"]);
    expect(can({ admin: false, permissions: [] }, "host.commands")).toBe(false);
    expect(can({ admin: false, permissions: ["host.commands"] }, "host.commands")).toBe(true);
    expect(can({ admin: true, permissions: [] }, "host.commands")).toBe(true);
  });
  it.each(["host.shell", "backup.workspace", "server.settings", "people.manage"] as const)("%s is given in Perspicax (2026-10-19), and the document says so", (key) => {
    expect(ADMIN_ONLY_PERMISSIONS).not.toContain(key);
    expect(can({ admin: false, permissions: [] }, key)).toBe(false);
    expect(can({ admin: false, permissions: [key] }, key)).toBe(true);
    expect(can({ admin: true, permissions: [] }, key)).toBe(true);
    expect(DOC).toContain(`\`${key}\``);
  });
  it("only server.link stays admin only: it decides who reaches the server at all", () => {
    expect([...ADMIN_ONLY_PERMISSIONS]).toEqual(["server.link"]);
    expect(can({ admin: false, permissions: ["server.link"] }, "server.link")).toBe(false);
  });
});
