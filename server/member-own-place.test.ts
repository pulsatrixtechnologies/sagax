// #4449: a member's bot works in the person's own place, never on the
// shared organization host, and never waits for an admin there.
//
//   plugin servers  a code host's server mounted for the person this turn
//                   (as them, or relayed into their own sandbox) is their
//                   card at their own level, never an admin's
//   host shell      a shell a member's turn asks on the shared host is
//                   refused in plain words with what to do: their own
//                   computer when they have one, else why none can be had
//   remaining       the reasons a member's card can still wait for an admin
//                   are a fixed list, and only one place sets that card
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { HOST_RUN_REASONS, MEMBER_ADMIN_REASONS, memberBotAdminApproval, memberBotAdminReason } from "./engines/engine-access.ts";
import { EXEC_USE_BOT_COMPUTER, orgServerExecRouting, ownPlaceRefusal } from "./exec-target.ts";
import { createMountPluginMcp } from "./index-leaves/mountPluginMcp.ts";
import { createOwnerScopedMcpServerFor } from "./index-leaves/ownerScopedMcpServerFor.ts";
import { createForeignMcpServerNames } from "./index-leaves/foreignMcpServerNames.ts";
import { createRevokeInternalCapabilityGeneration } from "./index-leaves/revokeInternalCapabilityGeneration.ts";

const root = "/srv/sagax/task-workspaces/bot-1";
const bot = { id: "bot-1", ownerUserId: "bob" };

function fakeHost(overrides: Record<string, unknown> = {}) {
  return {
    IDENTITY: { kind: "perspicax" },
    isPrincipalId: () => true,
    perspicaxOwnerScopedServer: () => false,
    claudeAiOwnerScopedServer: () => false,
    turnAccessByThread: new Map(),
    engineMcpServers: () => ({}),
    effectiveBotOwner: () => "bob",
    turnSpeakerPrincipals: new Map([["t1", "bob"]]),
    personConnections: { servers: () => ({}) },
    turnPluginMcpServers: new Map<string, Map<string, { generation: string; servers: Set<string> }>>(),
    turnWorkplaces: new Map(),
    ...overrides,
  } as Record<string, any>;
}

describe("a code host's plugin server mounted for the person", () => {
  async function mountGithubPlugin(host: Record<string, any>) {
    Object.assign(host, {
      store: { bot: () => bot },
      localPrincipalId: () => "bob",
      scopedPluginMcp: () => [{ name: "github", spec: { type: "http", url: "https://api.example.test/mcp", headers: { Authorization: "Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}" } }, scope: "person", plugin: "github", dir: "/p" }],
      userSandbox: {},
      managedPolicy: { filterMcp: (servers: object) => servers },
      personalHostRefusalCached: async () => false,
      githubAccountToken: () => "person-token",
    });
    const mount = createMountPluginMcp(() => host);
    const integrations: Record<string, any> = {};
    await mount(integrations, { botId: bot.id, threadId: "t1", generation: "g1", customMcp: true, principal: "bob" });
    return integrations;
  }

  it("is recorded for the turn, and its tools are the person's own card, never an admin's", async () => {
    const host = fakeHost();
    const integrations = await mountGithubPlugin(host);
    expect(Object.keys(integrations.custom ?? {})).toEqual(["github"]);
    expect([...host.turnPluginMcpServers.get("t1")?.get(bot.id)?.servers ?? []]).toEqual(["github"]);
    const owned = createOwnerScopedMcpServerFor(() => host)(bot, "t1");
    expect(owned("github")).toBe(true);
    // a read of issues on the code host: the person's own card
    for (const tool of ["mcp__github__list_issues", "github__list_issues", "github__issue_read"]) {
      expect(memberBotAdminApproval({ tool, workspaceRoot: root, ownerScopedMcpServer: owned })).toBe(false);
    }
    // the plugin server is not Sagax's own: it can never spell a built-in
    expect(createForeignMcpServerNames(() => host)(bot, "t1")).toContain("github");
  });

  it("a shell-shaped tool name on that server is still the person's own card, never a host shell", async () => {
    const host = fakeHost();
    await mountGithubPlugin(host);
    const owned = createOwnerScopedMcpServerFor(() => host)(bot, "t1");
    for (const tool of ["mcp__github__exec", "github__run_shell", "mcp__github__bash"]) {
      expect(memberBotAdminReason({ tool, workspaceRoot: root, ownerScopedMcpServer: owned })).toBeNull();
    }
    // M-20261119-008: a server no list names is no evidence either: the
    // engines load only what Sagax mounts, never a shell of the shared host
    expect(memberBotAdminReason({ tool: "mcp__elsewhere__exec", workspaceRoot: root, ownerScopedMcpServer: owned })).toBeNull();
    // the shared host's own shell server keeps its reading
    expect(memberBotAdminReason({ tool: "mcp__shell__exec", workspaceRoot: root, ownerScopedMcpServer: owned })).toBe("host-shell");
  });

  it("is cleared when the turn ends, never by another turn's end", async () => {
    const host = fakeHost();
    await mountGithubPlugin(host);
    Object.assign(host, {
      standInRoots: new Map(), endForeignTurns: () => {}, guestDrivenTurns: new Map(), internalCapabilities: new Map(),
      activeInternalGenerationByThread: new Map(), internalGenerationByProviderTurn: { deleteGeneration: () => {} },
    });
    const revoke = createRevokeInternalCapabilityGeneration(() => host);
    await revoke("t1", "g0");
    expect(host.turnPluginMcpServers.has("t1")).toBe(true);
    await revoke("t1", "g1");
    expect(host.turnPluginMcpServers.has("t1")).toBe(false);
    expect(createOwnerScopedMcpServerFor(() => host)(bot, "t1")("github")).toBe(false);
  });

  it("is forgotten by a later turn that mounts none", async () => {
    const host = fakeHost();
    await mountGithubPlugin(host);
    await createMountPluginMcp(() => host)({}, { botId: bot.id, threadId: "t1", generation: "g2", customMcp: false, principal: "bob" });
    expect(host.turnPluginMcpServers.has("t1")).toBe(false);
    expect(createOwnerScopedMcpServerFor(() => host)(bot, "t1")("github")).toBe(false);
  });

  it("is kept per bot: another bot's turn in the same thread neither shares nor clears it", async () => {
    const host = fakeHost();
    await mountGithubPlugin(host);
    const other = { id: "bot-2", ownerUserId: "bob" };
    expect(createOwnerScopedMcpServerFor(() => host)(other, "t1")("github")).toBe(false);
    await createMountPluginMcp(() => host)({}, { botId: other.id, threadId: "t1", generation: "g9", customMcp: false, principal: "bob" });
    expect(createOwnerScopedMcpServerFor(() => host)(bot, "t1")("github")).toBe(true);
    Object.assign(host, {
      standInRoots: new Map(), endForeignTurns: () => {}, guestDrivenTurns: new Map(), internalCapabilities: new Map(),
      activeInternalGenerationByThread: new Map(), internalGenerationByProviderTurn: { deleteGeneration: () => {} },
    });
    await createRevokeInternalCapabilityGeneration(() => host)("t1", "g9");
    expect(createOwnerScopedMcpServerFor(() => host)(bot, "t1")("github")).toBe(true);
  });

  it("the person's own Mac apps are theirs while Sagax mounted them for the turn", () => {
    const host = fakeHost({ turnWorkplaces: new Map([["t1", { botId: bot.id, messagesPrincipal: "bob" }]]) });
    const owned = createOwnerScopedMcpServerFor(() => host)(bot, "t1");
    expect(memberBotAdminApproval({ tool: "messages__mac_notes_search", workspaceRoot: root, ownerScopedMcpServer: owned })).toBe(false);
    // M-20261119-008: with no record of the mount, still no evidence it is
    // someone else's: the person's card
    const other = createOwnerScopedMcpServerFor(() => fakeHost())(bot, "t1");
    expect(memberBotAdminApproval({ tool: "messages__mac_notes_search", workspaceRoot: root, ownerScopedMcpServer: other })).toBe(false);
  });
});

describe("a shell a member's turn asks on the shared host", () => {
  it("never waits for an admin: the bot's own computer, else a plain refusal", () => {
    expect(orgServerExecRouting({ callerMayDriveOrgServer: false, botHasOwnComputer: true })).toBe("use-bot-computer");
    expect(orgServerExecRouting({ callerMayDriveOrgServer: false, botHasOwnComputer: false })).toBe("no-computer");
    expect(EXEC_USE_BOT_COMPUTER).toContain("own computer");
    expect(EXEC_USE_BOT_COMPUTER).not.toMatch(/admin/i);
  });

  const noEnvironment = () => ownPlaceRefusal({ target: "none", principal: "bob", reason: "server-default" });
  it("says why no place of the person's own can be had, and what to do", () => {
    const pinned = ownPlaceRefusal({ target: "user-desktop", principal: "bob", reason: "pinned-desktop" });
    expect(pinned).toContain("not connected");
    expect(pinned).toContain("Workspace to Cloud");
    expect(noEnvironment()).toContain("Workspace to This computer");
    for (const text of [pinned, noEnvironment()]) expect(text).not.toContain("Works on");
    expect(noEnvironment()).toContain("no server environment");
    const nobody = ownPlaceRefusal({ target: "none", principal: null, reason: "unknown" });
    expect(nobody).toContain("no person asked");
    for (const text of [pinned, noEnvironment(), nobody, ownPlaceRefusal(undefined)]) {
      expect(text.startsWith("Nothing ran")).toBe(true);
      expect(text).toContain("no admin is asked");
      expect(text).not.toMatch(/waiting for an admin|admin has to approve/i);
    }
  });
});

describe("what can still wait for an organization admin on a member's bot", () => {
  it("is this fixed list: each one reaches past the person's own environment", () => {
    expect([...MEMBER_ADMIN_REASONS]).toEqual(["other-bot-act", "host-shell", "host-engine-tool", "outside-own-folders", "host-tool", "foreign-tool"]);
    const reason = (input: Parameters<typeof memberBotAdminReason>[0]) => memberBotAdminReason(input);
    expect(reason({ tool: "agents__act", workspaceRoot: root, rawInput: { method: "GET", path: "/api/bots/someone-else" }, ownsBot: () => false })).toBe("other-bot-act");
    expect(reason({ tool: "Bash", command: { command: "ls", cwd: root }, workspaceRoot: root })).toBe("host-shell");
    expect(reason({ tool: "agents__vm_exec", workspaceRoot: root })).toBe("host-tool");
    expect(reason({ tool: "Read", paths: ["/etc/passwd"], workspaceRoot: root })).toBe("outside-own-folders");
    // the engine's own tools of the shared host: work on the host, like the shell
    for (const tool of ["WebFetch", "mcp__computer__click", "browser__navigate"]) {
      expect(reason({ tool, workspaceRoot: root })).toBe("host-engine-tool");
    }
    // foreign-tool: provably someone else's place, the organization's own
    // server list, or the organization's account connectors
    expect(reason({ tool: "mcp__sagax-desktop__screenshot", workspaceRoot: root, placeOfAnotherPerson: true })).toBe("foreign-tool");
    expect(reason({ tool: "mcp__org_list__query", workspaceRoot: root, orgSharedMcpServer: (server) => server === "org_list" })).toBe("foreign-tool");
    expect(reason({ tool: "mcp__claude_ai_Microsoft_365__outlook_email_search", workspaceRoot: root })).toBe("foreign-tool");
    // M-20261119-008: no evidence is the person's card
    expect(reason({ tool: "mcp__sagax-desktop__screenshot", workspaceRoot: root })).toBeNull();
    expect(reason({ tool: "mcp__elsewhere__list_issues", workspaceRoot: root })).toBeNull();
    // the person's own place: never an admin's
    expect(reason({ tool: "Bash", command: { command: "ls", cwd: root }, workspaceRoot: root, ownEnvironment: true })).toBeNull();
    expect(reason({ tool: "agents__list_bots", workspaceRoot: root })).toBeNull();
  });

  it("work on the shared host is never an admin wait for a member's own turn; the rest reaches past the person", () => {
    expect([...HOST_RUN_REASONS].sort()).toEqual(["host-engine-tool", "host-shell", "outside-own-folders"]);
    for (const kept of ["other-bot-act", "host-tool", "foreign-tool"] as const) expect(HOST_RUN_REASONS.has(kept)).toBe(false);
  });

  it("is set on a card in one place only", () => {
    const serverDir = fileURLToPath(new URL(".", import.meta.url));
    const setters: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { if (name !== "node_modules") walk(path); continue; }
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
        if (/adminApproval: true/.test(readFileSync(path, "utf8"))) setters.push(path.slice(serverDir.length).split(sep).join("/"));
      }
    };
    walk(serverDir);
    expect(setters).toEqual(["runtime-events/request-opened-present.ts"]);
  });
});
