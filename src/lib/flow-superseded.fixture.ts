// Synthetic Installed inventory shared by DOM checks and headless captures.
import type { BotCapabilities } from "../../shared/capabilities";
import type { BotPluginsView } from "./my-connections";

export function flowSupersededPluginsFixture(installed = true): BotPluginsView {
  return {
    marketplaces: [{
      name: "osprey", source: "osprey/marketplace", addedAt: 1, updatedAt: 1,
      plugins: [{ name: "pulsatrix-flow-osprey", version: "0.1.21", installed, external: false, contents: { agents: [], commands: [], skills: ["tenant-operations"] } }],
    }],
    plugins: installed ? [{ key: "pulsatrix-flow-osprey@osprey", name: "pulsatrix-flow-osprey", marketplace: "osprey", version: "0.1.21", enabled: true, removed: [], declaredMcpServers: [] }] : [],
    policy: { mode: "any" }, engine: { loadsPlugins: true }, canChange: true,
  };
}

export function flowSupersededFixture(): BotCapabilities {
  return {
    botId: "bot-a", engine: { kind: "codex", label: "Codex" },
    items: [
      {
        key: "flow:organization:pulsatrix-flow", form: "flow", name: "Pulsatrix Flow",
        source: { kind: "perspicax", label: "Osprey", version: "0.20.14", pack: `sha256:${"a".repeat(64)}` },
        scope: "organization", state: "imposed", enabled: true, canToggle: false,
        engine: { skills: "prompt", commands: "prompt", agents: "prompt", nothing: false },
      },
      {
        key: "plugin:bot:pulsatrix-flow-osprey@osprey", form: "plugin", name: "Pulsatrix Flow Osprey",
        source: { kind: "marketplace", label: "GitHub", version: "0.1.21" },
        scope: "bot", state: "off", reason: "name_taken", enabled: true, canToggle: true,
        supersededBy: { tenant: "osprey", version: "0.1.41" },
        engine: { skills: "prompt", nothing: false },
      },
    ],
  };
}
