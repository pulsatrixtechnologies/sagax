// #2029: the console's bot sheet lists what the bot receives, resolved for
// the bot's owner, never the console person's own servers, Roles or "Me"
// plugins; and no field it shows carries a raw principal id.
import { describe, expect, it } from "vitest";

import type { PersonalMcpServer } from "../people/person-connections.ts";
import { resolveBotCapabilities, type BotPluginInput, type CapabilityInputs } from "./capabilities.ts";
import { consoleBotCapabilities, type ConsoleCapabilitiesDeps } from "./console-bot-capabilities.ts";
import { botsRoutes, type BotsDeps } from "../org/org-admin-bots.ts";
import type { AdminBot, AdminBotReach } from "../org/org-admin-routes.ts";
import { fakeConsole } from "../testing/console-context.ts";
import type { BotCapabilities } from "../../shared/capabilities.ts";

const OWNER = "pr_00000000-0000-4000-8000-000000000001";
const ADMIN = "pr_admin";
const NAMES: Record<string, string> = { [OWNER]: "Alex", [ADMIN]: "Sam" };
const now = Date.now();
const server = (url: string): PersonalMcpServer => ({ type: "http", url, auth: "none", enabled: true, addedAt: now }) as PersonalMcpServer;

/** Each person's own things, as Mes connexions and their plugins keep them. */
const PEOPLE: Record<string, { servers: Record<string, PersonalMcpServer>; plugins: BotPluginInput[]; roles: string[] }> = {
  [OWNER]: {
    servers: { "owner-crm": server("https://crm.example.com/mcp") },
    plugins: [{ key: "owner-notes@market", name: "owner-notes", marketplace: "market", enabled: true, declaredMcpServers: [], dir: "/me/owner/owner-notes", present: true, contents: { skills: ["n"], commands: [], agents: [] }, installedBy: NAMES[OWNER], installedById: OWNER }],
    roles: ["r-owner"],
  },
  [ADMIN]: {
    servers: { "admin-private": server("https://private.example.com/mcp") },
    plugins: [{ key: "admin-review@market", name: "admin-review", marketplace: "market", enabled: true, declaredMcpServers: [], dir: "/me/admin/admin-review", present: true, contents: { skills: ["r"], commands: [], agents: [] } }],
    roles: ["r-admin"],
  },
};

function inputsFor(principal: string): CapabilityInputs {
  const person = PEOPLE[principal]!;
  return {
    organization: true,
    bot: { id: "b1", name: "Scout" },
    engine: { instanceId: "claude", kind: "claudeAgent", label: "Claude", customMcp: true },
    botPlugins: [],
    botPluginDirs: [],
    personalPlugins: person.plugins,
    workspacePlugins: [],
    orgFlow: { dirsFor: () => [], guarded: false, member: true, dirOf: () => undefined },
    installationServers: [],
    configured: {},
    filterPolicy: (servers) => servers,
    githubToken: undefined,
    serverAuth: () => undefined,
    personal: { servers: person.servers, hasEnvironment: true, hostRefused: () => false, signedIn: () => false },
    skills: [],
    librarySkills: [],
    skillsLibrary: false,
    roles: {
      catalog: [{ id: "r-owner", slug: "owner-role", name: "Owner Role", description: "" }, { id: "r-admin", slug: "admin-role", name: "Admin Role", description: "" }],
      held: person.roles,
    },
    claudeAi: { rides: false },
    grokCloud: false,
  };
}

const deps: ConsoleCapabilitiesDeps<{ id: string; owner: string }> = {
  bot: (id) => (id === "b1" ? { id, owner: OWNER } : undefined),
  owner: (bot) => bot.owner,
  level: (looking, orgAdmin, bot) => (looking === bot.owner ? "owner" : orgAdmin ? "manage" : null),
  name: (id) => NAMES[id] ?? "",
  resolve: (_bot, as) => resolveBotCapabilities(inputsFor(as.principal), { principalId: as.principal, mayChange: as.mayChange, ...(as.computedFor ? { computedFor: as.computedFor } : {}) }),
};

function routes() {
  const bot = { id: "b1", name: "Scout", owner: { principalId: OWNER, sub: null, name: "Alex" } } as unknown as AdminBot;
  const reach: AdminBotReach = { ownerPrincipalId: OWNER, grantTargets: [], sectionMemberTargets: [] };
  const partial: Partial<BotsDeps> = { bots: () => [{ bot, reach }], capabilities: (id, viewer) => consoleBotCapabilities(deps, id, viewer) };
  return fakeConsole(botsRoutes(partial as BotsDeps));
}

const names = (list: BotCapabilities) => list.items.map((item) => item.name.toLowerCase());
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\bpr_[0-9a-z-]+/i;

describe("console bot capabilities (#2029)", () => {
  it("an admin looking at another person's bot sees the owner's list, never their own", async () => {
    const got = await routes().call("GET", "bots/b1/capabilities", { principalId: ADMIN });
    expect(got.status).toBe(200);
    const list = got.body as BotCapabilities;
    const listed = names(list).join(" ");
    expect(listed).toContain("owner crm");
    expect(listed).toContain("owner notes");
    expect(listed).toContain("owner role");
    expect(listed).not.toContain("admin private");
    expect(listed).not.toContain("admin review");
    // the catalog lists every Role: only the owner's is on
    const on = list.items.filter((item) => item.state === "on").map((item) => item.name.toLowerCase());
    expect(on).toContain("owner role");
    expect(on).not.toContain("admin role");
    expect(list.items.some((item) => item.key.includes("admin-private") || item.key.includes("admin-review"))).toBe(false);
    expect(list.computedFor).toEqual({ principalId: OWNER, name: "Alex" });
    // the owner's own switches are not the admin's
    expect(list.items.filter((item) => item.scope === "me").every((item) => !item.canToggle)).toBe(true);
  });

  it("no shown field carries a raw id (the id only in installedById / computedFor.principalId)", async () => {
    const list = (await routes().call("GET", "bots/b1/capabilities", { principalId: ADMIN })).body as BotCapabilities;
    const plugin = list.items.find((item) => item.form === "plugin")!;
    expect(plugin.installedBy).toBe("Alex");
    expect(plugin.installedById).toBe(OWNER);
    const shown = list.items.flatMap((item) => [item.name, item.description ?? "", item.installedBy ?? "", item.source.label]);
    shown.push(list.computedFor!.name, list.engine.label);
    for (const text of shown) expect(text).not.toMatch(GUID);
  });

  it("the owner looking at their own bot: unchanged, no computedFor, their switches stay theirs", () => {
    const list = consoleBotCapabilities(deps, "b1", { principalId: OWNER, orgAdmin: false })!;
    expect(list.computedFor).toBeUndefined();
    expect(names(list).join(" ")).toContain("owner crm");
    expect(list.items.find((item) => item.form === "plugin" && item.scope === "me")!.canToggle).toBe(true);
  });

  it("an unknown name is never replaced by the id", () => {
    const list = consoleBotCapabilities({ ...deps, name: (id) => id }, "b1", { principalId: ADMIN, orgAdmin: true })!;
    expect(list.computedFor).toEqual({ principalId: OWNER, name: "" });
  });
});
