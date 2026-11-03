import { describe, expect, it } from "vitest";
import { pluginMcpPrecheck, pluginSpecOnComputer, selectPluginScopes } from "./capability-plugin-mounts.ts";

describe("complete plugin scopes", () => {
  it("selects organization before person before bot, with one current owner per name", () => {
    const plugin = (name: string, dir: string) => ({ name, dir });
    expect(selectPluginScopes({
      organization: [plugin("flow", "/org/flow")],
      person: [plugin("flow", "/me/flow"), plugin("review", "/me/review")],
      bot: [plugin("review", "/bot/review"), plugin("other", "/bot/other")],
    })).toEqual([
      { name: "flow", dir: "/org/flow", scope: "organization" },
      { name: "review", dir: "/me/review", scope: "person" },
      { name: "other", dir: "/bot/other", scope: "bot" },
    ]);
  });

  it("checks every plugin server against the same namespace and environment policy", () => {
    const command = { command: "node", args: [], env: {} };
    const context = { taken: (name: string) => name === "docs", organization: true, hasEnvironment: true };
    expect(pluginMcpPrecheck("docs", command, context)).toBe("name_taken");
    expect(pluginMcpPrecheck("sagax", command, context)).toBe("reserved");
    expect(pluginMcpPrecheck("Too Long!", command, context)).toBe("invalid");
    expect(pluginMcpPrecheck("tool", command, { ...context, hasEnvironment: false })).toBe("no_environment");
    expect(pluginMcpPrecheck("tool", command, context)).toBeNull();
    expect(pluginMcpPrecheck("tool", { type: "http", url: "https://tools.example.com/mcp", headers: {} }, { ...context, hasEnvironment: false })).toBeNull();
  });

  it("executes a solo plugin at its own folder without changing stored specs", () => {
    const spec = { command: "node", args: ["/workspace/sagax-plugins/review/bin/tool"], env: { ROOT: "/workspace/sagax-plugins/review" } };
    expect(pluginSpecOnComputer(spec, { name: "review", dir: "/home/person/plugins/review" })).toEqual({ command: "node", args: ["/home/person/plugins/review/bin/tool"], env: { ROOT: "/home/person/plugins/review" } });
    expect(spec.args[0]).toBe("/workspace/sagax-plugins/review/bin/tool");
  });
});
