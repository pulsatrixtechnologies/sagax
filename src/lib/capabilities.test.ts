// Capabilities, lot 1b: the desktop's reading of a bot's resolved list.
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import {
  botPluginKey, capabilityName, enginesLine, engineGetsNothing, indexCut, installationServerName, orderedCapabilities,
  organizationRows, receivedGroups, receiptWords, roleProfileId, skillName,
} from "./capabilities";
import { CAPABILITY_ROLE_ID, capabilityFixture } from "./capabilities.fixture";

beforeEach(() => setLocale("en"));

describe("capabilities (desktop)", () => {
  it("orders the organization's first, then this bot's, mine, everyone's, the account's", () => {
    const scopes = orderedCapabilities(capabilityFixture().items).map((item) => item.scope);
    expect(scopes).toEqual(["organization", "bot", "bot", "bot", "bot", "me", "installation", "account"]);
  });

  it("groups what the engine receives: skills and commands by how, agents, servers, not served", () => {
    const groups = receivedGroups(capabilityFixture().items);
    expect(groups.prompt).toEqual(["Notion", "vcio-writing"]);
    expect(groups.native).toEqual([]);
    expect(groups.agents).toEqual(["Notion"]);
    expect(groups.servers).toEqual(["Dispatch", "GitHub"]);
    expect(groups.notServed.map((entry) => entry.name)).toEqual(["Pulsatrix Flow", "Microsoft 365"]);
    expect(groups.notServed[0]!.why).toBe("Claude only today");
    expect(groups.notServed[1]!.why).toBe("Claude account only");
  });

  it("reads the switch target from the key, never shown", () => {
    const items = capabilityFixture().items;
    expect(botPluginKey(items[1]!)).toBe("notion@market-one");
    expect(skillName(items[2]!)).toBe("vcio-writing");
    expect(roleProfileId(items[3]!)).toBe(CAPABILITY_ROLE_ID);
    expect(installationServerName(items[6]!)).toBe("github");
    expect(botPluginKey(items[6]!)).toBeNull();
  });

  it("names a Role Perspicax no longer lists with a plain word, never its id", () => {
    expect(capabilityName({ name: "", form: "role" })).toBe("Removed Role");
  });

  it("says what each engine gets of a capability (the Engines line)", () => {
    // a plugin for this bot: skills, commands, agents (no MCP: C-1)
    // Q8 C: Grok and API engines receive the files inline too
    expect(enginesLine("plugin", { commands: true })).toBe("Claude: everything · Codex: everything · Grok: everything · API: everything");
    // a plugin for everyone: its servers and library skills
    expect(enginesLine("plugin", { mcp: true, skills: true, indexOnly: true })).toBe("Claude: everything · Codex: everything · Grok: everything · API: everything");
    expect(enginesLine("mcp", { mcp: true })).toBe("Claude: everything · Codex: everything · Grok: everything · API: everything");
    expect(enginesLine("skill", { skills: true, indexOnly: true })).toBe("Claude: everything · Codex: everything · Grok: everything · API: everything");
    expect(receiptWords({ skills: "prompt", mcp: "none", nothing: false })).toBe("skills");
  });

  it("warns before an install only when the bot's engine would get nothing", () => {
    expect(engineGetsNothing("grok", "plugin", { skills: true, commands: true })).toBe(false);
    expect(engineGetsNothing("codex", "plugin", { skills: true })).toBe(false);
    expect(engineGetsNothing("grok", "plugin", { mcp: true, skills: true, indexOnly: true })).toBe(false);
    expect(engineGetsNothing("openai-compat", "skill", { skills: true, skillDiscovery: false })).toBe(false);
    expect(engineGetsNothing("openai-compat", "skill", { skills: true, skillDiscovery: true })).toBe(false);
    // nothing brought (contents not read yet): no warning
    expect(engineGetsNothing("grok", "plugin", {})).toBe(false);
  });

  it("keeps the organization's Flow and the Roles for Installed", () => {
    expect(organizationRows(capabilityFixture().items).map((item) => item.form)).toEqual(["flow", "role", "role"]);
  });

  it("says the prompt index cut only when it did", () => {
    expect(indexCut(capabilityFixture().promptIndex)).toBe(true);
    expect(indexCut({ bytes: 1_000, maxBytes: 4_000, skills: 3, maxSkills: 30, omitted: 0 })).toBe(false);
    expect(indexCut(undefined)).toBe(false);
    expect(indexCut({ bytes: 100, maxBytes: 4_000, skills: 0, maxSkills: 30, omitted: 0, incomplete: true })).toBe(true);
  });
});
