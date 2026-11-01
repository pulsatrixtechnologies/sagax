import { describe, expect, it } from "vitest";
import { basename } from "node:path";

import type { McpServerSpec } from "./contracts.ts";
import type { PersonalMcpServer } from "./person-connections.ts";
import { listedMounts, resolveBotCapabilities, type CapabilityInputs } from "./capabilities.ts";
import { engineServerMcp, perspicaxServerName, personalMcpPrecheck, serverMcpAsPerson, turnPluginPromptDirs } from "./turn-mounts.ts";
import { selectPluginScopes } from "./capability-plugin-mounts.ts";
import { servedCapabilities } from "../shared/capabilities.ts";
import { PERSPICAX_MCP_PREFIX, reservedMcpName } from "../shared/mcp-reserved-names.ts";

const remote = (url: string): McpServerSpec => ({ type: "http", url, headers: {} });
const now = Date.now();
const personal = (server: Partial<PersonalMcpServer> & { kind: "remote" | "stdio" }): PersonalMcpServer => (server.kind === "remote"
  ? { type: "http", url: "https://tools.example.com/mcp", auth: "none", enabled: true, addedAt: now, ...server }
  : { command: "npx", args: [], env: {}, runsIn: "environment", enabled: true, addedAt: now, ...server }) as PersonalMcpServer;

type Engine = CapabilityInputs["engine"];
const ENGINES: Engine[] = [
  { instanceId: "claude", kind: "claudeAgent", label: "Claude", customMcp: true },
  { instanceId: "codex", kind: "codex", label: "Codex", customMcp: true },
  { instanceId: "grok", kind: "grok", label: "Grok", customMcp: true },
];

const POLICY_REFUSED = new Set(["blocked"]);
const filterPolicy = <T extends Record<string, McpServerSpec>>(servers: T): T =>
  Object.fromEntries(Object.entries(servers).filter(([name]) => !POLICY_REFUSED.has(name))) as T;

function inputs(engine: Engine): CapabilityInputs {
  // config.json mcpServers, and what customMcpServers keeps for the bot
  const configured: Record<string, McpServerSpec> = {
    notes: remote("https://notes.example.com/mcp"),
    github: remote("https://api.githubcopilot.com/mcp/"),
    cmd: { command: "node", args: ["server.js"], env: {} },
    blocked: remote("https://blocked.example.com/mcp"),
    docs: remote("https://docs.example.com/mcp"),
  };
  return {
    organization: true,
    organizationName: "Example Org",
    bot: { id: "bot1", name: "Scout", perspicaxProfiles: ["r2", "r1"], assignedSkills: ["lib-skill"] },
    engine,
    botPlugins: [
      { key: "alpha@market", name: "alpha", marketplace: "market", enabled: true, declaredMcpServers: ["alpha-server"], dir: "/plugins/alpha", present: true, contents: { skills: ["a1"], commands: ["c1"], agents: ["g1"] } },
      { key: "beta@market", name: "beta", marketplace: "market", enabled: false, declaredMcpServers: [], dir: "/plugins/beta", present: true, contents: { skills: ["b1"], commands: [], agents: [] } },
      { key: "gamma@market", name: "gamma", marketplace: "market", enabled: true, declaredMcpServers: [], dir: "/plugins/gamma", present: false, contents: { skills: ["g"], commands: [], agents: [] } },
    ],
    botPluginDirs: ["/plugins/alpha"],
    workspacePlugins: [{ key: "docs@market", name: "docs", marketplace: "market", servers: ["docs"], skills: ["docs-skill"] }],
    orgFlow: {
      dirsFor: (own) => own.some((dir) => dir.endsWith("/pulsatrix-flow")) ? [] : ["/org-flow/pulsatrix-flow"],
      declared: [{ name: "pulsatrix-flow", version: "0.20.14", tenant: false }],
      guarded: true,
      member: true,
      dirOf: (name) => name === "pulsatrix-flow" ? "/org-flow/pulsatrix-flow" : undefined,
    },
    installationServers: [
      ...Object.entries(configured).map(([name, spec]) => ({ name, valid: true, enabled: true, remote: "url" in spec, ...("url" in spec ? { url: spec.url } : {}), ...(name === "docs" ? { source: "market" } : {}) })),
      { name: "docs-off", valid: true, enabled: false, remote: true },
      { name: "mcp-old", valid: true, enabled: true, remote: true },
    ],
    configured,
    filterPolicy,
    githubToken: undefined,
    serverAuth: (name) => (name === "notes" ? "required" : undefined),
    personal: {
      servers: {
        jira: personal({ kind: "remote", url: "https://jira.example.com/mcp", auth: "token", token: "t" }),
        notes: personal({ kind: "remote", url: "https://other-notes.example.com/mcp" }),
        cli: personal({ kind: "stdio" }),
        gh: personal({ kind: "remote", url: "https://gh.example.com/mcp", auth: "github" }),
        a__b: personal({ kind: "remote", url: "https://ab.example.com/mcp" }),
        sso: personal({ kind: "remote", url: "https://sso.example.com/mcp", auth: "oauth" }),
        private: personal({ kind: "remote", url: "https://intranet.example.com/mcp" }),
        paused: personal({ kind: "remote", url: "https://paused.example.com/mcp", enabled: false }),
      },
      hasEnvironment: true,
      hostRefused: (url) => url.includes("intranet"),
      signedIn: () => false,
    },
    skills: [
      { name: "own-skill", description: "d", enabled: true, origin: "private", source: "https://github.com/acme/skills" },
      { name: "off-skill", description: "d", enabled: false, origin: "private", source: "https://github.com/acme/skills" },
    ],
    librarySkills: [{ name: "docs-skill", source: "market" }],
    skillsLibrary: false,
    roles: {
      catalog: [{ id: "r1", slug: "dispatch", name: "Dispatch", description: "" }, { id: "r2", slug: "cw", name: "ConnectWise", description: "" }],
      held: ["r1"],
    },
    claudeAi: { rides: engine.kind === "claudeAgent", connectors: [{ name: "Microsoft 365", status: "connected" }] },
    grokCloud: engine.kind === "grok",
  };
}

/** What a turn of this bot mounts, in the order server/index.ts builds it,
 * with the same functions: this installation's servers (customMcp only),
 * the Roles the speaker holds, then the speaker's own servers. */
function turnMcp(input: CapabilityInputs): string[] {
  if (!input.engine.customMcp) return [];
  const servers = serverMcpAsPerson(engineServerMcp({ configured: input.configured, organization: input.organization, filterPolicy: input.filterPolicy }), { organization: input.organization, githubToken: input.githubToken }).servers;
  const custom = new Set(Object.keys(servers));
  const catalog = new Map(input.roles.catalog.map((role) => [role.id, role] as const));
  for (const id of [...new Set(input.bot.perspicaxProfiles)].sort()) {
    const role = catalog.get(id);
    if (role && input.roles.held?.includes(id)) custom.add(perspicaxServerName(role.slug || role.id, custom));
  }
  const person = input.personal!;
  for (const [name, server] of Object.entries(person.servers)) {
    const check = personalMcpPrecheck(name, server, { taken: (other) => custom.has(other), hasEnvironment: person.hasEnvironment, github: person.github });
    if ("skip" in check) continue;
    if (server.kind === "remote" && (person.hostRefused(server.url) || (server.auth === "oauth" && !person.signedIn(name, server)))) continue;
    custom.add(name);
  }
  // Sagax's own servers (the environment, Flow's compute) are tools of
  // Sagax, not capabilities; a Role's server is one
  return [...custom].filter((name) => PERSPICAX_MCP_PREFIX.test(name) || !reservedMcpName(name)).sort();
}

function turnDirs(input: CapabilityInputs): string[] {
  const selected = selectPluginScopes({
    organization: input.orgFlow.dirsFor([]).map((dir) => ({ name: basename(dir), dir })),
    person: (input.personalPlugins ?? []).filter((plugin) => plugin.enabled && plugin.present),
    bot: input.botPluginDirs.map((dir) => ({ name: basename(dir), dir })),
  });
  return (input.engine.kind === "claudeAgent" ? selected.map((plugin) => plugin.dir)
    : turnPluginPromptDirs(input.engine.kind, selected.map((plugin) => plugin.dir))).sort();
}

const dirOfItem = (input: CapabilityInputs, key: string): string | undefined => {
  const plugin = input.botPlugins.find((entry) => `plugin:bot:${entry.key}` === key);
  if (plugin) return plugin.dir;
  const flow = /^flow:organization:(.+)$/.exec(key);
  return flow ? input.orgFlow.dirOf(flow[1]!) : undefined;
};

describe("personal and complete plugin capabilities", () => {
  const byKey = (list: ReturnType<typeof resolveBotCapabilities>, key: string) => list.items.find((item) => item.key === key);
  it("folds official GitHub Flow copies and tenant content into one linked pack on every engine", () => {
    const input = inputs({ ...ENGINES[2]!, agentsMcp: true });
    input.orgFlow.declared!.push({ name: "pulsatrix-flow-example", version: "1.2.0", tenant: true });
    input.orgFlow.dirOf = (name) => `/org-flow/${name}`;
    input.orgFlow.dirsFor = () => ["/org-flow/pulsatrix-flow", "/org-flow/pulsatrix-flow-example"];
    input.orgFlow.pack = `sha256:${"a".repeat(64)}`;
    input.orgFlow.contentsOf = (name) => ({ skills: [name === "pulsatrix-flow" ? "using-px-flow" : "shipping"], commands: [], agents: [] });
    input.botPlugins.push({ ...input.botPlugins[0]!, key: "pulsatrix-flow@pulsatrix", name: "pulsatrix-flow", dir: "/bot/pulsatrix-flow" });
    input.botPluginDirs.push("/bot/pulsatrix-flow");
    input.orgFlow.aliases = ["pulsatrix-flow@pulsatrix"];
    let list = resolveBotCapabilities(input, { principalId: "p1", mayChange: true });
    expect(list.items.filter((item) => item.form === "flow")).toHaveLength(1);
    expect(byKey(list, "flow:organization:pulsatrix-flow")).toMatchObject({ state: "imposed", brings: { skills: ["using-px-flow", "shipping"] }, source: { version: "0.20.14", pack: input.orgFlow.pack }, engine: { skills: "prompt" } });
    expect(byKey(list, "plugin:bot:pulsatrix-flow@pulsatrix")).toBeUndefined();
    input.orgFlow.guarded = false;
    input.orgFlow.dirsFor = () => [];
    list = resolveBotCapabilities(input, { principalId: "p1", mayChange: true });
    expect(byKey(list, "flow:organization:pulsatrix-flow")).toMatchObject({ state: "off", reason: "guard_off" });
    expect(byKey(list, "plugin:bot:pulsatrix-flow@pulsatrix")).toBeUndefined();
  });

  it("reports a capability whose whole instructions exceed the prompt budget as not served", () => {
    const input = inputs({ ...ENGINES[2]!, agentsMcp: true });
    input.capabilityPromptIndex = { "plugin:bot:alpha@market": { bytes: 240, maxBytes: 4_000, skills: 0, maxSkills: 30, omitted: 3 } };
    expect(byKey(resolveBotCapabilities(input, { mayChange: true }), "plugin:bot:alpha@market")).toMatchObject({ state: "not_served", engine: { nothing: true }, promptIndex: { omitted: 3 } });
  });
  it("does not claim an omitted instruction kind was received with a smaller included skill", () => {
    const input = inputs({ ...ENGINES[2]!, agentsMcp: true });
    input.capabilityPromptIndex = { "plugin:bot:alpha@market": { bytes: 300, maxBytes: 4_000, skills: 1, maxSkills: 30, omitted: 2, parts: { skills: 1, commands: 0, agents: 0 } } };
    expect(byKey(resolveBotCapabilities(input, { mayChange: true }), "plugin:bot:alpha@market")).toMatchObject({ state: "on", engine: { skills: "prompt", commands: "none", agents: "none", nothing: false } });
  });
  it("serves a personal plugin to both file engines with priority over a bot copy", () => {
    for (const engine of ENGINES.slice(0, 2)) {
      const input = inputs(engine);
      input.personalPlugins = [{ ...input.botPlugins[0]!, dir: "/me/alpha" }];
      const list = resolveBotCapabilities(input, { principalId: "p1", mayChange: true });
      expect(byKey(list, "plugin:me:alpha@market")).toMatchObject({ scope: "me", state: "on" });
      expect(byKey(list, "plugin:bot:alpha@market")).toMatchObject({ state: "off", reason: "name_taken" });
      expect(turnDirs(input)).toContain("/me/alpha");
      expect(turnDirs(input)).not.toContain("/plugins/alpha");
      const readOnlyBot = resolveBotCapabilities(input, { principalId: "p1", mayChange: false });
      expect(byKey(readOnlyBot, "plugin:me:alpha@market")?.canToggle).toBe(true);
      expect(byKey(readOnlyBot, "plugin:bot:alpha@market")?.canToggle).toBe(false);
    }
  });

  it("loads a whole organization install before personal and bot copies on each engine", () => {
    for (const engine of ENGINES) {
      const input = inputs(engine);
      input.personalPlugins = [{ ...input.botPlugins[0]!, dir: "/me/alpha" }];
      input.workspacePlugins.push({ key: "alpha@market", name: "alpha", marketplace: "market", servers: [], skills: [], folder: { dir: "/organization/alpha", contents: { skills: ["a1"], commands: ["c1"], agents: ["g1"] }, declaredMcpServers: ["org-command"] } });
      input.pluginMcp = [{ scope: "organization", key: "alpha@market", name: "org-command", spec: { command: "node", args: [], env: {} } }];
      input.pluginEnvironment = true;
      const list = resolveBotCapabilities(input, { principalId: "p1", mayChange: true });
      const row = byKey(list, "plugin:installation:alpha@market");
      expect(row).toMatchObject({ state: "on", brings: { skills: ["a1"], commands: ["c1"], agents: ["g1"], mcpServers: ["org-command"] }, mounts: ["org-command"] });
      expect(row?.engine.mcp).toBe(engine.kind === "grok" ? "proxied" : "mounted");
      expect(byKey(list, "plugin:me:alpha@market")).toMatchObject({ state: "off", reason: "name_taken" });
      expect(byKey(list, "plugin:bot:alpha@market")).toMatchObject({ state: "off", reason: "name_taken" });
      expect(JSON.stringify(list)).not.toContain("\"command\":\"node\"");
    }
  });

  it("serves plugin MCP on an API engine and reports only actual unique mounts", () => {
    const input = inputs(ENGINES[2]!);
    input.personalPlugins = [{ ...input.botPlugins[0]!, key: "personal@market", name: "personal", dir: "/me/personal" }];
    input.pluginEnvironment = true;
    input.pluginHostRefused = (url) => url.includes("intranet");
    input.pluginMcp = [
      { scope: "person", key: "personal@market", name: "review", spec: remote("https://review.example.com/mcp") },
      { scope: "bot", key: "alpha@market", name: "review", spec: remote("https://other.example.com/mcp") },
      { scope: "bot", key: "alpha@market", name: "notes", spec: remote("https://notes.example.com/mcp") },
      { scope: "bot", key: "alpha@market", name: "private", spec: remote("https://intranet.example.com/mcp") },
      { scope: "bot", key: "alpha@market", name: "blocked", spec: remote("https://blocked.example.com/mcp") },
      { scope: "bot", key: "alpha@market", name: "command", spec: { command: "node", args: [], env: {} } },
    ];
    const list = resolveBotCapabilities(input, { principalId: "p1", mayChange: true });
    expect(byKey(list, "plugin:me:personal@market")).toMatchObject({ state: "on", mounts: ["review"], engine: { mcp: "proxied", nothing: false } });
    expect(byKey(list, "plugin:bot:alpha@market")).toMatchObject({ state: "on", mounts: ["command"] });
    expect(listedMounts(list).filter((name) => ["review", "command", "blocked", "private"].includes(name))).toEqual(["command", "review"]);
    input.pluginEnvironment = false;
    const noEnvironment = resolveBotCapabilities(input, { principalId: "p1", mayChange: true });
    expect(byKey(noEnvironment, "plugin:bot:alpha@market")?.mounts).toBeUndefined();
  });
});

describe("a turn mounts exactly what the list says", () => {
  for (const engine of ENGINES) {
    it(`${engine.label}: MCP servers and plugin folders`, () => {
      const input = inputs(engine);
      const list = resolveBotCapabilities(input, { principalId: "p1", mayChange: true });
      expect(listedMounts(list)).toEqual(turnMcp(input));
      const served = servedCapabilities(list.items);
      const servedDirs = served.filter((item) => (item.form === "plugin" || item.form === "flow") && item.scope !== "installation" && item.engine.skills !== "none")
        .map((item) => dirOfItem(input, item.key)).filter(Boolean).sort();
      expect(servedDirs).toEqual(turnDirs(input));
      // every served MCP capability names what it mounts
      for (const item of served.filter((entry) => entry.engine.mcp && entry.engine.mcp !== "none")) expect(item.mounts?.length, item.key).toBeGreaterThan(0);
    });
  }

  it("an engine with no MCP mounts no server and the list says not served; its plugin files still reach the prompt", () => {
    const input = inputs({ instanceId: "plain", kind: "openai-compat", label: "API", customMcp: false });
    const list = resolveBotCapabilities(input, { principalId: "p1", mayChange: true });
    expect(listedMounts(list)).toEqual([]);
    expect(turnMcp(input)).toEqual([]);
    expect(list.items.find((item) => item.key === "mcp:me:jira")?.state).toBe("not_served");
    expect(list.items.find((item) => item.key === "plugin:bot:alpha@market")).toMatchObject({ state: "on", engine: { skills: "prompt" } });
  });
});

describe("resolveBotCapabilities", () => {
  const claude = () => resolveBotCapabilities(inputs(ENGINES[0]!), { principalId: "p1", mayChange: true });
  const codex = () => resolveBotCapabilities(inputs(ENGINES[1]!), { principalId: "p1", mayChange: false });
  const grok = () => resolveBotCapabilities(inputs(ENGINES[2]!), { principalId: "p1", mayChange: true });
  const byKey = (list: ReturnType<typeof claude>, key: string) => list.items.find((item) => item.key === key);

  it("names the engine and keys every item stably, never with an id in the name", () => {
    const list = claude();
    expect(list.engine).toEqual({ kind: "claudeAgent", label: "Claude" });
    expect(new Set(list.items.map((item) => item.key)).size).toBe(list.items.length);
    expect(byKey(list, "role:bot:r1")?.name).toBe("Dispatch");
    expect(list.items.every((item) => !/\br[12]\b/.test(item.name))).toBe(true);
  });

  it("the bot's plugins: on, off, not installed; their MCP servers are named but not received (C-1)", () => {
    const list = claude();
    expect(byKey(list, "plugin:bot:alpha@market")).toMatchObject({ state: "on", scope: "bot", canToggle: true, brings: { mcpServers: ["alpha-server"] }, engine: { skills: "native", nothing: false } });
    expect(byKey(list, "plugin:bot:alpha@market")?.engine.mcp).toBeUndefined();
    expect(byKey(list, "plugin:bot:beta@market")).toMatchObject({ state: "off", enabled: false });
    expect(byKey(list, "plugin:bot:gamma@market")).toMatchObject({ state: "off", reason: "not_installed" });
    expect(byKey(codex(), "plugin:bot:alpha@market")).toMatchObject({ state: "on", canToggle: false, engine: { skills: "prompt", agents: "prompt" } });
    // Q8 C: tools off, an API engine still receives the whole files inline
    expect(byKey(grok(), "plugin:bot:alpha@market")).toMatchObject({ state: "on", engine: { skills: "prompt", commands: "prompt", agents: "prompt", nothing: false } });
    expect(byKey(resolveBotCapabilities(inputs({ ...ENGINES[2]!, agentsMcp: true }), { principalId: "p1", mayChange: true }), "plugin:bot:alpha@market"))
      .toMatchObject({ state: "on", engine: { skills: "prompt", commands: "prompt", agents: "prompt", nothing: false } });
  });

  it("the organization's Flow is imposed on every engine that receives instructions", () => {
    expect(byKey(claude(), "flow:organization:pulsatrix-flow")).toMatchObject({ state: "imposed", scope: "organization", canToggle: false, source: { kind: "perspicax", version: "0.20.14" } });
    expect(byKey(codex(), "flow:organization:pulsatrix-flow")).toMatchObject({ state: "imposed", engine: { skills: "prompt" } });
    expect(byKey(grok(), "flow:organization:pulsatrix-flow")).toMatchObject({ state: "imposed", engine: { skills: "prompt" } });
    const off = inputs(ENGINES[0]!);
    off.orgFlow.guarded = false;
    expect(byKey(resolveBotCapabilities(off, { mayChange: true }), "flow:organization:pulsatrix-flow")).toMatchObject({ state: "off", reason: "guard_off" });
  });

  it("the organization's current Flow folder wins over bot copies, and a missing copy claims nothing", () => {
    const input = inputs(ENGINES[0]!);
    const flow = { ...input.botPlugins[0]!, key: "pulsatrix-flow@market", name: "pulsatrix-flow", dir: "/plugins/pulsatrix-flow", present: false };
    input.botPlugins.push(flow);
    let list = resolveBotCapabilities(input, { mayChange: true });
    expect(byKey(list, "flow:organization:pulsatrix-flow")).toMatchObject({ state: "imposed" });
    expect(servedCapabilities(list.items).filter((item) => item.form === "flow").map((item) => dirOfItem(input, item.key))).toEqual(["/org-flow/pulsatrix-flow"]);
    expect(turnDirs(input)).toContain("/org-flow/pulsatrix-flow");

    flow.present = true;
    input.botPluginDirs.push(flow.dir);
    list = resolveBotCapabilities(input, { mayChange: true });
    expect(byKey(list, "flow:organization:pulsatrix-flow")).toMatchObject({ state: "imposed" });
    expect(byKey(list, "plugin:bot:pulsatrix-flow@market")).toMatchObject({ state: "off", reason: "name_taken" });
    expect(turnDirs(input)).toContain("/org-flow/pulsatrix-flow");
    expect(turnDirs(input)).not.toContain(flow.dir);

    input.engine = ENGINES[1]!;
    list = resolveBotCapabilities(input, { mayChange: true });
    expect(byKey(list, "flow:organization:pulsatrix-flow")).toMatchObject({ state: "imposed" });
    expect(byKey(list, "flow:organization:pulsatrix-flow")?.reason).toBeUndefined();
  });

  it("this installation's servers: each with its state and reason", () => {
    const list = claude();
    expect(byKey(list, "mcp:installation:notes")).toMatchObject({ state: "on", connect: { reason: "sign_in" }, mounts: ["notes"] });
    expect(byKey(list, "mcp:installation:github")).toMatchObject({ state: "to_connect", reason: "needs_github", connect: { reason: "github" } });
    expect(byKey(list, "mcp:installation:cmd")).toMatchObject({ state: "off", reason: "host_command" });
    expect(byKey(list, "mcp:installation:blocked")).toMatchObject({ state: "off", reason: "policy" });
    expect(byKey(list, "mcp:installation:docs-off")).toMatchObject({ state: "off", reason: "disabled" });
    expect(byKey(list, "mcp:installation:mcp-old")).toMatchObject({ state: "reserved", canToggle: false });
    expect(byKey(grok(), "mcp:installation:notes")?.engine.mcp).toBe("proxied");
  });

  it("a plugin \"Everyone\" folds its servers in, and says why its library skills reach nobody (C-2)", () => {
    const list = claude();
    expect(byKey(list, "mcp:installation:docs")).toBeUndefined();
    expect(byKey(list, "plugin:installation:docs@market")).toMatchObject({ state: "on", scope: "installation", mounts: ["docs"], brings: { mcpServers: ["docs"], skills: ["docs-skill"] } });
  });

  it("serves library skills, plugin files and the organization's Flow on API engines when retrieval tools are mounted", () => {
    const input = inputs({ ...ENGINES[2]!, agentsMcp: true });
    input.skillsLibrary = true;
    input.bot.assignedSkills = ["docs-skill"];
    input.skills.push({ name: "docs-skill", description: "Review docs", enabled: true, origin: "library", source: "market" });
    const list = resolveBotCapabilities(input, { mayChange: true });
    expect(byKey(list, "skill:installation:docs-skill")).toMatchObject({ state: "on", engine: { skills: "prompt", nothing: false } });
    expect(byKey(list, "plugin:bot:alpha@market")).toMatchObject({ state: "on", engine: { skills: "prompt", commands: "prompt", agents: "prompt", nothing: false } });
    expect(byKey(list, "flow:organization:pulsatrix-flow")).toMatchObject({ state: "imposed", engine: { skills: "prompt", nothing: false } });
    expect(byKey(list, "plugin:installation:docs@market")?.engine.skills).toBe("prompt");
  });

  it("deleting a plugin MCP and recreating its name manually never gives the replacement to the old plugin", () => {
    const input = inputs(ENGINES[0]!);
    input.installationServers = input.installationServers.filter((server) => server.name !== "docs");
    delete input.configured.docs;
    input.librarySkills = [];
    let list = resolveBotCapabilities(input, { mayChange: true });
    expect(byKey(list, "plugin:installation:docs@market")).toMatchObject({ state: "off", brings: { mcpServers: [], skills: [] } });

    input.configured.docs = remote("https://new-docs.example.com/mcp");
    input.installationServers.push({ name: "docs", valid: true, enabled: true, remote: true });
    for (const source of [undefined, "another-market"]) {
      input.installationServers.find((server) => server.name === "docs")!.source = source;
      list = resolveBotCapabilities(input, { mayChange: true });
      expect(byKey(list, "mcp:installation:docs")).toMatchObject({ state: "on", mounts: ["docs"] });
      expect(byKey(list, "plugin:installation:docs@market")).toMatchObject({ state: "off", brings: { mcpServers: [], skills: [] } });
      expect(list.items.flatMap((item) => item.mounts ?? []).filter((name) => name === "docs")).toHaveLength(1);
    }
  });

  it("a deleted and replaced library skill stays independent of the historical plugin", () => {
    const input = inputs(ENGINES[0]!);
    input.installationServers = input.installationServers.filter((server) => server.name !== "docs");
    delete input.configured.docs;
    input.librarySkills = [];
    expect(byKey(resolveBotCapabilities(input, { mayChange: true }), "plugin:installation:docs@market")?.brings?.skills).toEqual([]);

    input.skillsLibrary = true;
    input.librarySkills = [{ name: "docs-skill", source: "another-market" }];
    input.skills.push({ name: "docs-skill", source: "another-market", origin: "library", description: "Replacement", enabled: true });
    let list = resolveBotCapabilities(input, { mayChange: true });
    expect(byKey(list, "skill:installation:docs-skill")).toMatchObject({ state: "on", description: "Replacement" });
    expect(byKey(list, "plugin:installation:docs@market")).toMatchObject({ state: "off", brings: { skills: [] } });

    input.skillsLibrary = false;
    input.skills = input.skills.filter((skill) => skill.origin !== "library");
    input.bot.assignedSkills = ["docs-skill"];
    list = resolveBotCapabilities(input, { mayChange: true });
    expect(byKey(list, "skill:installation:docs-skill")).toMatchObject({ state: "off", reason: "library_off" });
    expect(byKey(list, "plugin:installation:docs@market")?.reason).toBeUndefined();
  });

  it("two historical plugins from one marketplace cannot both own a current MCP or library skill", () => {
    const input = inputs(ENGINES[0]!);
    input.workspacePlugins.push({ ...input.workspacePlugins[0]!, key: "replacement@market", name: "replacement" });
    input.skillsLibrary = true;
    input.skills.push({ name: "docs-skill", source: "market", origin: "library", description: "Docs", enabled: true });
    const list = resolveBotCapabilities(input, { principalId: "p1", mayChange: true });
    expect(byKey(list, "mcp:installation:docs")).toMatchObject({ state: "on", mounts: ["docs"] });
    expect(byKey(list, "skill:installation:docs-skill")).toMatchObject({ state: "on" });
    for (const key of ["docs@market", "replacement@market"]) {
      expect(byKey(list, `plugin:installation:${key}`)).toMatchObject({ state: "off", brings: { mcpServers: [], skills: [] } });
    }
    expect(list.items.flatMap((item) => item.mounts ?? []).filter((name) => name === "docs")).toHaveLength(1);
    expect(listedMounts(list)).toEqual(turnMcp(input));
  });

  it("the current marketplace selects a single new owner despite an old plugin's name claims", () => {
    const input = inputs(ENGINES[0]!);
    input.workspacePlugins.push({ ...input.workspacePlugins[0]!, key: "replacement@new-market", name: "replacement", marketplace: "new-market" });
    input.installationServers.find((server) => server.name === "docs")!.source = "new-market";
    input.librarySkills = [{ name: "docs-skill", source: "new-market" }];
    const list = resolveBotCapabilities(input, { mayChange: true });
    expect(byKey(list, "mcp:installation:docs")).toBeUndefined();
    expect(byKey(list, "plugin:installation:docs@market")).toMatchObject({ state: "off", brings: { mcpServers: [], skills: [] } });
    expect(byKey(list, "plugin:installation:replacement@new-market")).toMatchObject({ state: "on", mounts: ["docs"], brings: { mcpServers: ["docs"], skills: ["docs-skill"] } });
    expect(list.items.flatMap((item) => item.mounts ?? []).filter((name) => name === "docs")).toHaveLength(1);
  });

  it("the person's own servers: a name the turn already has is shown, not skipped in silence (C-18)", () => {
    const list = claude();
    expect(byKey(list, "mcp:me:jira")).toMatchObject({ state: "on", scope: "me", mounts: ["jira"] });
    expect(byKey(list, "mcp:me:notes")).toMatchObject({ state: "off", reason: "name_taken" });
    expect(byKey(list, "mcp:me:cli")).toMatchObject({ state: "on" });
    expect(byKey(list, "mcp:me:gh")).toMatchObject({ state: "to_connect", reason: "needs_github" });
    expect(byKey(list, "mcp:me:a__b")).toMatchObject({ state: "reserved" });
    expect(byKey(list, "mcp:me:sso")).toMatchObject({ state: "to_connect", reason: "needs_sign_in", connect: { reason: "sign_in" } });
    expect(byKey(list, "mcp:me:private")).toMatchObject({ state: "off", reason: "private_address" });
    expect(byKey(list, "mcp:me:paused")).toMatchObject({ state: "off", reason: "disabled", enabled: false });
  });

  it("Roles: held is on, not held says so (C-5)", () => {
    const list = claude();
    expect(byKey(list, "role:bot:r1")).toMatchObject({ state: "on", mounts: ["perspicax_dispatch"] });
    expect(byKey(list, "role:bot:r2")).toMatchObject({ state: "not_held" });
  });

  it("skills: the bot's own, and a library assignment while the library is off", () => {
    const list = claude();
    expect(byKey(list, "skill:bot:own-skill")).toMatchObject({ state: "on", engine: { skills: "native" }, source: { label: "acme/skills" } });
    expect(byKey(list, "skill:bot:off-skill")).toMatchObject({ state: "off" });
    expect(byKey(list, "skill:installation:lib-skill")).toMatchObject({ state: "off", reason: "library_off" });
    expect(byKey(grok(), "skill:bot:own-skill")).toMatchObject({ state: "on", engine: { skills: "prompt" } });
  });

  it("account connectors: Claude's from its inventory, Grok's catalog unverifiable", () => {
    expect(byKey(claude(), "connector:account:claude:Microsoft 365")).toMatchObject({ state: "on", scope: "account", engine: { tools: "native" } });
    const grokList = grok();
    expect(grokList.items.filter((item) => item.form === "connector").every((item) => item.state === "unverifiable")).toBe(true);
  });
});
