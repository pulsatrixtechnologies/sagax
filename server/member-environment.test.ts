import { describe, expect, it } from "vitest";

import { autoVerdict } from "./auto-approve.ts";
import { gateReadOnlyTools } from "./drivers/acp/grok-approval-gate.ts";
import { memberBotAdminApproval } from "./engine-access.ts";
import { mcpServerNameError } from "./mcp-registry.ts";
import {
  memberEnvironmentAutonomyAllowed,
  ownEnvironmentAutonomy,
  ownEnvironmentCall,
  ownEnvironmentReadTool,
  ownEnvironmentSensitiveRead,
  ownEnvironmentTool,
  ownEnvironmentTurnOrigin,
  ownAttachmentRead,
  ownDestinationCall,
  normalizedDestinationPath,
} from "./member-environment.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";
import { USER_SANDBOX_MCP_NAME } from "./user-sandbox-routing.ts";
import { DESKTOP_BRIDGE_MCP_NAME } from "../shared/bot-workplace.ts";
import { callStepUpClasses } from "./step-up-gate.ts";

const OWNER = "pr_owner";
const MOUNTED = new Set([USER_SANDBOX_MCP_NAME, DESKTOP_BRIDGE_MCP_NAME]);
const call = (over: Partial<Parameters<typeof ownEnvironmentCall>[0]> = {}) => ownEnvironmentCall({
  identity: "perspicax", policyAllowed: true, tool: "mcp__sagax-environment__run_command",
  environmentPrincipalId: OWNER, ownerPrincipalId: OWNER, guestDriven: false, mountedServers: MOUNTED, ...over,
});
const origin = (over: Partial<Parameters<typeof ownEnvironmentTurnOrigin>[0]> = {}) => ownEnvironmentTurnOrigin({
  speaker: { origin: "person", principalId: OWNER }, ownerPrincipalId: OWNER,
  internalTurn: false, routineLineage: false, automation: false, unattended: false, ...over,
});
const autonomy = (over: Partial<Parameters<typeof ownEnvironmentAutonomy>[0]> = {}) => ownEnvironmentAutonomy({
  call: true, mode: "auto", tool: "mcp__sagax-environment__run_command", origin: "owner", stepUpRequired: [], ...over,
});

describe("the owner's own environment (2026-10-16)", () => {
  it("names the server environment's tools and the Local VM exactly", () => {
    expect(ownEnvironmentTool("mcp__sagax-environment__run_command")).toBe("server-environment");
    expect(ownEnvironmentTool("sagax-environment__write_file")).toBe("server-environment");
    expect(ownEnvironmentTool("sagax-desktop__local_vm")).toBe("local-vm");
    expect(ownEnvironmentTool("mcp__sagax-desktop__local_vm")).toBe("local-vm");
    // This computer, another server, a look-alike, an unknown tool: none.
    for (const name of ["sagax-desktop__run_command", "sagax-desktop__computer_use", "sagax-environment__unknown", "sagax-environment2__run_command",
      "my-sagax-environment__run_command", "sagax-environment__run_command x", "run_command", "Bash", "", undefined]) {
      expect(ownEnvironmentTool(name)).toBeNull();
    }
  });

  it("is on unless an admin turned it off", () => {
    expect(memberEnvironmentAutonomyAllowed(undefined)).toBe(true);
    expect(memberEnvironmentAutonomyAllowed({})).toBe(true);
    expect(memberEnvironmentAutonomyAllowed({ memberEnvironmentAutonomy: true })).toBe(true);
    expect(memberEnvironmentAutonomyAllowed({ memberEnvironmentAutonomy: false })).toBe(false);
  });

  it("holds only in the owner's own environment, on an organization server, while allowed", () => {
    expect(call()).toBe(true);
    expect(call({ environmentPrincipalId: "PR_OWNER " })).toBe(true);
    expect(call({ environmentPrincipalId: "pr_someone_else" })).toBe(false);
    expect(call({ environmentPrincipalId: null })).toBe(false);
    expect(call({ policyAllowed: false })).toBe(false);
    expect(call({ identity: "solo" })).toBe(false);
    expect(call({ guestDriven: true })).toBe(false);
    expect(call({ tool: "sagax-desktop__computer_use" })).toBe(false);
  });

  it("recognizes the environment by the mount Sagax made for this turn, never by the name alone", () => {
    // a person's own server under the reserved name, or no mount this turn
    expect(call({ mountedServers: new Set() })).toBe(false);
    expect(call({ mountedServers: new Set([DESKTOP_BRIDGE_MCP_NAME]) })).toBe(false);
    expect(call({ tool: "sagax-desktop__local_vm", mountedServers: new Set([USER_SANDBOX_MCP_NAME]) })).toBe(false);
    expect(call({ tool: "sagax-desktop__local_vm", mountedServers: new Set([DESKTOP_BRIDGE_MCP_NAME]) })).toBe(true);
    // and nobody may name a server like them
    expect(mcpServerNameError(USER_SANDBOX_MCP_NAME)).toMatch(/reserved/);
    expect(mcpServerNameError(DESKTOP_BRIDGE_MCP_NAME)).toMatch(/reserved/);
  });

  it("is never an admin approval, and everything else keeps the admin route", () => {
    const base = { tool: "mcp__sagax-environment__run_command", workspaceRoot: "/tmp/none" };
    expect(memberBotAdminApproval(base)).toBe(true);
    expect(memberBotAdminApproval({ ...base, ownEnvironment: true })).toBe(false);
    expect(memberBotAdminApproval({ tool: "Bash", command: { command: "ls" }, workspaceRoot: "/tmp/none" })).toBe(true);
  });
});

describe("own-environment autonomy, security review 2026-10-16", () => {
  it("only the owner's own request is the owner's turn", () => {
    expect(origin()).toBe("owner");
    expect(origin({ speaker: { origin: "operator" } })).toBe("owner");
    expect(origin({ speaker: { origin: "person", principalId: "PR_OWNER" } })).toBe("owner");
    // another bot (ask, delegate, coordinate, a peer ask)
    expect(origin({ speaker: { origin: "peer", fromBotId: "b2", principalId: OWNER } })).toBe("other");
    expect(origin({ internalTurn: true })).toBe("other");
    // a routine, a webhook, a typed trigger, an email, any automation
    expect(origin({ speaker: { origin: "owner-routine" } })).toBe("other");
    expect(origin({ routineLineage: true })).toBe("other");
    expect(origin({ automation: true })).toBe("other");
    expect(origin({ unattended: true })).toBe("other");
    // someone else, an unknown person, nothing known
    expect(origin({ speaker: { origin: "person", principalId: "pr_bob" } })).toBe("other");
    expect(origin({ speaker: { origin: "person" } })).toBe("other");
    expect(origin({ speaker: undefined })).toBe("other");
  });

  it("runs unasked only at Auto or Auto-accept edits, never at Ask", () => {
    expect(autonomy({ mode: "auto" })).toBe(true);
    expect(autonomy({ mode: "edits" })).toBe(true);
    expect(autonomy({ mode: "ask" })).toBe(false);
    expect(autonomy({ mode: "custom" })).toBe(false);
    expect(autonomy({ call: false })).toBe(false);
  });

  it("never when the person protects one of the call's classes with a security key", () => {
    expect(autonomy({ stepUpRequired: ["destructive"] })).toBe(false);
    expect(autonomy({ stepUpRequired: ["irreversible"], tool: "sagax-environment__read_file" })).toBe(false);
  });

  it("another bot's or an automation's turn gets the reads only", () => {
    expect(autonomy({ origin: "other" })).toBe(false);
    expect(autonomy({ origin: "other", tool: "sagax-environment__write_file" })).toBe(false);
    expect(autonomy({ origin: "other", tool: "sagax-environment__browse" })).toBe(false);
    expect(autonomy({ origin: "other", tool: "sagax-desktop__local_vm" })).toBe(false);
    expect(autonomy({ origin: "other", tool: "mcp__sagax-environment__read_file" })).toBe(true);
    expect(autonomy({ origin: "other", tool: "sagax-environment__list_files" })).toBe(true);
    expect(ownEnvironmentReadTool("sagax-environment__run_command")).toBe(false);
    expect(ownEnvironmentReadTool("sagax-desktop__read_file")).toBe(false);
  });

  it("auto-approves after the safety hold and the person's deny and ask rules, never a widening, a send or a keyed class", () => {
    expect(autoVerdict("auto", "mcp__sagax-environment__run_command", { ownEnvironment: true })).toMatchObject({ source: "own-environment" });
    expect(autoVerdict("edits", "other", { ownEnvironment: true })).toMatchObject({ source: "own-environment" });
    // Ask means the person sees every call
    expect(autoVerdict("ask", "mcp__sagax-environment__run_command", { ownEnvironment: true }).approve).toBeNull();
    expect(autoVerdict("auto", "x", { ownEnvironment: true, safetyHold: true }).approve).toBeNull();
    expect(autoVerdict("auto", "x", { ownEnvironment: true, customRule: { behavior: "deny", id: "r" } }).source).toBe("custom-rule-deny");
    expect(autoVerdict("auto", "x", { ownEnvironment: true, customRule: { behavior: "ask", id: "r" } }).source).toBe("custom-rule-ask");
    expect(autoVerdict("auto", "x", { ownEnvironment: true, requiresExplicitApproval: true }).approve).toBeNull();
    expect(autoVerdict("auto", "x", { ownEnvironment: true, stepUpRequired: ["destructive"] }).approve).toBeNull();
    expect(autoVerdict("auto", "AskUserQuestion", { ownEnvironment: true }).approve).toBeNull();
    expect(autoVerdict("auto", "mcp__sagax-environment__run_command").approve).toBeNull();
    // the Grok gate now sends these calls here: the same rules answer its card
    expect(autoVerdict("auto", "other", { ownEnvironment: true, sagaxGate: true, toolName: "sagax-environment__run_command" }).source).toBe("own-environment");
    expect(autoVerdict("ask", "other", { ownEnvironment: true, sagaxGate: true }).approve).toBeNull();
  });

  it("re-review 2026-10-17: another bot's or an automation's read never reaches a dotfile or a credential path", () => {
    const read = (path: unknown) => autonomy({ origin: "other", tool: "sagax-environment__read_file", input: JSON.stringify({ path }) });
    for (const path of [
      "/workspace/.git-credentials", ".git-credentials", "~/.config/gh/hosts.yml", "/home/u/.ssh/id_ed25519", "/workspace/.netrc",
      ".npmrc", "/root/.aws/credentials", "/home/u/.docker/config.json", ".kube/config", "/workspace/.env", "notes/../.ssh/id_rsa",
      "/workspace/../etc/shadow", "keys/server.pem", "/workspace/id_rsa", "/workspace/credentials.json", "/workspace/%2essh/x",
    ]) {
      expect(read(path), path).toBe(false);
      expect(ownEnvironmentSensitiveRead(JSON.stringify({ path })), path).toBe(true);
    }
    expect(read(42)).toBe(false);
    expect(autonomy({ origin: "other", tool: "sagax-environment__read_file", input: "not json" })).toBe(false);
    expect(autonomy({ origin: "other", tool: "sagax-environment__list_files", input: JSON.stringify({ path: "/workspace/.ssh" }) })).toBe(false);
    // ordinary reads still run, and a listing of the working folder
    expect(read("/workspace/report.csv")).toBe(true);
    expect(read("notes/today.md")).toBe(true);
    expect(autonomy({ origin: "other", tool: "sagax-environment__list_files", input: "{}" })).toBe(true);
    expect(autonomy({ origin: "other", tool: "sagax-environment__computer_list_tools" })).toBe(true);
    // the owner's own turn is not limited this way (their own key classes are)
    expect(autonomy({ origin: "owner", tool: "sagax-environment__read_file", input: JSON.stringify({ path: "~/.ssh/id_rsa" }) })).toBe(true);
  });

  it("#875 2026-10-22: a read of the bot's own Sagax-made workspace is a plain read, not a dotfile", () => {
    const WS = "0f1e2d3c-4b5a-6789-0123-456789abcdef";
    const read = (path: unknown, tool = "sagax-environment__read_file") =>
      autonomy({ origin: "other", tool, input: JSON.stringify({ path }) });
    // the workspace tree sits under the server data dir (~/.sagax, legacy
    // ~/.openmausbot), whose own name begins with a dot: that data-dir dotfile
    // is not a user credential, so a read of the bot's own work area runs
    // unasked even on a turn that is not the owner's own (never a card).
    for (const path of [
      `/data/.openmausbot/workspaces/${WS}`,
      `/data/.sagax/workspaces/${WS}/notes/today.md`,
      `/srv/.openmausbot/task-workspaces/${WS}/${WS}/report.csv`,
      `/home/sagax/.sagax/parallel-worktrees/${WS}/${WS}`,
    ]) {
      expect(ownEnvironmentSensitiveRead(JSON.stringify({ path })), path).toBe(false);
      expect(read(path), path).toBe(true);
      expect(read(path, "sagax-environment__list_files"), path).toBe(true);
    }
    // a credential path BELOW the workspace root still cards on a non-owner turn
    for (const path of [
      `/data/.openmausbot/workspaces/${WS}/.ssh/id_rsa`,
      `/data/.sagax/workspaces/${WS}/.env`,
      `/data/.sagax/workspaces/${WS}/credentials.json`,
      `/data/.sagax/workspaces/${WS}/../.ssh/id_rsa`,
    ]) {
      expect(ownEnvironmentSensitiveRead(JSON.stringify({ path })), path).toBe(true);
      expect(read(path), path).toBe(false);
    }
    // a write of the bot's own workspace is not a read tool: it still gates
    expect(autonomy({ origin: "other", tool: "sagax-environment__write_file", input: JSON.stringify({ path: `/data/.sagax/workspaces/${WS}/x` }) })).toBe(false);
  });

  it("re-review 2026-10-17: the Local VM's run is destructive and irreversible, like run_command", () => {
    const vm = callStepUpClasses({ tool: "other", mcpTool: "sagax-desktop__local_vm", input: JSON.stringify({ action: "run", command: "ls" }), summary: "" });
    const shell = callStepUpClasses({ tool: "other", mcpTool: "sagax-environment__run_command", input: JSON.stringify({ command: "ls" }), summary: "" });
    expect(vm).toEqual(expect.arrayContaining(["destructive", "irreversible"]));
    expect(shell).toEqual(expect.arrayContaining(["destructive", "irreversible"]));
    expect(callStepUpClasses({ tool: "other", mcpTool: "mcp__sagax-desktop__local_vm", input: JSON.stringify({ action: "run" }), summary: "" })).toEqual(expect.arrayContaining(["destructive", "irreversible"]));
    // status is not a command
    expect(callStepUpClasses({ tool: "other", mcpTool: "sagax-desktop__local_vm", input: JSON.stringify({ action: "status" }), summary: "" })).not.toContain("irreversible");
  });

  it("the Grok gate no longer lets the environment or Data through by itself", () => {
    const spec = { command: "node", args: [SPAWNED_PROXIES.userSandbox], env: { SAGAX_OWN_ENVIRONMENT: "1" } };
    expect(gateReadOnlyTools({ name: "sagax-environment", builtin: false, spec })).toEqual([]);
    expect(gateReadOnlyTools({ name: "sagax-desktop", builtin: false, spec })).toEqual([]);
    expect(gateReadOnlyTools({ name: "data", builtin: true })).toEqual([]);
  });
});

// 2026-10-19 (JC): "everyone should be able to run commands on their own
// VM, PC or cloud computer". The reported case: a member's bot on his Windows
// computer asked mcp__sagax-desktop__list_files on the attachments folder
// and mcp__sagax-desktop__run_command, and both waited for an admin.
describe("a member's own destinations (2026-10-19)", () => {
  const WIN = "C:\\Users\\BOBSMI~1\\AppData\\Local\\Temp\\Sagax\\attachments";
  const call = (tool: string, over: Partial<Parameters<typeof ownDestinationCall>[0]> = {}) => ownDestinationCall({
    identity: "perspicax", tool, environmentPrincipalId: OWNER, ownerPrincipalId: OWNER, guestDriven: false, mountedServers: MOUNTED, ...over,
  });

  it.each([
    ["mcp__sagax-desktop__run_command", true],
    ["mcp__sagax-desktop__list_files", true],
    ["mcp__sagax-desktop__read_file", true],
    ["mcp__sagax-desktop__write_file", true],
    ["mcp__sagax-desktop__search_files", true],
    ["mcp__sagax-desktop__fetch_url", true],
    ["mcp__sagax-desktop__browse", true],
    ["mcp__sagax-desktop__local_vm", true],
    ["sagax-desktop__run_command", true],
    ["mcp__sagax-environment__run_command", true],
    ["mcp__sagax-environment__write_file", true],
    ["Bash", false],
    ["mcp__shell__exec", false],
    ["mcp__sagax-computer__computer_select", false],
    ["mcp__sagax-desktop-evil__run_command", false],
  ] as const)("%s on the owner's own destination: %s", (tool, own) => {
    expect(call(tool)).toBe(own);
  });

  it("is never someone else's destination, a stale mount, a guest's turn or a solo server", () => {
    expect(call("mcp__sagax-desktop__run_command", { environmentPrincipalId: "pr_other" })).toBe(false);
    expect(call("mcp__sagax-desktop__run_command", { environmentPrincipalId: null })).toBe(false);
    expect(call("mcp__sagax-desktop__run_command", { mountedServers: new Set([USER_SANDBOX_MCP_NAME]) })).toBe(false);
    expect(call("mcp__sagax-desktop__run_command", { guestDriven: true })).toBe(false);
    expect(call("mcp__sagax-desktop__run_command", { identity: "solo" })).toBe(false);
    // the owner's id is compared folded
    expect(call("mcp__sagax-desktop__run_command", { environmentPrincipalId: "PR_OWNER" })).toBe(true);
  });

  it("an own destination is never an admin's card, whatever the tool", () => {
    for (const tool of ["mcp__sagax-desktop__run_command", "mcp__sagax-desktop__list_files", "mcp__sagax-environment__run_command"]) {
      expect(memberBotAdminApproval({ tool, workspaceRoot: "/nowhere" })).toBe(true);
      expect(memberBotAdminApproval({ tool, workspaceRoot: "/nowhere", ownDestination: true })).toBe(false);
    }
    expect(memberBotAdminApproval({ tool: "Bash", command: { command: "ls" }, workspaceRoot: "/nowhere" })).toBe(true);
    expect(memberBotAdminApproval({ tool: "Bash", command: { command: "ls" }, workspaceRoot: "/nowhere", ownerRunsServerCommands: true })).toBe(false);
  });

  it("normalizes Windows paths (backslashes, 8.3 short names, case) and refuses traversal", () => {
    expect(normalizedDestinationPath(WIN, "win32")).toBe("c:/users/bobsmi~1/appdata/local/temp/sagax/attachments");
    expect(normalizedDestinationPath("c:/Users/BOBSMI~1/AppData/Local/Temp/Sagax/attachments/", "win32")).toBe("c:/users/bobsmi~1/appdata/local/temp/sagax/attachments");
    expect(normalizedDestinationPath("\\\\?\\C:\\Temp\\x", "win32")).toBe("c:/temp/x");
    expect(normalizedDestinationPath(`${WIN}\\..\\secret`, "win32")).toBeNull();
    expect(normalizedDestinationPath("attachments\\x", "win32")).toBeNull();
    expect(normalizedDestinationPath("/Users/Bob/Library/Caches/Sagax/attachments", "darwin")).toBe("/users/bob/library/caches/sagax/attachments");
    expect(normalizedDestinationPath("/workspace/attachments/A", "linux")).toBe("/workspace/attachments/A");
    expect(normalizedDestinationPath("/workspace/./attachments", "linux")).toBeNull();
    expect(normalizedDestinationPath("~/x", "linux")).toBeNull();
  });

  const roots = [{ server: DESKTOP_BRIDGE_MCP_NAME, path: WIN, platform: "win32" as const }, { server: USER_SANDBOX_MCP_NAME, path: "/workspace/attachments", platform: "linux" as const }];
  const read = (tool: string, args: unknown) => ownAttachmentRead({ tool, input: typeof args === "string" ? args : JSON.stringify(args), roots });

  it.each([
    ["the attachments folder itself", "mcp__sagax-desktop__list_files", { path: WIN }, true],
    ["the unpacked .zip (reported case)", "mcp__sagax-desktop__list_files", { path: `${WIN}\\a6d1def1-fichier` }, true],
    ["a file in it, forward slashes", "mcp__sagax-desktop__read_file", { path: "C:/Users/BOBSMI~1/AppData/Local/Temp/Sagax/attachments/a6d1def1-fichier/rapport.txt" }, true],
    ["another case", "mcp__sagax-desktop__read_file", { path: "c:\\users\\bobsmi~1\\appdata\\local\\temp\\sagax\\attachments\\x.zip" }, true],
    ["a search in it", "mcp__sagax-desktop__search_files", { path: WIN, pattern: "x" }, true],
    ["the server environment's copy", "mcp__sagax-environment__read_file", { path: "/workspace/attachments/x/rapport.txt" }, true],
    ["a traversal out of it", "mcp__sagax-desktop__read_file", { path: `${WIN}\\..\\..\\secret.txt` }, false],
    ["a sibling folder with the same prefix", "mcp__sagax-desktop__read_file", { path: `${WIN}-evil\\x` }, false],
    ["elsewhere on the computer", "mcp__sagax-desktop__read_file", { path: "C:\\Users\\BOBSMI~1\\Documents\\x.txt" }, false],
    ["no path (the home folder)", "mcp__sagax-desktop__list_files", {}, false],
    ["a relative path", "mcp__sagax-desktop__read_file", { path: "attachments/x" }, false],
    ["a write in it", "mcp__sagax-desktop__write_file", { path: `${WIN}\\x`, content: "y" }, false],
    ["a command in it", "mcp__sagax-desktop__run_command", { command: "unzip x.zip", cwd: WIN }, false],
    ["the Windows root on the server environment", "mcp__sagax-environment__read_file", { path: `${WIN}\\x` }, false],
    ["unreadable arguments", "mcp__sagax-desktop__read_file", "{not json", false],
    ["another server's read_file", "mcp__files__read_file", { path: `${WIN}\\x` }, false],
    ["the sandbox root on the desktop", "mcp__sagax-desktop__read_file", { path: "/workspace/attachments/x" }, false],
  ] as const)("%s: %s", (_label, tool, args, expected) => {
    expect(read(tool, args)).toBe(expected);
  });

  it("answers a read of the person's own attachment at any level, after the safety hold, the person's rules and the key", () => {
    for (const mode of ["ask", "auto", "edits"] as const) {
      expect(autoVerdict(mode, "mcp__sagax-desktop__list_files", { ownAttachmentRead: true }).source).toBe("own-attachment");
    }
    expect(autoVerdict("ask", "mcp__sagax-desktop__list_files", { ownAttachmentRead: true, safetyHold: true }).approve).toBeNull();
    expect(autoVerdict("ask", "mcp__sagax-desktop__list_files", { ownAttachmentRead: true, customRule: { behavior: "ask", id: "r" } }).approve).toBeNull();
    expect(autoVerdict("ask", "mcp__sagax-desktop__list_files", { ownAttachmentRead: true, stepUpRequired: ["destructive"] }).approve).toBeNull();
    expect(autoVerdict("ask", "mcp__sagax-desktop__list_files", { ownAttachmentRead: true, requiresExplicitApproval: true }).approve).toBeNull();
    expect(autoVerdict("ask", "mcp__sagax-desktop__list_files", {}).approve).toBeNull();
  });
});
