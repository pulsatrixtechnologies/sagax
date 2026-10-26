// Copy link to this plugin (src/lib/plugin-link.ts), the data center chosen
// first (plugins/DataCenterDialog.tsx) and what the configuration form sends
// (plugins/PluginConfigForm.tsx).
import { describe, expect, it } from "vitest";

import { defaultDataCenter } from "@/components/plugins/DataCenterDialog";
import { configDraft, configValues } from "@/components/plugins/PluginConfigForm";
import { pluginShareLink } from "./plugin-link";

describe("plugin link", () => {
  it("points a marketplace plugin at its repository and a reviewed server at its documentation", () => {
    expect(pluginShareLink({ kind: "plugin", marketplaceSource: "acme/tools" })).toBe("https://github.com/acme/tools");
    expect(pluginShareLink({ kind: "plugin", marketplaceSource: "https://gitlab.example.com/acme/tools.git" })).toBe("https://gitlab.example.com/acme/tools");
    expect(pluginShareLink({ kind: "plugin", marketplaceSource: "/Users/me/local" })).toBeNull();
    expect(pluginShareLink({ kind: "mcp", serverUrl: "https://mcp.linear.app/mcp" })).toMatch(/^https:\/\/(?!mcp\.linear\.app\/mcp)/);
    expect(pluginShareLink({ kind: "mcp", serverUrl: "https://mcp.example.test/mcp" })).toBe("https://mcp.example.test/mcp");
    expect(pluginShareLink({ kind: "mcp" })).toBeNull();
  });
});

describe("data center", () => {
  it("starts on the region whose address is the default one", () => {
    const regions = [{ id: "us", label: "US", url: "https://us.x.test/mcp" }, { id: "eu", label: "EU", url: "https://eu.x.test/mcp" }];
    expect(defaultDataCenter(regions, "https://eu.x.test/mcp")).toBe("eu");
    expect(defaultDataCenter(regions, "https://other.test")).toBe("us");
  });
});

describe("plugin configuration form", () => {
  const config = {
    fields: [
      { key: "team", type: "string" as const, title: "Team", sensitive: false, required: true },
      { key: "size", type: "number" as const, title: "Size", sensitive: false, required: false, default: 20 },
      { key: "dry", type: "boolean" as const, title: "Dry run", sensitive: false, required: false },
      { key: "token", type: "string" as const, title: "Token", sensitive: true, required: false },
    ],
    values: { team: "Platform" },
  };
  it("fills the saved values, never a secret, and sends typed values with empty ones cleared", () => {
    const draft = configDraft(config);
    expect(draft).toEqual({ team: "Platform", size: "", dry: false });
    expect(configValues(config, { ...draft, size: "50", team: " " })).toEqual({ team: "", size: 50, dry: false });
  });
});
