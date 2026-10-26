// Engine access on an organization server (slice 3, D13), the whole matrix.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { driverKeyBacked, type AppConfig } from "./config.ts";
import { accessCardAudience, accessCardForViewer, accessCardVisibleTo, adminApprovalDecision, claudeAiOwnerScopedServer, engineAccessNotice, keyRefusedCard, memberBotAdminApproval, memberOwnedBot, resolveTurnSpeaker, routineAccessNotifications, routineLineage, serverCommandApproval, speakerPrincipal } from "./engine-access.ts";

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
    expect(driverKeyBacked(cfg, "claudeAgent")).toBe(true);
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
  it("still needs an admin for a host-level agents tool or a command dressed as one", () => {
    expect(gate("agents__act")).toBe(true);
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
    ownerScopedMcpServer: (server) => server === "perspicax_gox" || server === "my_remote",
  });
  it("lets the owner answer a tool of a remote or personal MCP server and a web search", () => {
    expect(ownerGate("mcp__perspicax_gox__cw_psa__query")).toBe(false);
    expect(ownerGate("perspicax_gox__cw_psa__write")).toBe(false);
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
    expect(ownerGate("agents__act")).toBe(true);
    expect(ownerGate("Bash", { command: "ls", cwd: root })).toBe(true);
    expect(ownerGate("WebFetch")).toBe(true);
    expect(ownerGate("other")).toBe(true);
    // a remote server tool named like a shell is still a command
    expect(ownerGate("mcp__my_remote__run_shell")).toBe(true);
    expect(ownerGate("mcp__perspicax_gox__query", { command: "ls", cwd: root })).toBe(true);
  });
  it("sends every MCP tool to an admin when nothing says which servers are the owner's", () => {
    expect(gate("mcp__perspicax_gox__cw_psa__query")).toBe(true);
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
