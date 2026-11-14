import { describe, expect, it } from "vitest";

import { BOT_FIELD_PERMISSIONS } from "../shared/permissions.ts";
import { MEMBER_BOT_FIELDS } from "../shared/viewer-capabilities.ts";
import {
  AGENT_PRIMARY_FIELD,
  AGENT_SETTINGS_FIELDS,
  RUNTIME_SETTINGS_FIELDS,
  applySkillAndPluginSwitches,
  formatEngineCandidates,
  isRuntimeSettingsField,
  partitionAgentSettings,
  plainFieldRefusalReason,
  resolveEngineInstance,
} from "./fleet-agent-settings.ts";

describe("fleet-agent-settings (#1944)", () => {
  it("derives AGENT_SETTINGS_FIELDS from MEMBER_BOT_FIELDS and BOT_FIELD_PERMISSIONS (no drifting hand list)", () => {
    for (const field of MEMBER_BOT_FIELDS) {
      if (field === "modelSelection") {
        expect(AGENT_SETTINGS_FIELDS.includes(field)).toBe(false);
        continue;
      }
      expect(AGENT_SETTINGS_FIELDS.includes(field), field).toBe(true);
    }
    for (const field of Object.keys(BOT_FIELD_PERMISSIONS)) {
      if (field === "modelSelection" || field === "threadId") continue;
      expect(AGENT_SETTINGS_FIELDS.includes(field), field).toBe(true);
    }
    for (const field of RUNTIME_SETTINGS_FIELDS) {
      expect(AGENT_SETTINGS_FIELDS.includes(field), field).toBe(true);
      expect(isRuntimeSettingsField(field)).toBe(true);
    }
    expect(AGENT_SETTINGS_FIELDS.includes(AGENT_PRIMARY_FIELD)).toBe(true);
    expect(AGENT_SETTINGS_FIELDS.includes("modelSelection")).toBe(false);
  });

  it("resolveEngineInstance: exact id first, unique fuzzy match, ambiguous refused with candidates", () => {
    const instances = [
      { instanceId: "claude-work", driverKind: "claude", displayName: "Claude Work" },
      { instanceId: "claude-home", driverKind: "claude", displayName: "Claude Home" },
      { instanceId: "grok-main", driverKind: "grok", displayName: "Grok" },
    ];
    expect(resolveEngineInstance("claude-work", instances)).toEqual({ ok: true, instanceId: "claude-work" });
    expect(resolveEngineInstance("GROK-MAIN", instances)).toEqual({ ok: true, instanceId: "grok-main" });
    expect(resolveEngineInstance("grok", instances)).toEqual({ ok: true, instanceId: "grok-main" });

    const ambiguous = resolveEngineInstance("claude", instances);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.reason).toBe("ambiguous");
      expect(ambiguous.candidates.map((c) => c.instanceId).sort()).toEqual(["claude-home", "claude-work"]);
      expect(formatEngineCandidates(ambiguous.candidates)).toMatch(/claude-work/);
      expect(formatEngineCandidates(ambiguous.candidates)).toMatch(/claude-home/);
    }

    const unknown = resolveEngineInstance("nope", instances);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe("unknown");
  });

  it("plainFieldRefusalReason strips permission keys and console paths", () => {
    expect(plainFieldRefusalReason("cwd", {
      error: "forbidden",
      permission: "folders.botWorkingFolder",
      message: "Your profile does not include folders.botWorkingFolder. Ask an admin to add it in Perspicax.",
    })).toBe("your profile does not allow changing where this bot's files live");

    expect(plainFieldRefusalReason("cloudBackend", {
      permission: "bots.computer",
      message: "See console/sagax/bots for details",
    })).toBe("your profile does not allow changing where this bot runs");

    expect(plainFieldRefusalReason("voiceNotes", {
      error: "stop this bot's turn before changing its browser access",
    })).toBe("stop this bot's turn before changing its browser access");
  });

  it("partitionAgentSettings routes runtime and primary apart from the bot PATCH", () => {
    const parts = partitionAgentSettings({
      name: "Osprey",
      voiceNotes: true,
      maxConcurrentThreads: 2,
      turnPayer: "owner",
      primary: true,
    });
    expect(parts.patch).toEqual({ name: "Osprey", voiceNotes: true });
    expect(parts.runtime).toEqual({ maxConcurrentThreads: 2, turnPayer: "owner" });
    expect(parts.primary).toBe(true);
  });

  it("#4172: skills, plugins and grants are switch maps beside the bot PATCH; hidden still archives through it", () => {
    expect(AGENT_SETTINGS_FIELDS).toEqual(expect.arrayContaining(["skills", "plugins", "grants", "soul", "title", "approvalMode", "visibility", "mascotBody", "hidden"]));
    const parts = partitionAgentSettings({
      name: "Osprey",
      skills: { "tidy-notes": true, "old-skill": false },
      plugins: { "docs@market": false },
      grants: { "user:pr_2": "edit", "team:t1": null },
    });
    expect(parts.patch).toEqual({ name: "Osprey" });
    expect(parts.switches).toEqual({ skills: { "tidy-notes": true, "old-skill": false }, plugins: { "docs@market": false }, grants: { "user:pr_2": "edit", "team:t1": null } });
    expect(parts.switchesInvalid).toEqual([]);
    const bad = partitionAgentSettings({ skills: ["tidy-notes"], grants: { pr_2: "owner" } });
    expect(bad.switches).toEqual({});
    expect(bad.switchesInvalid.map((entry) => entry.field)).toEqual(["skills", "grants"]);
    expect(bad.switchesInvalid[1]!.reason).toContain("use, run, edit or manage");
  });

  describe("#4172: skill and plugin switches, as the person, through the bot page's routes", () => {
    // The answers the real routes give (bots-content.ts, bot-plugins.ts, the
    // client scope gate of request-auth.ts for a path no member route takes,
    // the library's own routes among them unless the person manages it).
    const fakeServer = (options: { pluginsOwnerOnly?: boolean; libraryOff?: boolean; libraryDisabled?: boolean; managesLibrary?: boolean; manySkills?: number } = {}) => {
      const sent: Array<{ method: string; path: string; body?: unknown }> = [];
      const skills = new Map([["tidy-notes", { origin: "private", enabled: false }], ["old-skill", { origin: "private", enabled: true }], ["house-style", { origin: "library", enabled: !options.libraryDisabled }], ["web-search", { origin: "native", enabled: true }]]);
      for (let index = 0; index < (options.manySkills ?? 0); index += 1) skills.set(`extra-${index}`, { origin: "private", enabled: true });
      const library = new Set(["house-style", "brand-voice"]);
      let assignedSkills = ["house-style"];
      const plugins = new Map([["docs@market", false], ["lint@market", true]]);
      const perform = async (request: { method: string; path: string; body?: unknown }) => {
        sent.push(request);
        const { method, path } = request;
        const enabled = (request.body as { enabled?: boolean } | undefined)?.enabled;
        if (method === "GET" && path === "/api/bots/b1/skills") {
          return { status: 200, body: {
            skills: [...skills].map(([name, skill]) => ({ name, origin: skill.origin, enabled: skill.enabled })),
            library: [...library].filter((name) => !assignedSkills.includes(name)).map((name) => ({ name, enabled: true })),
            assignedSkills,
          } };
        }
        if (method === "PUT" && path === "/api/bots/b1/skills-library") {
          const names = (request.body as { skills: string[] }).skills;
          const unknown = names.filter((name) => !library.has(name));
          if (unknown.length) return { status: 422, body: { error: "not in the library: " + unknown.join(", ") } };
          assignedSkills = names;
          for (const name of names) if (!skills.has(name)) skills.set(name, { origin: "library", enabled: true });
          for (const [name, skill] of skills) if (skill.origin === "library" && !names.includes(name)) skills.delete(name);
          return { status: 200, body: { assignedSkills: names } };
        }
        if (path.startsWith("/api/skills-library/") && method !== "GET" && !options.managesLibrary) return { status: 403, body: { error: "forbidden: this session lacks the admin scope" } };
        if (method === "PATCH" && options.libraryOff && path.startsWith("/api/skills-library/")) return { status: 404, body: { error: "skills library is not enabled" } };
        if (method === "GET" && path === "/api/bots/b1/plugins") return { status: 200, body: { marketplaces: [], plugins: [...plugins].map(([key, on]) => ({ key, name: key.split("@")[0], marketplace: key.split("@")[1], enabled: on })) } };
        let match = /^\/api\/bots\/b1\/skills\/([a-z0-9-]+)$/.exec(path) ?? /^\/api\/skills-library\/([a-z0-9-]+)$/.exec(path);
        if (method === "PATCH" && match) {
          const skill = skills.get(match[1]!);
          if (!skill || skill.origin === "native") return { status: 404, body: { error: `no imported skill named "${match[1]}"` } };
          skill.enabled = enabled!;
          return { status: 200, body: { skill: { name: match[1], enabled } } };
        }
        match = /^\/api\/bots\/b1\/plugins\/([A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:@|%40)[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/.exec(path);
        if (method === "PATCH" && match) {
          if (options.pluginsOwnerOnly) return { status: 403, body: { error: "Only the bot's owner, or someone who manages it, can change its plugins.", code: "plugins_owner_only" } };
          const key = decodeURIComponent(match[1]!);
          if (!plugins.has(key)) return { status: 404, body: { error: "No plugin with that name on this bot.", code: "not_found" } };
          plugins.set(key, enabled!);
          return { status: 200, body: { plugin: { key, enabled } } };
        }
        return { status: 403, body: { error: "forbidden: this session lacks the admin scope" } };
      };
      return { perform, sent, skills, plugins, assigned: () => assignedSkills };
    };

    it("the contract's example: each listed skill and plugin is switched where the page switches it", async () => {
      const server = fakeServer();
      const result = await applySkillAndPluginSwitches(server.perform, "b1", {
        skills: { "tidy-notes": true, "old-skill": false, "house-style": true },
        plugins: { "docs@market": true, "lint@market": false },
      });
      expect(result).toEqual({ changed: ["skills.tidy-notes", "skills.old-skill", "skills.house-style", "plugins.docs@market", "plugins.lint@market"], refused: [] });
      expect(server.sent.filter((request) => request.method === "PATCH").map((request) => request.path)).toEqual([
        "/api/bots/b1/skills/tidy-notes",
        "/api/bots/b1/skills/old-skill",
        "/api/bots/b1/plugins/docs%40market",
        "/api/bots/b1/plugins/lint%40market",
      ]);
      expect(server.skills.get("tidy-notes")!.enabled).toBe(true);
      expect(server.plugins.get("lint@market")).toBe(false);
    });

    it("an unknown skill is refused as unknown, never as a missing scope, and the others still switch", async () => {
      const server = fakeServer();
      const result = await applySkillAndPluginSwitches(server.perform, "b1", { skills: { "Weekly Report": true, "gone-skill": false, "tidy-notes": true } });
      expect(result.changed).toEqual(["skills.tidy-notes"]);
      expect(result.refused).toEqual([
        { field: "skills.Weekly Report", reason: expect.stringMatching(/^this bot has no skill named "Weekly Report"/) },
        { field: "skills.gone-skill", reason: expect.stringMatching(/^this bot has no skill named "gone-skill"/) },
      ]);
      for (const entry of result.refused) expect(entry.reason).not.toMatch(/scope|forbidden/i);
    });

    it("a plugin that is not installed is refused as not installed; a plugin's bare name finds its one installed key", async () => {
      const server = fakeServer();
      const result = await applySkillAndPluginSwitches(server.perform, "b1", { plugins: { "missing@market": true, docs: true, nothing: false } });
      expect(result.changed).toEqual(["plugins.docs"]);
      expect(server.plugins.get("docs@market")).toBe(true);
      expect(result.refused).toEqual([
        { field: "plugins.missing@market", reason: expect.stringMatching(/^the plugin "missing@market" is not installed on this bot/) },
        { field: "plugins.nothing", reason: expect.stringMatching(/^the plugin "nothing" is not installed on this bot/) },
      ]);
    });

    it("the route's own refusal is the verdict, in its plain words", async () => {
      const server = fakeServer({ pluginsOwnerOnly: true });
      const result = await applySkillAndPluginSwitches(server.perform, "b1", { plugins: { "docs@market": true } });
      expect(result).toEqual({ changed: [], refused: [{ field: "plugins.docs@market", reason: "Only the bot's owner, or someone who manages it, can change its plugins." }] });
    });
    it("a library skill not yet on the bot: true adds it the way the page's Add to bot does, false says it is already off", async () => {
      const server = fakeServer();
      const result = await applySkillAndPluginSwitches(server.perform, "b1", { skills: { "brand-voice": true } });
      expect(result).toEqual({ changed: ["skills.brand-voice"], refused: [] });
      expect(server.sent.filter((request) => request.method !== "GET")).toEqual([
        { method: "PUT", path: "/api/bots/b1/skills-library", body: { skills: ["house-style", "brand-voice"] } },
      ]);
      expect(server.assigned()).toEqual(["house-style", "brand-voice"]);

      const off = await applySkillAndPluginSwitches(fakeServer().perform, "b1", { skills: { "brand-voice": false } });
      expect(off).toEqual({ changed: [], refused: [{ field: "skills.brand-voice", reason: expect.stringMatching(/^the library skill "brand-voice" is already off for this bot .*nothing to do$/) }] });
    });

    it("a library skill on the bot: false removes it from this bot only, the way the page's Remove from bot does", async () => {
      const server = fakeServer();
      const result = await applySkillAndPluginSwitches(server.perform, "b1", { skills: { "house-style": false } });
      expect(result).toEqual({ changed: ["skills.house-style"], refused: [] });
      expect(server.sent.filter((request) => request.method !== "GET")).toEqual([
        { method: "PUT", path: "/api/bots/b1/skills-library", body: { skills: [] } },
      ]);
      expect(server.assigned()).toEqual([]);
    });

    it("true then false on a library skill undoes the change and never touches the library's shared switch", async () => {
      const server = fakeServer();
      const on = await applySkillAndPluginSwitches(server.perform, "b1", { skills: { "brand-voice": true } });
      const off = await applySkillAndPluginSwitches(server.perform, "b1", { skills: { "brand-voice": false } });
      expect(on).toEqual({ changed: ["skills.brand-voice"], refused: [] });
      expect(off).toEqual({ changed: ["skills.brand-voice"], refused: [] });
      expect(server.assigned()).toEqual(["house-style"]);
      expect(server.sent.filter((request) => request.path.startsWith("/api/skills-library/"))).toEqual([]);
    });

    it("true on a library skill already on for this bot answers changed and sends nothing", async () => {
      const server = fakeServer();
      const result = await applySkillAndPluginSwitches(server.perform, "b1", { skills: { "house-style": true } });
      expect(result).toEqual({ changed: ["skills.house-style"], refused: [] });
      expect(server.sent.filter((request) => request.method !== "GET")).toEqual([]);
    });

    it("true on a library skill turned off in the library: a member is told plainly who can turn it back on", async () => {
      const member = fakeServer({ libraryDisabled: true });
      const result = await applySkillAndPluginSwitches(member.perform, "b1", { skills: { "house-style": true } });
      expect(result).toEqual({ changed: [], refused: [{ field: "skills.house-style", reason: 'the skill "house-style" is turned off in the organization\'s library, and only someone who manages the library can turn it back on' }] });
      expect(result.refused[0]!.reason).not.toMatch(/scope|forbidden/i);

      const manager = fakeServer({ libraryDisabled: true, managesLibrary: true });
      expect(await applySkillAndPluginSwitches(manager.perform, "b1", { skills: { "house-style": true } })).toEqual({ changed: ["skills.house-style"], refused: [] });
      expect(manager.sent.filter((request) => request.method === "PATCH").map((request) => request.path)).toEqual(["/api/skills-library/house-style"]);
    });

    it("a skill the engine loads by itself is not switched, and the reason says so plainly", async () => {
      const server = fakeServer();
      const result = await applySkillAndPluginSwitches(server.perform, "b1", { skills: { "web-search": false } });
      expect(result).toEqual({ changed: [], refused: [{ field: "skills.web-search", reason: 'the engine loads the skill "web-search" by itself, so it is not switched here' }] });
      expect(server.sent.filter((request) => request.method !== "GET")).toEqual([]);
    });

    it("a 404 for a name the listing holds keeps the route's own words", async () => {
      const server = fakeServer({ libraryOff: true, libraryDisabled: true, managesLibrary: true });
      const result = await applySkillAndPluginSwitches(server.perform, "b1", { skills: { "house-style": true } });
      expect(result).toEqual({ changed: [], refused: [{ field: "skills.house-style", reason: "skills library is not enabled" }] });
    });

    it("a long list of names says how many it leaves out", async () => {
      const server = fakeServer({ manySkills: 40 });
      const result = await applySkillAndPluginSwitches(server.perform, "b1", { skills: { "no-such": true } });
      expect(result.refused[0]!.reason).toMatch(/ and 24 more; the library also offers: brand-voice\)$/);
    });
  });
});
