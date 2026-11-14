// #3283 (owner rule of 2026-10-26): a member manages their own bots,
// groups, setups and settings without an admin; admin is only what reaches
// past the person's own space. The tool policy (server/tools/tool-policy.ts)
// and the guard (server/tools/tool-guard.ts) together: each own-space action
// passes for its owner (or a bot speaking for them) with no grant, and the
// same action on another person's thing, or an organization-wide one, does not.
import { describe, expect, it } from "vitest";
import { agentToolGuardPolicy, AGENT_TOOL_POLICY } from "../agent-api.ts";
import { ToolGrantStore } from "./tool-grants.ts";
import { guardDecision, type GuardTarget } from "./tool-guard.ts";
import { policyFor } from "./tool-policy.ts";
import { can, MEMBER_ALWAYS_PERMISSIONS, PERMISSIONS } from "../../shared/permissions.ts";

const ann = { kind: "user" as const, id: "pr_ann" };
const annBot = { kind: "bot" as const, id: "bot-ann" };

function decide(method: string, path: string, subject: typeof ann | typeof annBot, target?: GuardTarget) {
  const policy = policyFor(method, path);
  expect(policy.matched, `${method} ${path}`).toBe(true);
  return guardDecision(policy, subject, subject.kind === "bot" ? ann : null, new ToolGrantStore(null), target);
}

// Deletions of something one person owns: the guard is told whose it is.
const OWNED: ReadonlyArray<readonly [string, string]> = [
  ["DELETE", "/api/bots/bot-1"],
  ["DELETE", "/api/bots/bot-1/workspace/file"],
  ["DELETE", "/api/bots/bot-1/workspace/entry"],
  ["DELETE", "/api/bots/bot-1/projects/p-1"],
  ["DELETE", "/api/bots/bot-1/queue/q-1"],
  ["DELETE", "/api/bots/bot-1/tasks/t-1"],
  ["DELETE", "/api/bots/bot-1/task-list/task_1"],
  ["DELETE", "/api/bots/bot-1/rules/sets/set-1"],
  ["DELETE", "/api/bots/bot-1/direct-grants/pr_bob"],
  ["DELETE", "/api/bots/bot-1/command-allowlist/rule-1"],
  ["DELETE", "/api/groups/room-1"],
  ["DELETE", "/api/groups/room-1/queue/q-1"],
  ["DELETE", "/api/groups/room-1/tasks/t-1"],
  ["DELETE", "/api/groups/room-1/projects/p-1"],
  ["DELETE", "/api/webhooks/wh-1"],
  ["DELETE", "/api/routine-runs"],
];

// Routes whose handler binds everything to the signed-in person.
const PERSONAL: ReadonlyArray<readonly [string, string]> = [
  ["DELETE", "/api/approval-rules/rule-1"],
  ["PATCH", "/api/approval-rules/rule-1"],
  ["POST", "/api/custom-rules"],
  ["PATCH", "/api/custom-rules/rule-1"],
  ["DELETE", "/api/custom-rules/rule-1"],
  ["DELETE", "/api/sidebar-sections"],
  ["DELETE", "/api/me/providers/keys/openai"],
  // #4185: the person's own Perspicax product keys
  ["PUT", "/api/me/perspicax/products/cw-1/key"],
  ["DELETE", "/api/me/perspicax/products/cw-1/key"],
  ["POST", "/api/me/perspicax/products/cw-1/test"],
];

// Past the person's own space: other people, the organization, the shared
// server, its billing, and granting itself.
const BEYOND: ReadonlyArray<readonly [string, string]> = [
  ["POST", "/api/org/invites/inv-1/revoke"],
  ["POST", "/api/org/people/pr_bob/connections/revoke"],
  ["DELETE", "/api/team-memory/m-1"],
  ["DELETE", "/api/auth/sessions/s-1"],
  ["POST", "/api/tool-grants/tg_1/revoke"],
  ["POST", "/api/bots/bot-1/tool-grants/tg_1/revoke"],
  ["POST", "/api/computers/vps/v-1/remove"],
  ["DELETE", "/api/bot-presets/preset-1"],
];

describe("own space without an admin (#3283)", () => {
  it.each(OWNED)("%s %s: the owner, and a bot speaking for them, need no grant", (method, path) => {
    expect(decide(method, path, ann, { ownerPrincipalId: "pr_ann" })).toMatchObject({ allow: true, reason: "owner" });
    expect(decide(method, path, annBot, { ownerPrincipalId: "pr_ann" })).toMatchObject({ allow: true, reason: "owner" });
  });

  it.each(PERSONAL)("%s %s: the person's own route is a write on by default", (method, path) => {
    expect(policyFor(method, path)).toMatchObject({ tier: "write", defaultEnabled: true });
    expect(decide(method, path, ann)).toMatchObject({ allow: true, reason: "default" });
    expect(decide(method, path, annBot)).toMatchObject({ allow: true, reason: "default" });
  });

  it("create_agent makes the caller's own bot: on by default, no grant", () => {
    const policy = agentToolGuardPolicy(AGENT_TOOL_POLICY.create_agent, "create_agent");
    expect(policy).toMatchObject({ tier: "write", defaultEnabled: true });
    expect(guardDecision(policy, annBot, ann, new ToolGrantStore(null))).toMatchObject({ allow: true, reason: "default" });
  });
});

describe("isolation between people stays (#3283)", () => {
  it.each(OWNED)("%s %s: another person's thing still needs a grant", (method, path) => {
    expect(decide(method, path, ann, { ownerPrincipalId: "pr_bob" })).toMatchObject({ allow: false, reason: "not_granted" });
    expect(decide(method, path, annBot, { ownerPrincipalId: "pr_bob" })).toMatchObject({ allow: false, reason: "not_granted" });
    // an owner nobody can name is not the person's
    expect(decide(method, path, ann)).toMatchObject({ allow: false, reason: "not_granted" });
  });

  it.each(BEYOND)("%s %s: an organization-wide or rights route stays admin", (method, path) => {
    expect(policyFor(method, path)).toMatchObject({ tier: "admin", defaultEnabled: false });
    expect(policyFor(method, path).ownerScoped).toBeUndefined();
    expect(decide(method, path, ann, { ownerPrincipalId: "pr_ann" })).toMatchObject({ allow: false, reason: "not_granted" });
  });

  it("archiving another person's agent still needs a grant", () => {
    const policy = agentToolGuardPolicy(AGENT_TOOL_POLICY.delete_agent, "delete_agent");
    expect(guardDecision(policy, annBot, ann, new ToolGrantStore(null), { ownerPrincipalId: "pr_bob" })).toMatchObject({ allow: false, reason: "not_granted" });
    expect(guardDecision(policy, annBot, ann, new ToolGrantStore(null), { ownerPrincipalId: "pr_ann" })).toMatchObject({ allow: true, reason: "owner" });
  });
});

// shared/permissions.ts: every key a member lacks by default reaches past
// their own space (reviewed for #3283); every key about their own things is
// held whatever Perspicax sends. A new off-by-default key fails here until
// someone classifies it.
const BEYOND_KEYS: Readonly<Record<string, string>> = {
  "bots.computer": "the server's paid cloud computer and its shared browser profiles (own computer and browser need bots.create)",
  "bots.catalogFeature": "the organization's bot catalogue",
  "engines.manage": "the server's engines",
  "apps.serverPlugins": "a plugin for the whole server",
  "apps.marketplaces": "the server's marketplaces",
  "skills.library": "the server's shared skills library",
  "routines.runAsAnyone": "runs a routine as another person",
  "routines.runNowAny": "runs another person's routine",
  "routines.viewTeam": "other people's routines",
  "routines.viewAll": "every routine of the organization",
  "people.labelAnyone": "another person's label",
  "people.activityLog": "the organization's admin log",
  "people.manage": "other people's sessions, connections and bots",
  "usage.view": "the organization's usage, spend and budget",
  "backup.workspace": "everyone's conversations and files",
  "host.commands": "a shell on the shared server",
  "host.shell": "the shared server's setup and other people's commands",
  "server.settings": "the installation's settings",
  "server.experimental": "features for the whole server",
  "server.link": "who reaches the server at all",
  "clients.approvalsAnswer": "cards of bots that are not theirs (their own bots need no key)",
  "clients.peopleNudge": "reaches another person",
};

describe("member permission keys (#3283)", () => {
  it("every key off by default for a member reaches past their own space", () => {
    const off = PERMISSIONS.filter((entry) => !entry.memberDefault).map((entry) => entry.key).sort();
    expect(off).toEqual(Object.keys(BEYOND_KEYS).sort());
  });

  it("a member holds each own-space key with nothing from Perspicax, and no key past it", () => {
    const member = { admin: false, permissions: MEMBER_ALWAYS_PERMISSIONS };
    for (const key of ["bots.create", "bots.approvalLevel", "bots.behaviour", "bots.tools", "sharing.grants", "sharing.visibility", "apps.ownIntegrations", "folders.botWorkingFolder", "folders.roomWorkingFolder", "clients.agentsCreate", "clients.routinesWrite"] as const) {
      expect(can(member, key), key).toBe(true);
    }
    for (const key of Object.keys(BEYOND_KEYS) as (keyof typeof BEYOND_KEYS & Parameters<typeof can>[1])[]) {
      expect(can(member, key), key).toBe(false);
    }
  });
});
