// Engine access on an organization server (slice 3, D13), the whole matrix.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { driverKeyBacked, type AppConfig } from "./config.ts";
import { accessCardAudience, accessCardForViewer, accessCardVisibleTo, adminApprovalDecision, claudeAiOwnerScopedServer, engineAccessNotice, fileViewToolPaths, keyRefusedCard, memberBotAdminApproval, memberOwnedBot, memberOwnHostToolCall, resolveTurnSpeaker, sensitiveHiddenSegment, routineAccessNotifications, routineLineage, serverCommandApproval, speakerPrincipal, type MemberHostToolPlace, signInExpiredCard, subscriptionSignInRefused, engineNameForViewer, keyEngineProvider, orgKeyEngineName } from "./engine-access.ts";
import { CODEX_SIGN_IN_EXPIRED, codexNotSignedIn, codexSignInExpired } from "./drivers/codex-errors.ts";

const ALICE = "pr_aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "pr_bbbbbbbb-0000-4000-8000-000000000002";

describe("resolveTurnSpeaker", () => {
  it("keeps a stated speaker", () => {
    expect(resolveTurnSpeaker({ speaker: { origin: "operator" }, sender: { id: BOB } })).toEqual({ origin: "operator" });
  });
  it("reads the peer, the sender, a routine, the operator, in that order", () => {
    expect(resolveTurnSpeaker({ peerAsk: { botId: "b1" }, sender: { id: BOB } })).toEqual({ origin: "peer", fromBotId: "b1" });
    expect(resolveTurnSpeaker({ sender: { id: BOB }, trigger: { kind: "owner" } })).toEqual({ origin: "person", principalId: BOB });
    expect(resolveTurnSpeaker({ automationSource: "schedule" })).toEqual({ origin: "owner-routine" });
    expect(resolveTurnSpeaker({ trigger: { kind: "routine" } })).toEqual({ origin: "owner-routine" });
    expect(resolveTurnSpeaker({ trigger: { kind: "owner" } })).toEqual({ origin: "operator" });
  });
  it("fails closed when nothing names the speaker", () => {
    expect(resolveTurnSpeaker({})).toEqual({ origin: "person" });
    expect(resolveTurnSpeaker({ trigger: { kind: "user" } })).toEqual({ origin: "person" });
  });
});

describe("the helpers around it", () => {
  it("tells a routine's lineage apart: the routine itself and any hop marked from it", () => {
    expect(routineLineage({ origin: "owner-routine" })).toBe(true);
    expect(routineLineage({ origin: "peer", fromBotId: "b", principalId: "pr_alice", routine: true })).toBe(true);
    expect(routineLineage({ origin: "peer", fromBotId: "b", principalId: "pr_alice" })).toBe(false);
    expect(routineLineage({ origin: "person", principalId: "pr_alice" })).toBe(false);
    expect(routineLineage({ origin: "operator" })).toBe(false);
  });

  it("speaks for a routine's runAs, else the owner (slice 6)", () => {
    expect(speakerPrincipal({ origin: "owner-routine", principalId: BOB }, "pr_owner")).toBe(BOB);
    expect(speakerPrincipal({ origin: "owner-routine" }, "pr_owner")).toBe("pr_owner");
    expect(routineLineage({ origin: "owner-routine", principalId: BOB })).toBe(true);
  });

  it("says why in plain words, never with provider text", () => {
    expect(engineAccessNotice("no_access", "Claude")).toBe("No Claude access for this turn: sign in with your own Claude subscription or add your key in Perspicax, or ask an admin to set the organization's key.");
    expect(engineAccessNotice("no_access", "Claude", { payer: "owner", routine: true, cause: "no_credentials" })).toBe("This routine can't run: its owner has no Claude subscription or key here, and the server has no organization key for it.");
    expect(engineAccessNotice("no_access", "Claude", { payer: "owner", routine: true, cause: "payer_disabled" })).toBe("This bot can't run: its owner's account is disabled, so their Claude access is off.");
    expect(engineAccessNotice("no_access", "Claude", { payer: "speaker", cause: "payer_disabled" })).toBe("This bot can't answer: your account is disabled.");
    expect(engineAccessNotice("engine_missing", "Codex")).toBe("This bot uses Codex, which is not installed on this server.");
    expect(engineAccessNotice("key_refused", "Claude")).toBe("The provider refused this bot's key.");
  });

  it("finds a key-backed driver from the configured keys only", () => {
    const cfg = { anthropic: { key: "sk-ant-test" }, mistral: {}, xai: { key: "xai-test" } } as unknown as AppConfig;
    // Claude's pasted key backs the API instance only, never a bare driver id.
    expect(driverKeyBacked(cfg, "claudeAgent")).toBe(false);
    expect(driverKeyBacked(cfg, "claudeAgent", "claudeApi")).toBe(true);
    expect(driverKeyBacked(cfg, "grok")).toBe(true);
    expect(driverKeyBacked(cfg, "mistral")).toBe(false);
    expect(driverKeyBacked(cfg, "codex")).toBe(false);
    expect(driverKeyBacked(cfg, "grokAgent")).toBe(false);
    expect(driverKeyBacked({} as AppConfig, "claudeAgent")).toBe(false);
  });

  it("marks a bot owned by a non-admin in organization mode only", () => {
    expect(memberOwnedBot({ identity: "perspicax", ownerOrgRole: "member" })).toBe(true);
    expect(memberOwnedBot({ identity: "perspicax", ownerOrgRole: undefined })).toBe(true);
    expect(memberOwnedBot({ identity: "perspicax", ownerOrgRole: "admin" })).toBe(false);
    expect(memberOwnedBot({ identity: "solo", ownerOrgRole: "member" })).toBe(false);
  });

  it("recognizes a server command approval", () => {
    expect(serverCommandApproval({ tool: "Bash" })).toBe(true);
    expect(serverCommandApproval({ tool: "exec_command" })).toBe(true);
    expect(serverCommandApproval({ tool: "mcp__shell__run" })).toBe(true);
    expect(serverCommandApproval({ tool: "Edit", command: { command: "ls" } })).toBe(true);
    expect(serverCommandApproval({ tool: "Edit" })).toBe(false);
    expect(serverCommandApproval({ tool: "WebFetch" })).toBe(false);
  });
});

describe("the admin gate on a member's bot", () => {
  let data = "";
  let root = "";
  beforeAll(() => {
    data = realpathSync(mkdtempSync(join(tmpdir(), "omb-admin-gate-")));
    root = join(data, "task-workspaces", "bot-1");
    mkdirSync(join(root, "thread-1", "src"), { recursive: true });
    mkdirSync(join(data, ".claude"), { recursive: true });
    writeFileSync(join(data, ".claude", "settings.json"), "{}");
    symlinkSync(join(data, ".claude"), join(root, "thread-1", "escape"));
  });
  afterAll(() => rmSync(data, { recursive: true, force: true }));
  const gate = (tool: string, paths?: string[], command?: unknown) => memberBotAdminApproval({ tool, paths, command, workspaceRoot: root });

  it("lets the owner answer a file tool that stays inside the bot's own workspace", () => {
    expect(gate("Write", [join(root, "thread-1", "src", "new.ts")])).toBe(false);
    expect(gate("Edit", [join(root, "thread-1", "README.md")])).toBe(false);
    expect(gate("Read", [join(root, "thread-1", "src")])).toBe(false);
    expect(gate("Glob", [join(root, "thread-1")])).toBe(false);
  });
  it("needs an admin for a write, edit or read outside that workspace", () => {
    expect(gate("Write", [join(data, ".claude", "settings.json")])).toBe(true);
    expect(gate("Edit", [join(data, "config.json")])).toBe(true);
    expect(gate("MultiEdit", ["/run/secrets/pulsabot_idp_key"])).toBe(true);
    expect(gate("Read", ["/run/secrets/pulsabot_idp_key"])).toBe(true);
    expect(gate("Read", [join(data, ".claude", ".credentials.json")])).toBe(true);
    expect(gate("NotebookEdit", [join(data, "task-workspaces", "bot-2", "t", "n.ipynb")])).toBe(true);
    expect(gate("Write", [join(root, "thread-1", "..", "..", "bot-2", "x")])).toBe(true);
  });
  it("needs an admin through a symlink, into a dot folder, or without a known path", () => {
    expect(gate("Write", [join(root, "thread-1", "escape", "settings.json")])).toBe(true);
    // a project's .claude/settings.json can hold hooks that run commands
    expect(gate("Write", [join(root, "thread-1", ".claude", "settings.json")])).toBe(true);
    expect(gate("Write", [join(root, "thread-1", ".git", "hooks", "pre-commit")])).toBe(true);
    expect(gate("Write", [join(root, "thread-1", ".mcp.json")])).toBe(true);
    expect(gate("Write", [])).toBe(true);
    expect(gate("Write")).toBe(true);
    expect(gate("Write", ["relative/path.ts"])).toBe(true);
    // one path out is enough
    expect(gate("Edit", [join(root, "thread-1", "a.ts"), "/etc/passwd"])).toBe(true);
  });
  it("lets the owner answer a read of the bot's own skill revisions, never a write there nor any other dot folder (2026-10-19)", () => {
    expect(gate("Read", [join(root, "thread-1", "skills", ".revisions", "r1", "SKILL.md")])).toBe(false);
    expect(gate("Glob", [join(root, "thread-1", "plugin", ".claude-plugin")])).toBe(false);
    expect(gate("Write", [join(root, "thread-1", "skills", ".revisions", "r1", "SKILL.md")])).toBe(true);
    expect(gate("Edit", [join(root, "thread-1", ".claude-plugin", "plugin.json")])).toBe(true);
    for (const hidden of [".claude", ".git", ".env", ".ssh", ".mcp.json"]) {
      expect(gate("Read", [join(root, "thread-1", hidden, "x")]), hidden).toBe(true);
    }
  });
  it("lets the owner write the ordinary hidden files of the bot's own workspace; the sensitive ones stay an admin's (#1098)", () => {
    for (const name of [".gitignore", ".github/workflows/ci.yml", ".vscode/settings.json", ".env.example", ".editorconfig", ".prettierrc", ".devcontainer/devcontainer.json", ".nvmrc"]) {
      expect(gate("Write", [join(root, "thread-1", name)]), name).toBe(false);
      expect(gate("Edit", [join(root, "thread-1", "app", name)]), name).toBe(false);
      expect(gate("Read", [join(root, "thread-1", name)]), name).toBe(false);
    }
    for (const name of [
      ".claude/settings.json", ".git/hooks/pre-commit", ".mcp.json", ".codex/config.toml", ".grok/settings.json", ".cursor/mcp.json",
      ".husky/pre-commit", ".githooks/pre-push", ".gitconfig", ".git-credentials", ".env", ".env.local", ".envrc", ".npmrc",
      ".yarnrc.yml", ".pnpmfile.cjs", ".bashrc", ".profile", ".ssh/authorized_keys", ".aws/credentials", ".config/git/config",
      ".claude-plugin/plugin.json", ".sagax/state.json", "sub/.GIT/hooks/post-checkout", "sub/.Claude/settings.json",
    ]) {
      expect(gate("Write", [join(root, "thread-1", name)]), name).toBe(true);
    }
    // still outside the workspace, through a symlink or with a traversal: an admin's
    expect(gate("Write", [join(root, "thread-1", "..", "..", "bot-2", ".gitignore")])).toBe(true);
    expect(gate("Write", [join(root, "thread-1", "escape", ".gitignore")])).toBe(true);
    expect(sensitiveHiddenSegment(".gitignore")).toBe(false);
    expect(sensitiveHiddenSegment(".env.sample")).toBe(false);
    expect(sensitiveHiddenSegment(".env.production")).toBe(true);
    expect(sensitiveHiddenSegment("..")).toBe(true);
    expect(sensitiveHiddenSegment("src")).toBe(false);
  });
  it("lets the owner answer a built-in Sagax tool that stays in the member's own scope (2026-10-08)", () => {
    // the reported case: a member's bot listing the bots it sees
    expect(gate("agents__list_bots")).toBe(false);
    expect(gate("mcp__agents__list_bots")).toBe(false);
    expect(gate("agents__list_threads")).toBe(false);
    expect(gate("agents__session_read")).toBe(false);
    expect(gate("agents__ask_bot")).toBe(false);
    expect(gate("agents__memory_update")).toBe(false);
    expect(gate("agents__propose_routine")).toBe(false);
  });
  it("lets the owner answer act on their own bot and own routes, a write too (#1269, #1098), and keeps an admin for someone else's bot or the organization", () => {
    const owns = (id: string) => id === "bot-1" || id === "bot-1b";
    const read = (tool: string, raw: unknown, owner = owns) => memberBotAdminApproval({
      tool, workspaceRoot: root, rawInput: raw, ownsBot: owner, callerBotId: "bot-1",
    });
    const get = { method: "GET", path: "/api/bots/bot-1/soul" };
    expect(read("agents__act", get)).toBe(false);
    expect(read("mcp__agents__act", get)).toBe(false);
    expect(read("agents__act", JSON.stringify({ method: "HEAD", path: "/api/bots/bot-1" }))).toBe(false);
    expect(read("agents__act", { method: "GET", path: "/api/bots/bot-1b/activity" })).toBe(false);
    expect(read("agents__act", { plugins: { action: "list" } })).toBe(false);
    expect(read("agents__act", { plugins: { action: "list", botId: "bot-1b" } })).toBe(false);
    // #1098: a write on the member's own bot or own routes is the owner's card too
    expect(read("agents__act", { method: "POST", path: "/api/bots/bot-1" })).toBe(false);
    expect(read("agents__act", { method: "PATCH", path: "/api/bots/bot-1/soul" })).toBe(false);
    expect(read("agents__act", { method: "DELETE", path: "/api/bots/bot-1" })).toBe(false);
    expect(read("agents__act", { method: "POST", path: "/api/bots", body: { name: "New" } })).toBe(false);
    expect(read("agents__act", { method: "POST", path: "/api/routines", body: { botId: "bot-1" } })).toBe(false);
    expect(read("agents__act", { method: "PATCH", path: "/api/me/preferences", body: { theme: "dark" } })).toBe(false);
    expect(read("agents__act", { plugins: { action: "install", botId: "bot-1", marketplace: "m", plugin: "p" } })).toBe(false);
    expect(read("agents__act", { plugins: { action: "uninstall", key: "p@m" } })).toBe(false);
    expect(read("agents__act", { ui: "updateBot", input: { botId: "bot-1b", patch: { title: "x" } } })).toBe(false);
    expect(read("agents__act", { ui: "showTeamMap" })).toBe(false);
    // someone else's bot, an unprovable path, or a route that reaches the organization stays an admin's
    expect(read("agents__act", { method: "GET", path: "/api/bots/bot-1", body: { name: "x" } })).toBe(false);
    expect(read("agents__act", { method: "GET", path: "/api/bots/other/soul" })).toBe(true);
    expect(read("agents__act", { method: "PATCH", path: "/api/bots/other" })).toBe(true);
    expect(read("agents__act", { method: "GET", path: "/api/bots/bot-1/../other" })).toBe(true);
    expect(read("agents__act", { method: "POST", path: "/api/bots/bot-1%2f..%2fother" })).toBe(true);
    expect(read("agents__act", { method: "POST", path: "/api/bots/bot-1?x=1" })).toBe(true);
    expect(read("agents__act", { method: "GET", path: "/api/config" })).toBe(true);
    expect(read("agents__act", { method: "PUT", path: "/api/config" })).toBe(true);
    expect(read("agents__act", { method: "POST", path: "/api/org/members" })).toBe(true);
    expect(read("agents__act", { method: "POST", path: "/api/tool-grants" })).toBe(true);
    expect(read("agents__act", { method: "POST", path: "/api/engines/claude" })).toBe(true);
    expect(read("agents__act", { method: "POST", path: "/api/billing/checkout" })).toBe(true);
    expect(read("agents__act", { method: "POST", path: "relative" })).toBe(true);
    expect(read("agents__act", { plugins: { action: "install", botId: "other", marketplace: "m", plugin: "p" } })).toBe(true);
    expect(read("agents__act", { ui: "updateBot", input: { botId: "other", patch: { title: "x" } } })).toBe(true);
    expect(read("agents__act", { ui: "updateBot", input: { botId: "bot-1", patch: {} }, method: "GET" })).toBe(true);
    // no proof of whose bot, a command dressed as act, or another server's spelling
    expect(gate("agents__act")).toBe(true);
    expect(memberBotAdminApproval({ tool: "agents__act", workspaceRoot: root, rawInput: get })).toBe(true);
    expect(gate("agents__manage_settings")).toBe(false);
    expect(gate("agents__act", undefined, { command: "ls", cwd: root })).toBe(true);
    expect(memberBotAdminApproval({ tool: "agents__act", workspaceRoot: root, foreignMcpServers: ["agents"], rawInput: get, ownsBot: owns })).toBe(true);
  });
  it("still needs an admin for a host-level agents tool or a command dressed as one", () => {
    expect(gate("agents__add_mcp_server")).toBe(true);
    expect(gate("agents__attach_file")).toBe(true);
    expect(gate("agents__vm_exec")).toBe(true);
    expect(gate("agents__shared_computer")).toBe(true);
    expect(gate("agents__list_bots", undefined, { command: "ls", cwd: root })).toBe(true);
    expect(gate("other")).toBe(true);
  });
  it("needs an admin for every other tool and every server command", () => {
    expect(gate("Bash", [join(root, "thread-1")], { command: "ls", cwd: root })).toBe(true);
    expect(gate("WebFetch")).toBe(true);
    expect(gate("mcp__computer__click")).toBe(true);
    expect(gate("Write", [join(root, "thread-1", "a.ts")], { command: "ls", cwd: root })).toBe(true);
  });
  // 2026-10-14 (bot owner permissions): the owner answers what stays within
  // their own rights; the admin only what goes beyond them.
  const ownerGate = (tool: string, command?: unknown) => memberBotAdminApproval({
    tool, command, workspaceRoot: root,
    ownerScopedMcpServer: (server) => server === "perspicax_quasar" || server === "my_remote",
  });
  it("lets the owner answer a tool of a remote or personal MCP server and a web search", () => {
    expect(ownerGate("mcp__perspicax_quasar__cw_psa__query")).toBe(false);
    expect(ownerGate("perspicax_quasar__cw_psa__write")).toBe(false);
    expect(ownerGate("mcp__my_remote__create_issue")).toBe(false);
    expect(ownerGate("WebSearch")).toBe(false);
    expect(ownerGate("TodoWrite")).toBe(false);
  });
  it("lets the owner answer a claude.ai connector only on their own subscription", () => {
    const viaGate = (tool: string, via: string | undefined) => memberBotAdminApproval({
      tool, workspaceRoot: root,
      ownerScopedMcpServer: (server) => claudeAiOwnerScopedServer(server, via),
    });
    expect(viaGate("mcp__claude_ai_Pulsatrix_Perspicax__cw_psa__query", "subscription")).toBe(false);
    expect(viaGate("mcp__claude_ai_Microsoft_365__outlook_email_search", "subscription")).toBe(false);
    expect(viaGate("mcp__claude_ai_Pulsatrix_Perspicax__cw_psa__query", "org-key")).toBe(true);
    expect(viaGate("mcp__claude_ai_Pulsatrix_Perspicax__cw_psa__query", "speaker-key")).toBe(true);
    expect(viaGate("mcp__claude_ai_Pulsatrix_Perspicax__cw_psa__query", undefined)).toBe(true);
    expect(viaGate("mcp__claude_ai___x", "subscription")).toBe(true);
    // a shell-named connector tool is still a command
    expect(viaGate("mcp__claude_ai_Thing__bash", "subscription")).toBe(true);
  });
  it("still sends to an admin what goes beyond the owner's rights", () => {
    // an unknown server, a host-level built-in server, a shell, a fetch from the host
    expect(ownerGate("mcp__someone_else__query")).toBe(true);
    expect(ownerGate("mcp__computer__click")).toBe(true);
    expect(ownerGate("mcp__browser__navigate")).toBe(true);
    expect(ownerGate("mcp__sagax-computer__run")).toBe(true);
    expect(ownerGate("agents__vm_exec")).toBe(true);
    expect(ownerGate("Bash", { command: "ls", cwd: root })).toBe(true);
    expect(ownerGate("WebFetch")).toBe(true);
    expect(ownerGate("other")).toBe(true);
    // a remote server tool named like a shell is still a command
    expect(ownerGate("mcp__my_remote__run_shell")).toBe(true);
    expect(ownerGate("mcp__perspicax_quasar__query", { command: "ls", cwd: root })).toBe(true);
  });
  it("sends every MCP tool to an admin when nothing says which servers are the owner's", () => {
    expect(gate("mcp__perspicax_quasar__cw_psa__query")).toBe(true);
  });

  it("keeps Sagax's file views of the bot's own workspace and inbox with the owner, and nothing else (#1169)", () => {
    const workspace = join(data, "workspaces", "bot-1");
    mkdirSync(join(workspace, "inbox", "nova"), { recursive: true });
    const inbox = join(workspace, "inbox", "nova", "note.txt");
    writeFileSync(inbox, "hi");
    const own = (tool: string, paths?: string[], command?: unknown) => memberBotAdminApproval({ tool, paths, command, workspaceRoot: root, readRoots: [workspace] });
    expect(own("mcp__sagax-desktop__read_file", [inbox])).toBe(false);
    expect(own("sagax-environment__list_files", [workspace])).toBe(false);
    expect(own("mcp__files__search_files", [join(workspace, "inbox")])).toBe(false);
    expect(own("Read", [inbox])).toBe(false);
    expect(own("mcp__sagax-desktop__read_file", [join(root, "thread-1", "src")])).toBe(false);
    // another bot's inbox, a dot folder, a write or a command in the workspace, an unknown server
    expect(own("mcp__sagax-desktop__read_file", [join(data, "workspaces", "bot-2", "inbox", "x.txt")])).toBe(true);
    expect(own("mcp__sagax-desktop__read_file", [join(workspace, "inbox", ".ssh", "id")])).toBe(true);
    expect(own("Write", [inbox])).toBe(true);
    expect(own("Read", [inbox], { command: "cat note.txt" })).toBe(true);
    expect(own("mcp__other__read_file", [inbox])).toBe(true);
    expect(own("mcp__sagax-desktop__read_file")).toBe(true);
    expect(fileViewToolPaths("mcp__sagax-desktop__read_file", JSON.stringify({ path: inbox }))).toEqual([inbox]);
    expect(fileViewToolPaths("mcp__sagax-desktop__read_file", JSON.stringify({ path: "inbox/nova/note.txt" }))).toEqual([]);
    expect(fileViewToolPaths("mcp__other__read_file", JSON.stringify({ path: inbox }))).toEqual([]);
  });
});

describe("the key_refused card", () => {
  const input = {
    identity: "perspicax" as const, setup: true, claudeUpdate: false, keyBacked: true,
    message: "Invalid API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 · Please run /login",
    botId: "x", ownerPrincipalId: ALICE, engine: "Claude",
    redact: (text: string) => text.replace(/sk-ant-[\w-]+/g, "[redacted]"),
  };

  it("replaces a key-backed setup error on an organization server, redacted and bounded", () => {
    const card = keyRefusedCard(input);
    expect(card).toMatchObject({ reason: "key_refused", engine: "Claude", botId: "x", ownerPrincipalId: ALICE });
    expect(card?.detail).toContain("[redacted]");
    expect(card?.detail).not.toContain("sk-ant-api03");
    expect(keyRefusedCard({ ...input, message: "x".repeat(500) })?.detail).toHaveLength(200);
  });

  it("leaves every other error alone", () => {
    expect(keyRefusedCard({ ...input, identity: "solo" })).toBeNull();
    expect(keyRefusedCard({ ...input, setup: false })).toBeNull();
    expect(keyRefusedCard({ ...input, keyBacked: false })).toBeNull();
    expect(keyRefusedCard({ ...input, claudeUpdate: true })).toBeNull();
  });

  it("shows the provider's words to the owner and admins only", () => {
    const message = { kind: "access", access: { reason: "key_refused", engine: "Claude", botId: "x", ownerPrincipalId: ALICE, detail: "quota" } };
    expect(accessCardForViewer(message, { principalId: ALICE, admin: false }).access.detail).toBe("quota");
    expect(accessCardForViewer(message, { principalId: BOB, admin: true }).access.detail).toBe("quota");
    expect(accessCardForViewer(message, { principalId: BOB, admin: false }).access).not.toHaveProperty("detail");
    expect(message.access.detail).toBe("quota");
  });
});

describe("the notifications of a refused routine run (owner's card)", () => {
  const note = { kind: "turn-failed", botId: "x", threadId: "t-bob" };
  it("sends a reader the thread and the owner, who cannot read it, the run", () => {
    expect(routineAccessNotifications(note, ["pr_owner"], { routineRunId: "run-9", readable: () => false }))
      .toEqual([{ ...note, threadId: "", routineRunId: "run-9", audience: ["pr_owner"] }]);
    expect(routineAccessNotifications(note, [BOB, "pr_owner"], { routineRunId: "run-9", readable: (id) => id === BOB }))
      .toEqual([{ ...note, audience: [BOB] }, { ...note, threadId: "", routineRunId: "run-9", audience: ["pr_owner"] }]);
  });
  it("keeps one notification for a reader, a shared card, or no run", () => {
    expect(routineAccessNotifications(note, ["pr_owner"], { routineRunId: "run-9", readable: () => true })).toEqual([{ ...note, audience: ["pr_owner"] }]);
    expect(routineAccessNotifications(note, null, { routineRunId: "run-9", readable: () => false })).toEqual([note]);
    expect(routineAccessNotifications(note, ["pr_owner"], { readable: () => false })).toEqual([{ ...note, audience: ["pr_owner"] }]);
  });
});

describe("who an access card is for (2026-10-01)", () => {
  const OWNER = "pr_owner";
  const base = { engine: "Claude", botId: "x", ownerPrincipalId: OWNER };
  it("goes to whose credentials the turn needed, never the rest of the room", () => {
    const bobs = { kind: "access", access: { ...base, reason: "no_access", payer: "speaker", payerPrincipalId: BOB } };
    expect(accessCardAudience(bobs.access)).toEqual([BOB]);
    expect(accessCardVisibleTo(bobs, BOB)).toBe(true);
    expect(accessCardVisibleTo(bobs, BOB.toUpperCase())).toBe(true);
    expect(accessCardVisibleTo(bobs, ALICE)).toBe(false);
    expect(accessCardVisibleTo(bobs, OWNER)).toBe(false);
    expect(accessCardVisibleTo(bobs, "")).toBe(false);
    expect(accessCardVisibleTo(bobs, undefined)).toBe(false);
  });
  it("sends a routine's card to the bot's owner, and an older card without a payer too", () => {
    expect(accessCardAudience({ ...base, reason: "no_access", payer: "owner", payerPrincipalId: OWNER, routine: true } as never)).toEqual([OWNER]);
    expect(accessCardAudience({ ...base, reason: "no_access" })).toEqual([OWNER]);
    expect(accessCardAudience({ ...base, reason: "engine_missing", payerPrincipalId: BOB })).toEqual([BOB]);
  });
  it("sends a paused routine to the person it runs as and the owner", () => {
    expect(accessCardAudience({ ...base, reason: "routine_delegation", runAsPrincipalId: BOB })).toEqual([BOB, OWNER]);
    expect(accessCardAudience({ ...base, reason: "routine_delegation", runAsPrincipalId: OWNER })).toEqual([OWNER]);
  });
  it("#1137: the owner pays, so the person who wrote reads the card too, and nobody else", () => {
    const card = { kind: "access", access: { ...base, reason: "no_access", cause: "owner_model_offline", payer: "owner", payerPrincipalId: OWNER, ownerPays: true, speakerPrincipalId: BOB } };
    expect(accessCardAudience(card.access)).toEqual([OWNER, BOB]);
    expect(accessCardVisibleTo(card, BOB)).toBe(true);
    expect(accessCardVisibleTo(card, ALICE)).toBe(false);
    // without ownerPays, the speaker's id is not an audience
    expect(accessCardAudience({ ...card.access, ownerPays: undefined })).toEqual([OWNER]);
    expect(engineAccessNotice("no_access", "pi", { cause: "owner_model_offline", ownerName: "Ada" })).toBe("Ada's model isn't reachable right now.");
    expect(engineAccessNotice("no_access", "pi", { cause: "owner_model_offline" })).toBe("The owner's model isn't reachable right now.");
  });
  it("keeps a refused organization key shared, and a person's own refused key theirs", () => {
    expect(accessCardAudience({ ...base, reason: "key_refused" })).toBeNull();
    expect(accessCardVisibleTo({ kind: "access", access: { ...base, reason: "key_refused" } }, ALICE)).toBe(true);
    expect(accessCardAudience({ ...base, reason: "key_refused", payerPrincipalId: BOB })).toEqual([BOB]);
  });
  it("leaves every other row alone", () => {
    expect(accessCardVisibleTo({ kind: "text" }, ALICE)).toBe(true);
    expect(accessCardVisibleTo({ kind: "text" }, undefined)).toBe(true);
  });
});

describe("who answers a server command of a member's bot", () => {
  const card = { adminApproval: true };
  it("an organization admin answers it, the owner and anyone else get admin_approval_required", () => {
    expect(adminApprovalDecision({ identity: "perspicax", card, callerIsOrgAdmin: true })).toBe("admin");
    expect(adminApprovalDecision({ identity: "perspicax", card, callerIsOrgAdmin: false })).toBe("refused");
  });
  it("leaves ordinary cards, settled cards and solo servers alone", () => {
    expect(adminApprovalDecision({ identity: "perspicax", card: { adminApproval: false }, callerIsOrgAdmin: false })).toBeNull();
    expect(adminApprovalDecision({ identity: "perspicax", card: { ...card, answered: "Allow" }, callerIsOrgAdmin: false })).toBeNull();
    expect(adminApprovalDecision({ identity: "perspicax", card: { ...card, dismissed: true }, callerIsOrgAdmin: false })).toBeNull();
    expect(adminApprovalDecision({ identity: "perspicax", card: null, callerIsOrgAdmin: false })).toBeNull();
    expect(adminApprovalDecision({ identity: "solo", card, callerIsOrgAdmin: false })).toBeNull();
  });
});

// 2026-10-28 (a member does everything in their own environment):
// vm_exec, shared_computer, attach_file and add_mcp_server wait for an
// admin only when they would touch the shared server.
describe("host-level agents tools in the member's own environment", () => {
  let root = "";
  let workspace = "";
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "own-host-")));
    workspace = join(root, "task-workspaces", "b1");
    mkdirSync(join(workspace, ".claude"), { recursive: true });
    writeFileSync(join(workspace, "report.pdf"), "pdf");
    writeFileSync(join(workspace, ".claude", "settings.json"), "{}");
    writeFileSync(join(root, "other.txt"), "x");
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const place = (over: Partial<MemberHostToolPlace> = {}): MemberHostToolPlace => ({ ownLocalVm: false, ownComputers: false, ownMcpList: false, botRoots: [workspace], ...over });
  const gate = (tool: string, input: unknown, hostPlace?: MemberHostToolPlace) => memberBotAdminApproval({ tool, workspaceRoot: workspace, rawInput: input, hostPlace });

  it("vm_exec in the bot's own Local VM is the owner's card, a shared or pooled VM an admin's", () => {
    expect(memberOwnHostToolCall("mcp__agents__vm_exec", { command: "ls" }, place({ ownLocalVm: true }))).toBe(true);
    expect(gate("mcp__agents__vm_exec", { command: "ls" }, place({ ownLocalVm: true }))).toBe(false);
    expect(gate("mcp__agents__vm_exec", { command: "ls" }, place())).toBe(true);
    expect(gate("mcp__agents__vm_exec", { command: "ls" })).toBe(true);
  });

  it("shared_computer on the speaking owner's own computers is theirs", () => {
    expect(gate("agents__shared_computer", { computer_id: "c", action: "list_files" }, place({ ownComputers: true }))).toBe(false);
    expect(gate("agents__shared_computer", { computer_id: "c", action: "list_files" }, place())).toBe(true);
  });

  it("add_mcp_server into the person's own list is theirs, the shared list an admin's", () => {
    expect(gate("mcp__agents__add_mcp_server", { name: "notes", command: "npx" }, place({ ownMcpList: true }))).toBe(false);
    expect(gate("mcp__agents__add_mcp_server", { name: "notes", command: "npx" }, place())).toBe(true);
  });

  it("attach_file of the bot's own folders or own VM is theirs, anything else an admin's", () => {
    expect(gate("mcp__agents__attach_file", JSON.stringify({ path: join(workspace, "report.pdf") }), place())).toBe(false);
    expect(gate("mcp__agents__attach_file", { path: join(workspace, ".claude", "settings.json") }, place())).toBe(true);
    expect(gate("mcp__agents__attach_file", { path: join(workspace, ".github", "workflows", "ci.yml") }, place())).toBe(false);
    expect(gate("mcp__agents__attach_file", { path: join(workspace, ".env") }, place())).toBe(true);
    expect(gate("mcp__agents__attach_file", { path: join(root, "other.txt") }, place())).toBe(true);
    expect(gate("mcp__agents__attach_file", { path: join(workspace, "..", "..", "other.txt") }, place())).toBe(true);
    expect(gate("mcp__agents__attach_file", { path: "/home/cua/workspace/out.png" }, place({ ownLocalVm: true }))).toBe(false);
    expect(gate("mcp__agents__attach_file", { path: "/home/cua/workspace/../../etc/passwd" }, place({ ownLocalVm: true }))).toBe(true);
    expect(gate("mcp__agents__attach_file", { path: "/home/cua/workspace/out.png" }, place())).toBe(true);
    expect(gate("mcp__agents__attach_file", { path: "relative.txt" }, place())).toBe(true);
  });

  it("never the Perspicax admin tools, a shell command or a lookalike server", () => {
    const all = place({ ownLocalVm: true, ownComputers: true, ownMcpList: true });
    expect(gate("mcp__agents__api_reload", {}, all)).toBe(true);
    expect(gate("mcp__agents__review_write", { id: "r", decision: "approve" }, all)).toBe(true);
    expect(memberOwnHostToolCall("mcp__agentsx__vm_exec", { command: "ls" }, all)).toBe(false);
    expect(memberBotAdminApproval({ tool: "mcp__agents__vm_exec", command: "rm -rf /", workspaceRoot: workspace, hostPlace: all })).toBe(true);
    expect(memberBotAdminApproval({ tool: "mcp__agents__vm_exec", workspaceRoot: workspace, hostPlace: all, foreignMcpServers: ["agents"] })).toBe(true);
  });
});

describe("#1533 / #1759: an expired subscription sign-in", () => {
  const base = { identity: "perspicax" as const, via: "subscription", subscriptionDriver: true, payerPrincipalId: "pr_member", botId: "b1", botName: "Helper", ownerPrincipalId: "pr_member", engine: "Claude" };

  it("gives the payer the access card with Reconnect, not the engine's raw words", () => {
    const card = signInExpiredCard({ ...base, message: "Failed to authenticate: OAuth session expired and could not be refreshed" });
    expect(card).toEqual({ reason: "no_access", cause: "sign_in_expired", engine: "Claude", botId: "b1", botName: "Helper", ownerPrincipalId: "pr_member", payerPrincipalId: "pr_member", subscriptionSignIn: true });
    expect(signInExpiredCard({ ...base, message: "API Error: authentication_failed" })).not.toBeNull();
    expect(signInExpiredCard({
      ...base,
      message: "Claude's sign-in has expired. Reconnect Claude in Settings → Model providers and accounts. Claude said: Not logged in",
    })).toMatchObject({ cause: "sign_in_expired", engine: "Claude", subscriptionSignIn: true });
    // Extra-usage credits on Claude also need Reconnect (same card as an expired sign-in).
    expect(signInExpiredCard({
      ...base,
      message: "Claude refused this turn because this model runs on extra usage for your account, and those credits are used up.",
    })).toMatchObject({ cause: "sign_in_expired", engine: "Claude" });
    expect(engineAccessNotice("no_access", "Claude", { cause: "sign_in_expired" })).toContain("Reconnect Claude");
  });

  it("#1759: Codex and Grok refusals also get the Reconnect card (not Connected)", () => {
    const codex = { ...base, engine: "Codex" };
    const grok = { ...base, engine: "Grok" };
    // Same sentences describeGrokAccountError emits (keep literals so this
    // file does not import the ACP Grok driver).
    const grokInvalid = "Grok refused this turn: the Grok sign-in or xAI key it runs on was rejected. Reconnect Grok in Settings → Model providers and accounts, or replace the xAI key.";
    const grokInactive = "Grok refused this turn: the Grok account it runs on has no active subscription. Reconnect Grok in Settings → Model providers and accounts, renew it at grok.com, or choose another model for this bot.";
    const grokCredits = "Grok refused this turn: the usage balance of the Grok account it runs on is used up (xAI answered 402 Payment Required). Add credit to that Grok account at grok.com, or choose another model for this bot.";
    for (const message of [
      codexSignInExpired("workspace routing discovery unauthorized"),
      codexSignInExpired("ChatGPT login is required"),
      `${CODEX_SIGN_IN_EXPIRED} Codex said: workspace routing discovery unauthorized`,
      codexNotSignedIn(),
      "invalid_credentials",
      "inactive_subscription",
      grokInvalid,
      grokInactive,
    ]) {
      expect(subscriptionSignInRefused(message)).toBe(true);
    }
    expect(signInExpiredCard({ ...codex, message: codexSignInExpired("workspace routing discovery unauthorized") })).toMatchObject({
      cause: "sign_in_expired", engine: "Codex", subscriptionSignIn: true,
    });
    expect(signInExpiredCard({ ...grok, message: grokInvalid })).toMatchObject({
      cause: "sign_in_expired", engine: "Grok", subscriptionSignIn: true,
    });
    expect(engineAccessNotice("no_access", "Codex", { cause: "sign_in_expired" })).toContain("Reconnect Codex");
    expect(engineAccessNotice("no_access", "Grok", { cause: "sign_in_expired" })).toContain("Reconnect Grok");
    // credits and overload stay on the generic error row
    expect(subscriptionSignInRefused(grokCredits)).toBe(false);
    expect(signInExpiredCard({ ...grok, message: grokCredits })).toBeNull();
  });

  it("leaves every other failure and route alone", () => {
    const message = "Failed to authenticate: OAuth session expired and could not be refreshed";
    expect(signInExpiredCard({ ...base, message: "Overloaded" })).toBeNull();
    expect(signInExpiredCard({ ...base, via: "org-key", message })).toBeNull();
    expect(signInExpiredCard({ ...base, via: "speaker-key", message })).toBeNull();
    expect(signInExpiredCard({ ...base, identity: "solo", message })).toBeNull();
    expect(signInExpiredCard({ ...base, subscriptionDriver: false, message })).toBeNull();
    expect(signInExpiredCard({ ...base, payerPrincipalId: undefined, message })).toBeNull();
  });
});

describe("#1533: an engine's name for a member", () => {
  it("never shows an address, only the engine and that it is another account", () => {
    expect(engineNameForViewer("someone@example.test", "Claude", false)).toBe("Claude (other account)");
    expect(engineNameForViewer("Claude (API key)", "Claude", false)).toBe("Claude (API key)");
    // an admin reads the name as it was saved
    expect(engineNameForViewer("someone@example.test", "Claude", true)).toBe("someone@example.test");
  });
});

describe("an engine the organization's key runs, as a member reads it (#1533)", () => {
  it("is named after its provider and who pays, in the person's language", () => {
    expect(orgKeyEngineName(keyEngineProvider("claudeAgent", "Claude (API key)"), "fr")).toBe("Claude (clé de l'organisation)");
    expect(orgKeyEngineName(keyEngineProvider("claudeAgent", "Claude (API key)"), "en")).toBe("Claude (organization key)");
    expect(orgKeyEngineName(keyEngineProvider("grok", "xAI"), "fr-CA")).toBe("Grok (clé de l'organisation)");
    expect(orgKeyEngineName(keyEngineProvider("openai-compat", "OpenAI"), "en")).toBe("OpenAI (organization key)");
    expect(orgKeyEngineName(keyEngineProvider("openai-compat", "OpenRouter"), "")).toBe("OpenRouter (organization key)");
  });
});
