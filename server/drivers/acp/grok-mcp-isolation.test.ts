import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeTempDir } from "../../testing/cleanup.ts";
import { grokIsolatedConfigToml, grokIsolatedRequirements, isolateGrokMcp, syncGrokIsolatedHome } from "./grok-mcp-isolation.ts";

describe("grokIsolatedConfigToml (#2747)", () => {
  it("drops every MCP server, plugin and marketplace table or key, and keeps the rest", () => {
    const source = [
      "[cli]",
      "auto_update = false",
      "disabled_mcp_servers = [",
      "  \"a\",",
      "]",
      "mcp_servers.inline.url = \"https://prod.example/a\"",
      "[marketplace]",
      "official_marketplace_auto_installed = true",
      "[[marketplace.sources]]",
      "name = \"tenant\"",
      "[ \"mcp_servers\" . quoted ]",
      "url = \"https://prod.example/b\"",
      "[mcp_servers.pulsatrix_dispatch]",
      "url = \"https://prod.example/c\"",
      "[mcp_servers.pulsatrix_dispatch.headers]",
      "x = \"y\"",
      "[plugins.vercel]",
      "enabled = true",
      "[model.ornith-local]",
      "model = \"ornith\"",
      "[[model.ornith-local.reasoning_efforts]]",
      "id = \"high\"",
      "[ui]",
      "yolo = true",
    ].join("\n");
    const out = grokIsolatedConfigToml(source);
    expect(out).not.toMatch(/mcp_servers|marketplace|plugins|prod\.example|vercel|tenant/);
    for (const kept of ["[cli]", "auto_update = false", "[model.ornith-local]", "model = \"ornith\"", "[[model.ornith-local.reasoning_efforts]]", "id = \"high\"", "[ui]", "yolo = true"]) {
      expect(out).toContain(kept);
    }
  });

  it("puts project MCP off ahead of the person's own policy", () => {
    expect(grokIsolatedRequirements(undefined)).toBe("enable_all_project_mcp_servers = false\n");
    const out = grokIsolatedRequirements("enable_all_project_mcp_servers = true\n[telemetry]\nx = 1\n");
    expect(out).toBe("enable_all_project_mcp_servers = false\n[telemetry]\nx = 1\n");
  });
});

describe("isolateGrokMcp (#2747)", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "grok-iso-"));
  });
  afterEach(() => removeTempDir(scratch));

  it("links the real home except its MCP and plugin sources, and keeps the login in the real file", () => {
    const real = join(scratch, "home", ".grok");
    mkdirSync(join(real, "installed-plugins", "vercel"), { recursive: true });
    mkdirSync(join(real, "skills"), { recursive: true });
    writeFileSync(join(real, "auth.json"), "{}");
    writeFileSync(join(real, "mcp_credentials.json"), "{}");
    writeFileSync(join(real, "config.toml"), "[mcp_servers.a]\nurl = \"https://x\"\n[ui]\nyolo = true\n");
    const env: Record<string, string | undefined> = { GROK_HOME: real };
    const root = join(scratch, "data");
    isolateGrokMcp(env, real, root);
    const home = env.GROK_HOME!;
    expect(home.startsWith(root)).toBe(true);
    expect(env.GROK_AUTH_PATH).toBe(join(real, "auth.json"));
    expect(env.GROK_CLAUDE_MCPS_ENABLED).toBe("false");
    expect(env.GROK_CURSOR_MCPS_ENABLED).toBe("false");
    expect(env.GROK_CODEX_MCPS_ENABLED).toBe("false");
    // QA of #2816: the compat plugins' skills and hooks stay the person's
    for (const source of ["CLAUDE", "CURSOR", "CODEX"]) {
      expect(env[`GROK_${source}_SKILLS_ENABLED`], source).toBe("false");
      expect(env[`GROK_${source}_HOOKS_ENABLED`], source).toBe("false");
    }
    expect(readlinkSync(join(home, "auth.json"))).toBe(join(real, "auth.json"));
    expect(readlinkSync(join(home, "skills"))).toBe(join(real, "skills"));
    // sessions live in the real home, so a resume finds them either way
    expect(readlinkSync(join(home, "sessions"))).toBe(join(real, "sessions"));
    for (const hidden of ["installed-plugins", "mcp_credentials.json"]) expect(existsSync(join(home, hidden))).toBe(false);
    expect(lstatSync(join(home, "config.toml")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(home, "config.toml"), "utf8")).toBe("[ui]\nyolo = true\n");

    // a second pass on the same env does not nest, and a removed entry unlinks
    isolateGrokMcp(env, env.GROK_HOME!, root);
    expect(env.GROK_HOME).toBe(home);
    rmSync(join(real, "skills"), { recursive: true });
    expect(syncGrokIsolatedHome(real, root)).toBe(home);
    expect(existsSync(join(home, "skills"))).toBe(false);
    expect(() => lstatSync(join(home, "skills"))).toThrow();
  });

  it("gives each real home its own isolated home", () => {
    const root = join(scratch, "data");
    expect(syncGrokIsolatedHome(join(scratch, "a", ".grok"), root)).not.toBe(syncGrokIsolatedHome(join(scratch, "b", ".grok"), root));
  });
});
