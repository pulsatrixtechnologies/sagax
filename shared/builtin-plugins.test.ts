import { describe, expect, it } from "vitest";
import { BUILTIN_PLUGINS, REA_PLUGIN, REA_VERSION, builtinPlugin, builtinPluginEnabled, parseBuiltinPluginsPatch } from "./builtin-plugins.ts";

describe("built-in plugins", () => {
  it("pins REA to one version with the official non-interactive stdio command", () => {
    expect(REA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(REA_PLUGIN.spec.command).toBe("npx");
    expect(REA_PLUGIN.spec.args).toEqual(["-y", `rea-agents@${REA_VERSION}`, "mcp"]);
    // never a floating tag, never the setup command that edits harness configs
    expect(REA_PLUGIN.spec.args.join(" ")).not.toMatch(/@latest|setup/);
    expect(REA_PLUGIN.spec.env).toMatchObject({
      REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
      REA_MCP_OUTPUT_SCHEMA_PROFILE: "compact",
      npm_config_yes: "true",
      npm_config_update_notifier: "false",
    });
    // the Hopper demo dialog wait is bounded: a turn is never blocked
    expect(Number(REA_PLUGIN.spec.env.REA_HOPPER_DEMO_DIALOG_TIMEOUT_MS)).toBeGreaterThan(0);
    expect(BUILTIN_PLUGINS).toContain(REA_PLUGIN);
    expect(builtinPlugin("rea")).toBe(REA_PLUGIN);
    expect(builtinPlugin("builtin:rea")).toBe(REA_PLUGIN);
  });

  it("is on for a new bot and for a bot saved before it existed, off only when switched off", () => {
    expect(builtinPluginEnabled({}, "rea")).toBe(true);
    expect(builtinPluginEnabled({ builtinPlugins: {} }, "rea")).toBe(true);
    expect(builtinPluginEnabled(undefined, "rea")).toBe(true);
    expect(builtinPluginEnabled({ builtinPlugins: { rea: true } }, "rea")).toBe(true);
    expect(builtinPluginEnabled({ builtinPlugins: { rea: false } }, "rea")).toBe(false);
  });

  it("accepts a PATCH of known ids with boolean values only", () => {
    expect(parseBuiltinPluginsPatch({ rea: false })).toEqual({ ok: true, value: { rea: false } });
    expect(parseBuiltinPluginsPatch({ other: true }).ok).toBe(false);
    expect(parseBuiltinPluginsPatch({ rea: "off" }).ok).toBe(false);
    expect(parseBuiltinPluginsPatch([]).ok).toBe(false);
    expect(parseBuiltinPluginsPatch(null).ok).toBe(false);
  });
});
