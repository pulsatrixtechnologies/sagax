// #4504: a bot adds, updates and removes a skill, a plugin and a connector
// for its person through sagax_settings, for itself, chosen bots or all of
// them; what the organization requires is refused with why; another
// person's bot is out of reach. The routes are the ones the page calls.
import { describe, expect, it } from "vitest";

import type { TurnFacts } from "../shared/bot-act.ts";
import type { BotActService } from "./bots/bot-act.ts";
import { createSettingsActions, type SettingsActionDeps } from "./settings-actions.ts";

const PERSON: TurnFacts = { automation: false, guest: false, requestUsable: true, senderUnproven: false, provenPerson: "pr_owner", sharedServer: true };

function harness(over: Partial<SettingsActionDeps> & { mode?: "ask" | "auto" | "full"; answer?: unknown } = {}) {
  const planned: Array<{ effect: string; method: string; path: string; body?: unknown }> = [];
  const acts = {
    async handlePlanned(input: Parameters<BotActService["handlePlanned"]>[0]) {
      const target = input.target.kind === "route" ? input.target : { method: "UI", path: "ui", body: undefined };
      if (input.plan.summary === "Read a setting") return { status: 200, body: { text: JSON.stringify(over.answer ?? {}) } };
      planned.push({ effect: input.plan.effect, method: target.method, path: target.path, ...(target.body !== undefined ? { body: target.body } : {}) });
      // another person's bot: its route refuses, as the real one does
      if (target.path.includes("/bots/theirs")) return { status: 404, body: { error: "no such bot" } };
      // the organization's imposed item: its route refuses (server/routes/org-capabilities.ts)
      if (target.path === "/api/me/org-capabilities/d1") return { status: 409, body: { error: "The organization imposes this capability: it stays on.", code: "org_capability_imposed" } };
      if (input.plan.effect === "hold") return { status: 200, body: { held: true, text: "Approval needed." } };
      input.plan.onDone?.("run");
      return { status: 200, body: { text: "{}" } };
    },
    async handle() { return { status: 200, body: {} }; },
  } as unknown as BotActService;
  const service = createSettingsActions({
    organization: () => true,
    facts: () => PERSON,
    acts: () => acts,
    operatorId: () => "pr_operator",
    botOwner: (id) => (id === "theirs" ? "pr_other" : "pr_owner"),
    botOfThread: () => "b1",
    routineBot: () => null,
    groupOwner: () => "pr_owner",
    turnMode: () => over.mode ?? "auto",
    keyRequired: () => [],
    audit: () => undefined,
    screen: () => ({ status: 200, body: { text: "Done." } }),
    targetName: (_kind, id) => ({ b1: "Nimbus", b2: "Ada", b3: "Orbit", theirs: "Other" } as Record<string, string>)[id],
    ownBots: (person) => (person === "pr_owner" ? ["b1", "b2", "b3"] : []),
    ...over,
  });
  const call = (args: Record<string, unknown>) => service.handle({ args, botId: "b1", threadId: "th1", generation: "g", botName: "Nimbus", botColor: "#000" });
  return { call, planned };
}

const done = (text: unknown) => expect(String(text)).toMatch(/Done|bots changed/);

describe("a bot manages its person's skills, plugins and connectors (#4504)", () => {
  it("plugins: add for itself, for chosen bots, for all the person's bots, update and remove", async () => {
    const h = harness();
    done((await h.call({ action: "set", key: "bot.plugin", value: { marketplace: "acme", plugin: "review" } })).body.text);
    done((await h.call({ action: "set", key: "bot.plugin", target: "b2,b3", value: { marketplace: "acme", plugin: "review" } })).body.text);
    done((await h.call({ action: "set", key: "bot.plugin", value: { marketplace: "acme", plugin: "review", me: true } })).body.text);
    done((await h.call({ action: "set", key: "capabilities.updates", value: { keys: ["plugin:me:me:review@acme"] } })).body.text);
    done((await h.call({ action: "set", key: "bot.plugin", value: { marketplace: "acme", plugin: "review", me: true, uninstall: true } })).body.text);
    done((await h.call({ action: "set", key: "bot.plugin", target: "b2", value: { key: "review@acme", uninstall: true } })).body.text);
    expect(h.planned.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/bots/b1/plugins/install",
      "POST /api/bots/b2/plugins/install",
      "POST /api/bots/b3/plugins/install",
      "POST /api/me/plugins/install",
      "POST /api/me/capability-updates",
      "DELETE /api/me/plugins/review@acme",
      "DELETE /api/bots/b2/plugins/review@acme",
    ]);
    expect(h.planned[4]!.body).toEqual({ keys: ["plugin:me:me:review@acme"] });
  });

  it("skills: add from GitHub for a bot or for the person, update, remove", async () => {
    const h = harness();
    done((await h.call({ action: "set", key: "bot.skillImport", value: { repo: "acme/skills", path: "steps" } })).body.text);
    done((await h.call({ action: "set", key: "bot.skillImport", value: { repo: "acme/skills", path: "steps", me: true } })).body.text);
    done((await h.call({ action: "set", key: "capabilities.updates", value: { key: "skill:bot:b1:steps" } })).body.text);
    done((await h.call({ action: "set", key: "bot.skill", value: { name: "steps", remove: true } })).body.text);
    done((await h.call({ action: "set", key: "bot.skill", value: { name: "steps", me: true, remove: true } })).body.text);
    done((await h.call({ action: "set", key: "bot.skill", value: { name: "steps", enabled: true } })).body.text);
    expect(h.planned.map(({ method, path, body }) => [method, path, body])).toEqual([
      ["POST", "/api/bots/b1/skills", { source: "acme/skills/steps" }],
      ["POST", "/api/me/skills-library", { source: "acme/skills/steps" }],
      ["POST", "/api/me/capability-updates", { keys: ["skill:bot:b1:steps"] }],
      ["DELETE", "/api/bots/b1/skills/steps", undefined],
      ["DELETE", "/api/me/skills-library/steps", undefined],
      ["PATCH", "/api/bots/b1/skills/steps", { enabled: true }],
    ]);
  });

  it("connectors: add the person's own, attach to all their bots, update all, remove", async () => {
    const h = harness({ answer: { bots: [{ id: "b1", mcpServers: [] }, { id: "b2", mcpServers: [] }, { id: "b3", mcpServers: [] }] } });
    done((await h.call({ action: "set", key: "connections.mcpServer", value: { name: "nimbus", command: "npx", args: ["-y", "nimbus-mcp@1.2.3"] } })).body.text);
    const attached = await h.call({ action: "set", key: "bot.mcpServer", target: "all", value: { name: "nimbus", attached: true } });
    expect(String(attached.body.text)).toContain("3 of 3 bots changed.");
    done((await h.call({ action: "set", key: "capabilities.updates", value: { all: true } })).body.text);
    done((await h.call({ action: "set", key: "connections.mcpServerRemove", value: "nimbus" })).body.text);
    expect(h.planned.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/me/mcp/servers",
      "PATCH /api/bots/b1",
      "PATCH /api/bots/b2",
      "PATCH /api/bots/b3",
      "POST /api/me/capability-updates",
      "DELETE /api/me/mcp/servers/nimbus",
    ]);
    expect(h.planned[4]!.body).toEqual({ all: true });
  });

  it("adds no card for the person's own items at the bot's level", async () => {
    const h = harness({ mode: "auto" });
    await h.call({ action: "set", key: "bot.plugin", value: { marketplace: "acme", plugin: "review", me: true } });
    await h.call({ action: "set", key: "capabilities.updates", value: { all: true } });
    await h.call({ action: "set", key: "bot.skillImport", value: { repo: "acme/skills", me: true } });
    expect(h.planned.map((row) => row.effect)).toEqual(["run", "run", "run"]);
  });

  it("lists what is installed and what has an update", async () => {
    const h = harness({ answer: { count: 1, checkedAt: 1, checking: false, items: [
      { key: "plugin:me:me:review@acme", kind: "plugin", name: "Review", scope: "me", installedVersion: "1.0.0", availableVersion: "1.1.0", updateAvailable: true, canUpdate: true },
      { key: "skill:bot:b1:steps", kind: "skill", name: "steps", scope: "bot", bot: { id: "b1", name: "Nimbus" }, updateAvailable: false, canUpdate: true },
      { key: "plugin:organization:organization:d1", kind: "plugin", name: "Policy", scope: "organization", organization: "required", organizationId: "d1", updateAvailable: false, canUpdate: false },
      { key: "connector:me:me:nimbus", kind: "connector", name: "nimbus", scope: "me", installedVersion: "1.2.3", updateAvailable: false, updateUnknown: true, canUpdate: true },
    ] } });
    const read = await h.call({ action: "get", key: "capabilities.updates" });
    expect(JSON.parse(String(read.body.text)).value).toEqual({ count: 1, items: [
      { key: "plugin:me:me:review@acme", kind: "plugin", name: "Review", scope: "me", installed: "1.0.0", update: "1.1.0" },
      { key: "skill:bot:b1:steps", kind: "skill", name: "steps", scope: "bot", bot: "Nimbus" },
      { key: "plugin:organization:organization:d1", kind: "plugin", name: "Policy", scope: "organization", organization: "required", id: "d1" },
      { key: "connector:me:me:nimbus", kind: "connector", name: "nimbus", scope: "me", installed: "1.2.3", unknown: true },
    ] });
  });

  it("a person's own item is always theirs to remove or turn off, whatever its name", async () => {
    // the organization imposes items named policy, house-rules and audit-log;
    // the person's own items of the same names are still theirs
    const h = harness({ mode: "full" });
    for (const args of [
      { key: "bot.plugin", value: { marketplace: "acme", plugin: "policy", uninstall: true } },
      { key: "bot.plugin", value: { key: "policy@acme", enabled: false } },
      { key: "bot.skill", value: { name: "house-rules", remove: true } },
      { key: "bot.skill", value: { name: "house-rules", me: true, enabled: false } },
      { key: "connections.mcpServerRemove", value: "audit-log" },
      { key: "connections.mcpServerEnabled", value: { name: "audit-log", enabled: false } },
    ]) {
      const answer = await h.call({ action: "set", ...args });
      expect(answer.status, args.key).toBe(200);
      done(answer.body.text);
    }
    expect(h.planned).toHaveLength(6);
  });

  it("the organization's own item: an offered one turns off, an imposed one answers the route's refusal", async () => {
    const h = harness({ mode: "full" });
    done((await h.call({ action: "set", key: "capabilities.organization", value: { key: "skill:organization:organization:d2", enabled: false } })).body.text);
    done((await h.call({ action: "set", key: "capabilities.organization", value: { key: "connector:organization:organization:d3", enabled: false } })).body.text);
    const imposed = await h.call({ action: "set", key: "capabilities.organization", value: { id: "d1", enabled: false } });
    expect(imposed.status).toBe(409);
    expect(String(imposed.body.error ?? imposed.body.text)).toContain("The organization imposes this capability: it stays on.");
    expect(h.planned.map(({ method, path, body }) => [method, path, body])).toEqual([
      ["PUT", "/api/me/org-capabilities/d2", { enabled: false }],
      ["PUT", "/api/me/org-capabilities/d3", { enabled: false }],
      ["PUT", "/api/me/org-capabilities/d1", { enabled: false }],
    ]);
  });

  it("another person's bot is out of reach, and all is the person's own bots only", async () => {
    const h = harness();
    const theirs = await h.call({ action: "set", key: "bot.plugin", target: "theirs", value: { marketplace: "acme", plugin: "review" } });
    expect(theirs.status).toBeGreaterThanOrEqual(400);
    h.planned.length = 0;
    const all = await h.call({ action: "set", key: "bot.plugin", target: "all", value: { marketplace: "acme", plugin: "review" } });
    expect(String(all.body.text)).toContain("3 of 3 bots changed.");
    expect(h.planned.map((row) => row.path)).toEqual([
      "/api/bots/b1/plugins/install", "/api/bots/b2/plugins/install", "/api/bots/b3/plugins/install",
    ]);
  });
});
