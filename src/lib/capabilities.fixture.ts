// A bot's resolved list for the tests and the gallery of Bot panel >
// Capabilities (lot 1b): one of each form and scope, on a Codex bot.
import type { BotCapabilities, Capability } from "../../shared/capabilities";

export const CAPABILITY_ROLE_ID = "6f1c2a9e-4b7d-4e1a-9c3f-2d5e8a7b1c04";

export function capabilityFixture(overrides: Partial<BotCapabilities> = {}): BotCapabilities {
  const items: Capability[] = [
    {
      key: "flow:organization:pulsatrix-flow", form: "flow", name: "Pulsatrix Flow", source: { kind: "perspicax", label: "Acme", version: "0.20.14" },
      scope: "organization", state: "not_served", enabled: false, canToggle: false, engine: { skills: "none", commands: "none", agents: "none", nothing: true },
    },
    {
      key: "plugin:bot:notion@market-one", form: "plugin", name: "Notion", source: { kind: "marketplace", label: "market-one", version: "1.2.0" },
      scope: "bot", state: "on", enabled: true, canToggle: true, updateAvailable: true,
      brings: { skills: ["notion-search"], commands: ["notion-page"], agents: ["notion-writer"], mcpServers: ["notion"] },
      engine: { skills: "prompt", commands: "prompt", agents: "prompt", nothing: false }, installedBy: "Alex Martin",
    },
    {
      key: "skill:bot:vcio-writing", form: "skill", name: "vcio-writing", source: { kind: "file", label: "Learned" },
      scope: "bot", state: "on", enabled: true, canToggle: true, engine: { skills: "prompt", nothing: false },
    },
    {
      key: `role:bot:${CAPABILITY_ROLE_ID}`, form: "role", name: "Dispatch", source: { kind: "perspicax", label: "Acme" },
      scope: "bot", state: "on", enabled: true, canToggle: true, engine: { mcp: "mounted", tools: "mounted", nothing: false }, mounts: ["perspicax_dispatch"],
    },
    {
      key: "role:bot:0b8e2f6a-1c3d-4e5f-8a9b-7c6d5e4f3a21", form: "role", name: "", source: { kind: "perspicax", label: "Acme" },
      scope: "bot", state: "off", reason: "unknown_profile", enabled: true, canToggle: true, engine: { mcp: "mounted", tools: "mounted", nothing: false },
    },
    {
      key: "mcp:me:my-notes", form: "mcp", name: "My Notes", source: { kind: "file", label: "notes.example.com" },
      scope: "me", state: "to_connect", reason: "needs_sign_in", connect: { reason: "sign_in" }, enabled: true, canToggle: false, engine: { mcp: "mounted", nothing: false },
    },
    {
      key: "mcp:installation:github", form: "mcp", name: "GitHub", source: { kind: "installation", label: "Sagax" },
      scope: "installation", state: "on", enabled: true, canToggle: true, engine: { mcp: "mounted", nothing: false }, mounts: ["github"],
    },
    {
      key: "connector:account:claude:Microsoft 365", form: "connector", name: "Microsoft 365", source: { kind: "account", label: "Claude" },
      scope: "account", state: "not_served", enabled: true, canToggle: false, engine: { tools: "none", nothing: true },
    },
  ];
  return {
    botId: "bot-1",
    engine: { kind: "codex", label: "Codex" },
    items,
    promptIndex: { bytes: 4_200, maxBytes: 4_000, skills: 31, maxSkills: 30, omitted: 2 },
    ...overrides,
  };
}

/** The REA built-in row (Sagax ships it, on for every bot). */
export function reaCapabilityFixture(overrides: Partial<Capability> = {}): Capability {
  return {
    key: "plugin:bot:builtin:rea", form: "plugin", name: "REA", builtin: "rea",
    description: "Reverse engineering for agents.", source: { kind: "installation", label: "Sagax", version: "6.8.0" },
    scope: "bot", state: "on", enabled: true, canToggle: true, brings: { skills: [], commands: [], agents: [], mcpServers: ["rea"] },
    engine: { mcp: "mounted", nothing: false }, mounts: ["rea"],
    ...overrides,
  };
}
